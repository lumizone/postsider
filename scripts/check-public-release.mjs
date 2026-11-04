#!/usr/bin/env node
/**
 * Public, read-only release probe. No registration, payment, tokens or posts.
 *
 *   node scripts/check-public-release.mjs
 *   POSTSIDER_SMOKE_READ_API_KEY=<READ_ONLY_NAMED_KEY> node scripts/check-public-release.mjs
 *
 * The optional key is only used for GET /public/v1/integrations. Never pass a
 * write-enabled key. Report only status/shape; never log credentials or user data.
 */
const site = 'https://postsider.com';
const app = 'https://app.postsider.com';
const api = 'https://api.postsider.com';
const mcp = 'https://mcp.postsider.com';
const readKey = process.env.POSTSIDER_SMOKE_READ_API_KEY || '';
const checks = [];

async function probe(label, url, { method = 'GET', expected = 200, headers = {}, body, inspect } = {}) {
  try {
    const response = await fetch(url, {
      method, headers, body,
      redirect: 'manual',
      signal: AbortSignal.timeout(12000),
    });
    if (response.status !== expected) {
      throw new Error('HTTP ' + response.status + ' (expected ' + expected + ')');
    }
    const text = await response.text();
    if (inspect && !inspect({ response, text })) {
      throw new Error('Response body or headers did not meet the contract');
    }
    checks.push({ label, ok: true, status: response.status });
    console.log('PASS  ' + label + ' (HTTP ' + response.status + ')');
  } catch (error) {
    checks.push({ label, ok: false });
    console.error('FAIL  ' + label + ': ' + (error?.message || 'Unknown error'));
  }
}

const isWeb = ({ response, text }) =>
  (response.headers.get('content-type') || '').includes('text/html') &&
  text.includes('PostSider');

await probe('marketing homepage', site + '/', { inspect: isWeb });
await probe('pricing page', site + '/pricing/', { inspect: isWeb });
await probe('developer quickstart', site + '/developers/', { inspect: isWeb });
await probe('application registration page', app + '/register', { inspect: isWeb });
await probe('Public API rejects missing credentials', api + '/public/v1/integrations', {
  expected: 401,
});
await probe('MCP health', mcp + '/healthz', {
  inspect: ({ text }) => {
    try { return JSON.parse(text)?.status === 'ok'; } catch { return false; }
  },
});
await probe('MCP OAuth discovery', mcp + '/.well-known/oauth-protected-resource', {
  inspect: ({ text }) => {
    try {
      const document = JSON.parse(text);
      return typeof document.resource === 'string' &&
        Array.isArray(document.authorization_servers) &&
        document.authorization_servers.length > 0;
    } catch { return false; }
  },
});
await probe('MCP rejects unauthenticated tool calls', mcp + '/mcp', {
  method: 'POST',
  expected: 401,
  headers: {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 'release-probe', method: 'tools/list' }),
  inspect: ({ response }) =>
    (response.headers.get('www-authenticate') || '').toLowerCase().startsWith('bearer'),
});

if (readKey) {
  await probe('read-only test API key lists channels', api + '/public/v1/integrations', {
    headers: { Authorization: readKey },
    inspect: ({ text }) => {
      try { return Array.isArray(JSON.parse(text)); } catch { return false; }
    },
  });
} else {
  console.log('SKIP  Optional read-only key probe; POSTSIDER_SMOKE_READ_API_KEY is unset');
}

const failed = checks.filter((item) => !item.ok);
console.log('\nRelease probe: ' + (checks.length - failed.length) + '/' + checks.length +
  ' passed; ' + failed.length + ' failed. No content or payment was changed.');
process.exitCode = failed.length ? 1 : 0;
