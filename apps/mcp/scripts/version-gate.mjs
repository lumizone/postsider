#!/usr/bin/env node
/**
 * Version gate for the @postsider/mcp release.
 *
 * A published package must agree with itself everywhere a version is stated:
 * package.json, the Claude Code plugin manifest, the MCP Registry server.json,
 * the server version reported in `initialize`, the pinned version the plugin
 * starts over npx, and the release tag itself.
 *
 * It also refuses to let a release ship the "not published yet" marker that the
 * README carries before the first npm release.
 *
 * Exits non-zero on any mismatch, so the release job fails before npm is touched.
 *
 * Usage: node scripts/version-gate.mjs            (version consistency only)
 *        GITHUB_REF=refs/tags/mcp-v1.0.0 node scripts/version-gate.mjs
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TAG_PREFIX = 'mcp-v';

/**
 * The marker the README and the docs carry until the first npm release is
 * confirmed. It must not ship inside a release tarball.
 */
const RELEASE_MARKER = 'RELEASE_NOT_VERIFIED';

const problems = [];

function readJson(relativePath, { required }) {
  const full = path.join(PKG_DIR, relativePath);
  try {
    return JSON.parse(readFileSync(full, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && !required) {
      console.log(`- ${relativePath}: absent (skipped)`);
      return null;
    }
    throw new Error(`cannot read ${relativePath}: ${error.message}`);
  }
}

function readTextIfPresent(relativePath) {
  try {
    return readFileSync(path.join(PKG_DIR, relativePath), 'utf8');
  } catch {
    return null;
  }
}

const pkg = readJson('package.json', { required: true });
const plugin = readJson('.claude-plugin/plugin.json', { required: true });
const server = readJson('server.json', { required: false });
const mcpConfig = readJson('.mcp.json', { required: false });

const versions = new Map([['package.json', pkg.version]]);
if (plugin) {
  versions.set('.claude-plugin/plugin.json', plugin.version);
}
if (server) {
  versions.set('server.json', server.version);
}

const distinct = new Set(versions.values());
if (distinct.size !== 1) {
  problems.push(
    `version mismatch: ${[...versions.entries()]
      .map(([file, version]) => `${file}=${version}`)
      .join(', ')}`
  );
}

if (!pkg.version) {
  problems.push('package.json has no version');
}
if (server && !pkg.mcpName) {
  problems.push('package.json declares no mcpName, but server.json exists');
}
if (server && pkg.mcpName !== server.name) {
  problems.push(
    `mcpName (${pkg.mcpName}) does not match server.json name (${server.name})`
  );
}
if (server && Array.isArray(server.packages)) {
  for (const entry of server.packages) {
    if (entry.identifier !== pkg.name) {
      problems.push(
        `server.json package identifier ${entry.identifier} does not match package name ${pkg.name}`
      );
    }
    if (entry.version !== pkg.version) {
      problems.push(
        `server.json package version ${entry.version} does not match package version ${pkg.version}`
      );
    }
  }
}

// The version an MCP client prints for this server comes from a constant in the
// source, not from package.json, so it is a second place to drift.
const serverSource = readTextIfPresent('src/server.ts');
if (serverSource) {
  const match = serverSource.match(
    /POSTSIDER_MCP_SERVER_VERSION\s*=\s*'([^']+)'/
  );
  if (!match) {
    problems.push(
      'src/server.ts declares no POSTSIDER_MCP_SERVER_VERSION, so the reported server version cannot be checked'
    );
  } else if (match[1] !== pkg.version) {
    problems.push(
      `src/server.ts POSTSIDER_MCP_SERVER_VERSION (${match[1]}) does not match package version (${pkg.version})`
    );
  }
}

// The Claude Code plugin starts an exact published version through npx, so a
// stale pin would install a different build than the one being released.
const packageSpec = mcpConfig?.mcpServers?.postsider?.args?.find?.(
  (arg) => typeof arg === 'string' && arg.startsWith(`${pkg.name}@`)
);
if (mcpConfig && !packageSpec) {
  problems.push(
    `.mcp.json does not start ${pkg.name}@<version>; pin the released version instead of a floating range`
  );
} else if (packageSpec) {
  const pinned = packageSpec.slice(`${pkg.name}@`.length);
  if (pinned !== pkg.version) {
    problems.push(
      `.mcp.json pins ${pkg.name}@${pinned}, which does not match package version ${pkg.version}`
    );
  }
}

const ref = process.env.GITHUB_REF ?? '';
const tagRun = ref.startsWith(`refs/tags/${TAG_PREFIX}`);
if (ref.startsWith('refs/tags/')) {
  const tag = ref.slice('refs/tags/'.length);
  if (tag.startsWith(TAG_PREFIX)) {
    const tagVersion = tag.slice(TAG_PREFIX.length);
    if (tagVersion !== pkg.version) {
      problems.push(`tag ${tag} implies ${tagVersion}, package is ${pkg.version}`);
    } else {
      console.log(`- tag ${tag} matches the package version`);
    }
  } else {
    console.log(`- tag ${tag} is not a ${TAG_PREFIX}<version> release tag (no tag check)`);
  }
}

// A release tag is the last moment this can be caught: README.md ships inside
// the tarball, so a "not published yet" banner in it would ship to every user.
if (tagRun) {
  const readme = readTextIfPresent('README.md') ?? '';
  if (readme.includes(RELEASE_MARKER)) {
    problems.push(
      `README.md still carries the ${RELEASE_MARKER} marker: the first npm release is being made, so remove the banner (and update docs_site/cloud/mcp.mdx) before tagging`
    );
  }
}

console.log('Version gate:');
for (const [file, version] of versions) {
  console.log(`- ${file}: ${version}`);
}
if (pkg.mcpName) {
  console.log(`- mcpName: ${pkg.mcpName}`);
}
if (packageSpec) {
  console.log(`- .mcp.json pin: ${packageSpec}`);
}
if (serverSource) {
  console.log('- src/server.ts version: checked');
}

if (problems.length) {
  console.error('\nVERSION GATE FAILED:');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}

console.log('\nVERSION GATE PASS');
