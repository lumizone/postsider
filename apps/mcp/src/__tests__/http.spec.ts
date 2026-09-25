import { afterAll, describe, expect, it } from '@jest/globals';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_API_URL,
  DEFAULT_AUTHORIZATION_SERVER_URL,
  DEFAULT_PUBLIC_URL,
  DEFAULT_RATE_LIMIT_PER_MINUTE,
  loadHttpConfig,
  type HttpConfig,
} from '../http/config.js';
import { bearerChallenge, protectedResourceMetadata } from '../http/well-known.js';
import { createHttpServer } from '../http/server.js';

const TEST_PUBLIC_URL = 'https://mcp.test.postsider.com';
const TEST_AS_URL = 'https://api.test.postsider.com';

function testConfig(overrides: Partial<HttpConfig> = {}): HttpConfig {
  return {
    publicUrl: TEST_PUBLIC_URL,
    authorizationServerUrl: TEST_AS_URL,
    apiBaseUrl: TEST_AS_URL,
    scopesSupported: ['posts:read', 'posts:write'],
    introspectionSecret: 'test-introspection-secret',
    port: 0,
    bindHost: '127.0.0.1',
    rateLimitPerMinute: 240,
    ...overrides,
  };
}

async function startServer(config: HttpConfig): Promise<{ server: Server; base: string }> {
  const server = createHttpServer(config);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}` };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('loadHttpConfig', () => {
  it('applies production defaults with no environment', () => {
    const config = loadHttpConfig({});
    expect(config.publicUrl).toBe(DEFAULT_PUBLIC_URL);
    expect(config.authorizationServerUrl).toBe(DEFAULT_AUTHORIZATION_SERVER_URL);
    expect(config.scopesSupported).toEqual(['posts:read', 'posts:write']);
    expect(config.port).toBe(8080);
    expect(config.bindHost).toBe('0.0.0.0');
    expect(config.apiBaseUrl).toBe(DEFAULT_API_URL);
    expect(config.rateLimitPerMinute).toBe(DEFAULT_RATE_LIMIT_PER_MINUTE);
    expect(config.introspectionSecret).toBeUndefined();
    expect(config.openaiAppsChallengeToken).toBeUndefined();
  });

  it('reads the introspection secret, API URL and rate limit, ignoring blanks', () => {
    const config = loadHttpConfig({
      MCP_INTROSPECTION_SECRET: ' shared-secret ',
      MCP_API_URL: 'https://api.internal.test',
      MCP_RATE_LIMIT_RPM: '60',
    });
    expect(config.introspectionSecret).toBe('shared-secret');
    expect(config.apiBaseUrl).toBe('https://api.internal.test');
    expect(config.rateLimitPerMinute).toBe(60);

    const blank = loadHttpConfig({ MCP_INTROSPECTION_SECRET: '   ' });
    expect(blank.introspectionSecret).toBeUndefined();
  });

  it('rejects a non-positive MCP_RATE_LIMIT_RPM with the variable name', () => {
    expect(() => loadHttpConfig({ MCP_RATE_LIMIT_RPM: 'abc' })).toThrow(
      /MCP_RATE_LIMIT_RPM/
    );
    expect(() => loadHttpConfig({ MCP_RATE_LIMIT_RPM: '0' })).toThrow(
      /MCP_RATE_LIMIT_RPM/
    );
  });

  it('rejects a plain-HTTP MCP_API_URL off loopback', () => {
    expect(() =>
      loadHttpConfig({ MCP_API_URL: 'http://api.postsider.com' })
    ).toThrow(/MCP_API_URL/);
  });

  it('rejects a plain-HTTP public URL off loopback', () => {
    expect(() => loadHttpConfig({ MCP_PUBLIC_URL: 'http://mcp.postsider.com' })).toThrow(
      /HTTPS/
    );
  });

  it('accepts plain HTTP on loopback only', () => {
    const config = loadHttpConfig({ MCP_PUBLIC_URL: 'http://localhost:3000' });
    expect(config.publicUrl).toBe('http://localhost:3000');
    expect(() => loadHttpConfig({ MCP_AUTHORIZATION_SERVER_URL: 'http://127.0.0.1:3001' })).not.toThrow();
  });

  it('rejects a non-URL value with the variable name in the message', () => {
    expect(() => loadHttpConfig({ MCP_PUBLIC_URL: 'not a url' })).toThrow(
      /MCP_PUBLIC_URL/
    );
  });

  it('rejects an out-of-range or non-numeric MCP_PORT', () => {
    expect(() => loadHttpConfig({ MCP_PORT: 'abc' })).toThrow(/MCP_PORT/);
    expect(() => loadHttpConfig({ MCP_PORT: '70000' })).toThrow(/MCP_PORT/);
    expect(() => loadHttpConfig({ MCP_PORT: '0' })).toThrow(/MCP_PORT/);
  });

  it('strips trailing slashes so discovery URLs cannot double up', () => {
    const config = loadHttpConfig({ MCP_PUBLIC_URL: 'https://mcp.postsider.com/' });
    expect(config.publicUrl).toBe('https://mcp.postsider.com');
  });

  it('reads the challenge token and scopes, ignoring blank values', () => {
    const config = loadHttpConfig({
      MCP_OPENAI_APPS_CHALLENGE: 'token-abc',
      MCP_SCOPES: 'posts:read, posts:write , ',
    });
    expect(config.openaiAppsChallengeToken).toBe('token-abc');
    expect(config.scopesSupported).toEqual(['posts:read', 'posts:write']);

    const blank = loadHttpConfig({ MCP_OPENAI_APPS_CHALLENGE: '   ' });
    expect(blank.openaiAppsChallengeToken).toBeUndefined();
  });
});

describe('protected-resource metadata', () => {
  it('points clients at the PostSider authorization server', () => {
    const metadata = protectedResourceMetadata(testConfig());
    expect(metadata.resource).toBe(TEST_PUBLIC_URL);
    expect(metadata.authorization_servers).toEqual([TEST_AS_URL]);
    expect(metadata.scopes_supported).toEqual(['posts:read', 'posts:write']);
    expect(metadata.bearer_methods_supported).toEqual(['header']);
  });

  it('builds a spec-shaped WWW-Authenticate challenge', () => {
    expect(bearerChallenge(testConfig())).toBe(
      `Bearer resource_metadata="${TEST_PUBLIC_URL}/.well-known/oauth-protected-resource"`
    );
  });
});

describe('remote MCP http surface', () => {
  let server: Server;
  let base: string;

  afterAll(async () => {
    if (server) await closeServer(server);
  });

  it('serves OAuth discovery metadata', async () => {
    ({ server, base } = await startServer(
      testConfig({ openaiAppsChallengeToken: 'verify-123' })
    ));
    const res = await fetch(`${base}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    expect(body.resource).toBe(TEST_PUBLIC_URL);
    expect(body.authorization_servers).toEqual([TEST_AS_URL]);
    expect(body.scopes_supported).toEqual(['posts:read', 'posts:write']);
  });

  it('serves the configured OpenAI challenge token verbatim', async () => {
    const res = await fetch(`${base}/.well-known/openai-apps-challenge`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('verify-123');
  });

  it('404s the challenge route when no token is configured', async () => {
    const { server: bare, base: bareBase } = await startServer(testConfig());
    try {
      const res = await fetch(`${bareBase}/.well-known/openai-apps-challenge`);
      expect(res.status).toBe(404);
    } finally {
      await closeServer(bare);
    }
  });

  it('answers the health probe', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('answers /mcp with a 401 challenge, never anonymous access', async () => {
    const res = await fetch(`${base}/mcp`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(bearerChallenge(testConfig()));
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_token');
  });

  it('rejects the wrong method with 405 and an Allow header', async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource`, {
      method: 'POST',
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });

  it('404s unknown paths', async () => {
    const res = await fetch(`${base}/definitely-not-a-route`);
    expect(res.status).toBe(404);
  });
});
