import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const SKILLS_ROOT = fileURLToPath(new URL('../skills/', import.meta.url));
const SKILL_URI_PREFIX = 'skill://postsider/';
const MAX_SKILL_FILES = 100;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_RESOURCE_BYTES = 1024 * 1024;
const MAX_SKILL_BYTES = 5 * 1024 * 1024;
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

interface SkillResource {
  uri: string;
  digest: string;
  mimeType: string;
  text: string;
}

interface SkillEntry {
  uri: string;
  frontmatter: Record<string, string>;
  resources: Array<Pick<SkillResource, 'uri' | 'digest'>>;
}

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')}`;
}

function parseFrontmatter(text: string, file: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) {
    throw new Error(`${file} must start with YAML frontmatter.`);
  }

  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1) {
      throw new Error(`${file} has unsupported frontmatter: ${line}`);
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  if (!frontmatter.name || !frontmatter.description) {
    throw new Error(`${file} must declare name and description.`);
  }
  return frontmatter;
}

function collectFiles(directory: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) {
      files.push(...collectFiles(absolute, relative));
    } else if (item.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`${relative} must be a regular file or directory.`);
    }
  }
  return files;
}

export function loadSkillCatalog(): {
  skills: SkillEntry[];
  resources: Map<string, SkillResource>;
} {
  const skills: SkillEntry[] = [];
  const resources = new Map<string, SkillResource>();

  const directories = readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const directory of directories) {
    const skillDirectory = path.join(SKILLS_ROOT, directory.name);
    const files = collectFiles(skillDirectory);
    if (!files.includes('SKILL.md')) {
      throw new Error(`${directory.name} is missing SKILL.md.`);
    }
    if (files.length > MAX_SKILL_FILES) {
      throw new Error(
        `${directory.name} has ${files.length} files; the import limit is ${MAX_SKILL_FILES}.`
      );
    }
    const normalizedPaths = files.map((file) => file.normalize('NFC').toLowerCase());
    if (new Set(normalizedPaths).size !== normalizedPaths.length) {
      throw new Error(`${directory.name} has normalization-conflicting resource paths.`);
    }

    let totalBytes = 0;
    const skillResources: SkillResource[] = files.map((relative) => {
      const bytes = readFileSync(path.join(skillDirectory, relative));
      const limit = relative === 'SKILL.md' ? MAX_MANIFEST_BYTES : MAX_RESOURCE_BYTES;
      if (bytes.byteLength > limit) {
        throw new Error(`${directory.name}/${relative} exceeds ${limit} bytes.`);
      }
      totalBytes += bytes.byteLength;
      let text: string;
      try {
        text = TEXT_DECODER.decode(bytes);
      } catch {
        throw new Error(`${directory.name}/${relative} must be valid UTF-8 text.`);
      }
      const extension = path.extname(relative).toLowerCase();
      const mimeType =
        extension === '.md'
          ? 'text/markdown'
          : extension === '.yaml' || extension === '.yml'
            ? 'text/yaml'
            : null;
      if (!mimeType) {
        throw new Error(
          `${directory.name}/${relative} has an unsupported text resource type.`
        );
      }
      const uri = `${SKILL_URI_PREFIX}${directory.name}/${relative}`;
      const resource = {
        uri,
        digest: sha256(text),
        mimeType,
        text,
      };
      resources.set(uri, resource);
      return resource;
    });
    if (totalBytes > MAX_SKILL_BYTES) {
      throw new Error(`${directory.name} exceeds ${MAX_SKILL_BYTES} total bytes.`);
    }

    const manifest = skillResources.find((resource) =>
      resource.uri.endsWith('/SKILL.md')
    );
    if (!manifest) {
      throw new Error(`${directory.name} is missing its skill manifest resource.`);
    }
    const frontmatter = parseFrontmatter(manifest.text, manifest.uri);
    if (frontmatter.name !== directory.name) {
      throw new Error(
        `${manifest.uri} declares name ${frontmatter.name}; expected ${directory.name}.`
      );
    }

    skills.push({
      uri: manifest.uri,
      frontmatter,
      resources: skillResources.map(({ uri, digest }) => ({ uri, digest })),
    });
  }

  if (skills.length === 0 || skills.length > 5) {
    throw new Error(`OpenAI skill import supports 1-5 skills; found ${skills.length}.`);
  }

  return { skills, resources };
}

const SkillsListRequestSchema = z.object({
  method: z.literal('skills/list'),
  params: z
    .object({
      cursor: z.string().optional(),
    })
    .optional(),
});

const SkillsGetRequestSchema = z.object({
  method: z.literal('skills/get'),
  params: z.object({
    uri: z.string(),
  }),
});

/** Advertise and serve OpenAI's bounded draft Skills extension. */
export function registerPostSiderSkills(server: McpServer): void {
  const catalog = loadSkillCatalog();

  server.server.registerCapabilities({
    extensions: {
      'io.modelcontextprotocol/skills': {},
    },
  });

  server.server.setRequestHandler(SkillsListRequestSchema, async (request) => {
    if (request.params?.cursor) {
      return { skills: [] };
    }
    return { skills: catalog.skills };
  });

  server.server.setRequestHandler(SkillsGetRequestSchema, async (request) => {
    const skill = catalog.skills.find((item) => item.uri === request.params.uri);
    if (!skill) {
      throw new Error('Unknown skill URI.');
    }
    return { skill };
  });

  for (const resource of catalog.resources.values()) {
    server.registerResource(
      resource.uri,
      resource.uri,
      {
        title: resource.uri.split('/').at(-1) ?? resource.uri,
        mimeType: resource.mimeType,
      },
      async () => ({
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.text,
          },
        ],
      })
    );
  }
}
