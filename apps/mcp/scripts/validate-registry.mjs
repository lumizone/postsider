#!/usr/bin/env node
/**
 * Validate `server.json` against the MCP Registry schema it declares.
 *
 * The registry rejects a `server.json` that does not match its schema, and the
 * schema is versioned and has changed repeatedly (2025-09-29 -> 2025-12-11 at the
 * time of writing). A field as innocent as `description` is capped at 100
 * characters, which is exactly the kind of defect that only shows up at
 * submission time, after the npm release is already public. So this runs as a
 * gate before publishing.
 *
 * The schema is fetched from the URL in `$schema` (the source of truth), so a
 * future schema revision is validated as soon as `$schema` is bumped.
 *
 * Needs network access: it downloads the schema document.
 *
 * Usage: node scripts/validate-registry.mjs   (or: pnpm run validate:registry)
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_JSON = path.join(PKG_DIR, 'server.json');

function fail(message, details) {
  console.error(`REGISTRY VALIDATION FAILED: ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

let server;
try {
  server = JSON.parse(readFileSync(SERVER_JSON, 'utf8'));
} catch (error) {
  fail(`cannot read server.json: ${error.message}`);
}

const schemaUrl = server.$schema;
if (typeof schemaUrl !== 'string' || !schemaUrl.startsWith('https://')) {
  fail('server.json must declare an absolute https $schema URL');
}

let schema;
try {
  const res = await fetch(schemaUrl, {
    signal: AbortSignal.timeout(20_000),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    fail(`could not download the schema from ${schemaUrl} (HTTP ${res.status})`);
  }
  schema = await res.json();
} catch (error) {
  fail(
    `could not download the schema from ${schemaUrl}: ${error.message}`,
    'This gate needs network access to validate against the published registry schema.'
  );
}

// `logger: false` silences Ajv's "$ref siblings ignored" notice: the schema's
// root carries only $comment/$id/$schema/definitions next to its $ref, so the
// notice is noise rather than a validation gap.
const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
if (!ajv.validate(schema, server)) {
  const details = (ajv.errors ?? [])
    .map((error) => `  - ${error.dataPath || '/'} ${error.message}`)
    .join('\n');
  fail(`server.json does not match ${schemaUrl}`, details);
}

// The name is what the registry uses for ownership: it must be the package's
// `mcpName`, and it must be in a namespace the publishing identity can claim.
const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'));
if (pkg.mcpName !== server.name) {
  fail(`server.json name (${server.name}) does not match package.json mcpName (${pkg.mcpName})`);
}
if (!/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(server.name)) {
  fail(`server.json name "${server.name}" is not in <namespace>/<server> form`);
}

console.log('Registry validation:');
console.log(`- schema: ${schemaUrl}`);
console.log(`- name: ${server.name}`);
console.log(`- version: ${server.version}`);
console.log(`- description: ${server.description.length} chars (limit 100)`);
console.log(`- packages: ${server.packages?.length ?? 0}`);

console.log('\nREGISTRY VALIDATION PASS');
