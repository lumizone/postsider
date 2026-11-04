import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./smoke-public-api.mjs', import.meta.url));

function run(args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, POSTSIDER_API_KEY: 'test-only-fake-key', POSTSIDER_API_URL: 'https://invalid.example' },
    encoding: 'utf8',
    timeout: 3000,
  });
  assert.equal(result.error, undefined, 'smoke guard must not make network requests');
  return result;
}

test('requires an explicitly named test channel before any writes', () => {
  const result = run(['--yes']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Explicit --channel/);
});

test('rejects --schedule, even with explicit consent and a channel', () => {
  const result = run(['--yes', '--channel', 'disposable-test-channel', '--schedule']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /disabled for production smoke/);
});

test('requires --yes even with a selected test channel', () => {
  const result = run(['--channel', 'disposable-test-channel']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Re-run with --yes/);
});
