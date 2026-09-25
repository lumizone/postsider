#!/usr/bin/env node
/**
 * Tarball smoke test.
 *
 * Packs the package, installs the resulting `.tgz` into a throwaway directory
 * OUTSIDE this repository, then drives the installed bin over stdio: initialize,
 * tools/list, and the missing-key exit path.
 *
 * The point is that nothing here may touch the worktree build output. The script
 * resolves the installed entry by real path and fails unless it lives inside the
 * throwaway directory, so a broken `files` glob or a stale `dist` cannot make
 * this pass.
 *
 * Usage: node scripts/tarball-smoke.mjs   (or: pnpm run smoke:tarball)
 */
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_TOOL_COUNT = 19;
const EXPECTED_SERVER_NAME = 'postsider';
const API_KEY = 'tarball-smoke-key';

function fail(message) {
  console.error(`SMOKE FAIL: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'pipe', encoding: 'utf8', ...options });
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(' ')} exited ${result.status}\n${result.stdout ?? ''}${result.stderr ?? ''}`
    );
  }
  return result;
}

const workDir = mkdtempSync(path.join(os.tmpdir(), 'postsider-mcp-smoke-'));
const packDir = path.join(workDir, 'tgz');
const installDir = path.join(workDir, 'consumer');

try {
  mkdirSync(packDir, { recursive: true });
  mkdirSync(installDir, { recursive: true });

  // 1. Pack from source. `prepack` cleans and rebuilds, so the tarball can never
  //    carry a stale dist.
  console.log('1/5 packing...');
  run('npm', ['pack', '--pack-destination', packDir], { cwd: PKG_DIR });
  const tarball = readdirSync(packDir)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => path.join(packDir, name))[0];
  if (!tarball) {
    fail('npm pack produced no .tgz');
  }

  // 2. Install it into the throwaway consumer directory.
  console.log('2/5 installing the tarball into a temp consumer...');
  writeFileSync(
    path.join(installDir, 'package.json'),
    `${JSON.stringify({ name: 'smoke-consumer', version: '0.0.0', private: true }, null, 2)}\n`
  );
  run('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: installDir });

  // The installed artifact must be clean on production dependencies. This is a
  // required gate, so it fails the run rather than printing a warning.
  run('npm', ['audit', '--omit=dev', '--audit-level=high'], { cwd: installDir });
  console.log('    installed artifact audits clean (production dependencies only)');

  // 3. Resolve the INSTALLED entry and prove it is not the worktree build.
  console.log('3/5 resolving the installed bin...');
  const installedPkgDir = path.join(installDir, 'node_modules', '@postsider', 'mcp');
  const installedEntry = path.join(installedPkgDir, 'dist', 'index.js');
  const installedBin = path.join(installDir, 'node_modules', '.bin', 'postsider-mcp');

  const realEntry = realpathSync(installedEntry);
  const realInstallDir = realpathSync(installDir);
  const worktreeDist = path.join(PKG_DIR, 'dist');

  if (!realEntry.startsWith(`${realInstallDir}${path.sep}`)) {
    fail(`installed entry resolved outside the temp consumer: ${realEntry}`);
  }
  if (realEntry.startsWith(`${worktreeDist}${path.sep}`) || realEntry.startsWith(`${realpathSync(PKG_DIR)}${path.sep}`)) {
    fail(`resolved entry came from the worktree, not the tarball: ${realEntry}`);
  }
  accessSync(installedBin, constants.X_OK);
  console.log(`    installed entry: ${realEntry}`);
  console.log(`    installed bin is executable: ${installedBin}`);

  // File modes travel into the tarball, so a file created with a restrictive
  // mode ships readable only by its owner. This must be checked on the TARBALL
  // entries, not on the npm-installed copy: `npm install` normalizes extraction
  // modes and would mask the defect that exists in the published artifact.
  const extractDir = path.join(workDir, 'extracted');
  mkdirSync(extractDir, { recursive: true });
  run('tar', ['-xzf', tarball, '-C', extractDir]);

  const packaged = path.join(extractDir, 'package');
  const entries = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        entries.push(full);
      }
    }
  };
  walk(packaged);

  const ownerOnly = entries.filter(
    (file) => (statSync(file).mode & 0o044) !== 0o044
  );
  if (ownerOnly.length) {
    fail(
      `tarball entries are not readable by group/other: ${ownerOnly
        .map((file) => path.relative(extractDir, file))
        .join(', ')}`
    );
  }
  const packagedEntry = path.join(packaged, 'dist', 'index.js');
  if (!entries.includes(packagedEntry)) {
    fail('tarball does not contain dist/index.js');
  }
  if ((statSync(packagedEntry).mode & 0o111) === 0) {
    fail('tarball dist/index.js is not executable');
  }

  // `files` silently omits anything that does not exist, so a rename or a typo
  // would drop a promised file from the published package without any error.
  const requiredEntries = [
    'package.json',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'server.json',
    '.mcp.json',
    '.claude-plugin/plugin.json',
    'skills/postsider-workflow/SKILL.md',
    'dist/index.js',
    'dist/client.js',
    'dist/server.js',
    'dist/post-body.js',
  ];
  const shippedPaths = entries.map((file) =>
    path.relative(packaged, file).split(path.sep).join('/')
  );
  const missing = requiredEntries.filter((name) => !shippedPaths.includes(name));
  if (missing.length) {
    fail(`tarball is missing required entries: ${missing.join(', ')}`);
  }
  console.log(
    `    ${entries.length} tarball entries are readable, all ${requiredEntries.length} required entries present, dist/index.js is executable`
  );

  const installedManifest = JSON.parse(
    readFileSync(path.join(installedPkgDir, 'package.json'), 'utf8')
  );
  if (installedManifest.version !== JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')).version) {
    fail('installed version does not match the packed version');
  }

  // 4. Drive the installed bin over stdio.
  console.log('4/5 speaking MCP to the installed bin...');
  const speak = async (envOverrides) => {
    const env = { ...process.env, POSTSIDER_API_KEY: API_KEY, ...envOverrides };
    if (envOverrides.POSTSIDER_API_KEY === undefined && 'POSTSIDER_API_KEY' in envOverrides) {
      delete env.POSTSIDER_API_KEY;
    }

    // Spawning the bin directly exercises the shebang and the executable bit.
    const child = spawn(installedBin, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });

    let buffered = '';
    let stderrText = '';
    let stdoutText = '';
    const stray = [];
    const replies = new Map();

    child.stdout.on('data', (chunk) => {
      stdoutText += chunk.toString('utf8');
      buffered += chunk.toString('utf8');
      for (;;) {
        const index = buffered.indexOf('\n');
        if (index === -1) break;
        const line = buffered.slice(0, index);
        buffered = buffered.slice(index + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id !== undefined) replies.get(message.id)?.(message);
        } catch {
          stray.push(line);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrText += chunk.toString('utf8');
    });

    const request = (id, method, params) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no reply to ${method} within 10s`)),
          10_000
        );
        replies.set(id, (message) => {
          clearTimeout(timer);
          resolve(message);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });

    /** Wait for the process to end on its own, without signalling it. */
    const waitExit = (timeoutMs = 15_000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('process did not exit on its own')),
          timeoutMs
        );
        child.once('close', (code) => {
          clearTimeout(timer);
          resolve(code);
        });
      });

    /** Terminate an interactive session. */
    const close = () =>
      new Promise((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve(child.exitCode);
          return;
        }
        child.once('close', (code) => resolve(code));
        child.kill();
      });

    return { request, close, waitExit, stray, stdout: () => stdoutText, stderr: () => stderrText };
  };

  const session = await speak({ POSTSIDER_API_KEY: API_KEY });
  const init = await session.request(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'tarball-smoke', version: '1.0.0' },
  });
  if (init.error) {
    fail(`initialize failed: ${JSON.stringify(init.error)}`);
  }
  const serverName = init.result?.serverInfo?.name;
  if (serverName !== EXPECTED_SERVER_NAME) {
    fail(
      `initialize reported server name ${JSON.stringify(serverName)}, expected ${JSON.stringify(EXPECTED_SERVER_NAME)}`
    );
  }
  const listed = await session.request(2, 'tools/list');
  if (listed.error) {
    fail(`tools/list failed: ${JSON.stringify(listed.error)}`);
  }
  const tools = listed.result?.tools ?? [];
  if (tools.length !== EXPECTED_TOOL_COUNT) {
    fail(`expected ${EXPECTED_TOOL_COUNT} tools from the installed artifact, got ${tools.length}`);
  }

  // Compare exact names against what the SOURCE registers, so the installed
  // artifact is checked for the real surface rather than only the right count.
  // Reading the source here keeps this independent of the built artifact it tests.
  const serverSource = readFileSync(path.join(PKG_DIR, 'src', 'server.ts'), 'utf8');
  const registered = [
    ...serverSource.matchAll(/registerTool\(\s*'([a-z0-9_]+)'/g),
  ]
    .map((match) => match[1])
    .sort();
  if (registered.length !== EXPECTED_TOOL_COUNT) {
    fail(
      `src/server.ts registers ${registered.length} tools, expected ${EXPECTED_TOOL_COUNT}`
    );
  }
  const inventorySource = readFileSync(
    path.join(PKG_DIR, 'src', '__tests__', 'tool-inventory.ts'),
    'utf8'
  );
  const inventoryBlock = inventorySource.match(
    /EXPECTED_TOOL_NAMES\s*=\s*\[([\s\S]*?)\]:?\s*as const/
  );
  if (!inventoryBlock) {
    fail('could not read EXPECTED_TOOL_NAMES from tool-inventory.ts');
  }
  const frozen = [...inventoryBlock[1].matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .sort();
  if (frozen.length !== EXPECTED_TOOL_COUNT) {
    fail(
      `tool-inventory.ts lists ${frozen.length} names, expected ${EXPECTED_TOOL_COUNT}`
    );
  }

  const installedNames = tools.map((tool) => tool.name).sort();
  if (installedNames.join(',') !== frozen.join(',')) {
    fail(
      'installed tool names differ from the frozen expectation list:\n' +
        `  installed: ${installedNames.join(', ')}\n` +
        `  expected:  ${frozen.join(', ')}`
    );
  }

  if (installedNames.join(',') !== registered.join(',')) {
    fail(
      'installed tool names differ from the source registrations:\n' +
        `  installed: ${installedNames.join(', ')}\n` +
        `  source:    ${registered.join(', ')}`
    );
  }
  if (session.stray.length) {
    fail(`non-protocol bytes on stdout: ${JSON.stringify(session.stray.slice(0, 3))}`);
  }
  await session.close();
  console.log(`    install handshake ok, ${tools.length} tools, stdout clean`);

  // 5. The missing-key path must exit 1 with an empty stdout.
  console.log('5/5 checking the missing-key path...');
  const noKeySession = await speak({ POSTSIDER_API_KEY: undefined });
  const exitCode = await noKeySession.waitExit();
  if (exitCode !== 1) {
    fail(`missing key should exit 1, exited ${exitCode}`);
  }
  if (noKeySession.stdout() !== '') {
    fail(`missing key wrote to stdout: ${JSON.stringify(noKeySession.stdout().slice(0, 200))}`);
  }
  if (noKeySession.stderr().indexOf('POSTSIDER_API_KEY is not set') === -1) {
    fail('missing-key path did not explain POSTSIDER_API_KEY on stderr');
  }

  console.log('\nTARBALL SMOKE PASS');
  console.log(`  tarball: ${path.basename(tarball)}`);
  console.log(`  installed at: ${realInstallDir}`);
  console.log(`  tools: ${tools.length}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
