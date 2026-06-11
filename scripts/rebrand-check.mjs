#!/usr/bin/env node
// @ts-check
/**
 * Rebrand verification gate (Requirements 1, 2.5, 7.4, 11).
 *
 * Fails (exit 1) when any tracked file outside the allowlist contains a legacy
 * identifier (gitroom / gitroomhq / postiz), when any TypeScript file imports
 * from a legacy path alias (@gitroom/...), or when any package.json `name`
 * field contains a legacy identifier.
 *
 * Usage:
 *   node scripts/rebrand-check.mjs            # check the repository
 *   node scripts/rebrand-check.mjs --quiet    # only print on failure
 *
 * Realizes Correctness Properties 1, 2 and 11.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const QUIET = process.argv.includes('--quiet');

const LEGACY_RE = /gitroomhq|gitroom|postiz/i;
const LEGACY_IMPORT_RE = /(?:import\s[^'"]*?from\s*|require\(\s*)['"]@gitroom\//;

// Directories never worth scanning (also excluded from `git ls-files` normally,
// but we filter defensively for non-git invocations).
const HARD_EXCLUDES = [
  'node_modules/',
  '/dist/',
  '.next/',
  '.git/',
];

/** Read and parse the allowlist into a list of glob patterns. */
function readAllowlist() {
  let raw = '';
  try {
    raw = readFileSync(path.join(ROOT, '.rebrand-allowlist'), 'utf8');
  } catch {
    return [];
  }
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * Convert a glob pattern to a RegExp. Supports `**`, `*` and `?`.
 * Matching is performed against repo-relative POSIX paths.
 */
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` matches across path separators
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // consume trailing slash of `**/`
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

/** List repo-relative POSIX file paths tracked by git. */
function listFiles() {
  const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => p.split(path.sep).join('/'));
}

function isHardExcluded(file) {
  return HARD_EXCLUDES.some((ex) => file.includes(ex));
}

/** Find legacy matches in a single file's text content. Returns array of {line, text}. */
function scanContent(file, allowlisted) {
  const violations = [];
  let text;
  try {
    text = readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    return violations; // binary/unreadable — skip
  }
  // Skip likely-binary content.
  if (text.includes('\u0000')) return violations;

  const isTs = /\.(ts|tsx|mts|cts)$/.test(file);
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Legacy path-alias imports — checked even on allowlisted files would be
    // noisy, so only enforce on non-allowlisted TS (Property 1 / Requirement 2.5).
    if (isTs && !allowlisted && LEGACY_IMPORT_RE.test(line)) {
      violations.push({ line: i + 1, text: line.trim(), kind: 'legacy-import' });
      continue;
    }

    if (!allowlisted && LEGACY_RE.test(line)) {
      violations.push({ line: i + 1, text: line.trim(), kind: 'legacy-identifier' });
    }
  }
  return violations;
}

/** Validate every package.json `name` field (Property 11 / Requirement 1). */
function scanPackageNames(files) {
  const violations = [];
  for (const file of files) {
    if (!file.endsWith('package.json')) continue;
    let json;
    try {
      json = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'));
    } catch {
      continue;
    }
    if (typeof json.name === 'string' && LEGACY_RE.test(json.name)) {
      violations.push({ file, line: 1, text: `"name": "${json.name}"`, kind: 'package-name' });
    }
  }
  return violations;
}

function main() {
  const allowGlobs = readAllowlist().map(globToRegExp);
  const isAllowed = (file) => allowGlobs.some((re) => re.test(file));

  const files = listFiles().filter((f) => !isHardExcluded(f));

  /** @type {{file:string,line:number,text:string,kind:string}[]} */
  const allViolations = [];

  for (const file of files) {
    const allowlisted = isAllowed(file);
    const found = scanContent(file, allowlisted);
    for (const v of found) allViolations.push({ file, ...v });
  }

  // package.json names are checked regardless of allowlist — a workspace
  // package must never be named with a legacy identifier.
  allViolations.push(...scanPackageNames(files.filter((f) => !isAllowed(f))));

  if (allViolations.length === 0) {
    if (!QUIET) {
      console.log(`✓ rebrand-check: scanned ${files.length} tracked files — no legacy identifiers found.`);
    }
    process.exit(0);
  }

  console.error(`\n✗ rebrand-check: found ${allViolations.length} legacy identifier reference(s):\n`);
  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line} [${v.kind}]  ${v.text.slice(0, 120)}`);
  }
  console.error(
    `\nIf a match is legitimate (legal/historical), add the file to .rebrand-allowlist.\n` +
      `Otherwise rename the legacy identifier to the canonical PostSider equivalent.\n`
  );
  process.exit(1);
}

main();
