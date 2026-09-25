import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../http/server.js';
import { bearerChallenge } from '../http/well-known.js';
import type { HttpConfig } from '../http/config.js';

/**
 * End-to-end tests for the remote MCP transport: a real Streamable HTTP client
 * (from the MCP SDK) talks to the real server over a loopback socket, with a
 * fake PostSider backend answering introspection and the public API.
 *
 * The fake backend records every authorization header it sees, which is how
 * these tests prove which credential went where (and that the user's token is
 * the only one that ever reaches the API).
 */

const TEST_PUBLIC_URL = 'https://mcp.test.postsider.com';
const INTROSPECTION_SECRET = 'introspection-shared-secret';

const TOKEN_RW = 'token-read-write';
const TOKEN_RO = 'token-read-only';
const TOKEN_REFRESH = 'token-refresh-not-access';
const TOKEN_REVOKED = 'token-revoked';
const TOKEN_BOOM = 'token-backend-explodes';

interface BackendState {
  introspectCalls: Array<{ authorization?: string; token?: string }>;
  apiCalls: Array<{ authorization?: string; path: string }>;
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: any, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function startFakeBackend(): Promise<{
  server: Server;
  base: string;
  state: BackendState;
}> {
  const state: BackendState = { introspectCalls: [], apiCalls: [] };

  const server = createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0];
      const authorization = req.headers.authorization;

      if (path === '/oauth/introspect') {
        const body = (await readJson(req)) as { token?: string } | null;
        state.introspectCalls.push({
          authorization: authorization as string | undefined,
          token: body?.token,
        });
        if (body?.token === TOKEN_BOOM) {
          return sendJson(res, 500, { error: 'server_error' });
        }
        if (body?.token === TOKEN_REVOKED) {
          return sendJson(res, 200, { active: false });
        }
        if (body?.token === TOKEN_REFRESH) {
          return sendJson(res, 200, {
            active: true,
            token_type: 'refresh_token',
            sub: 'user-1',
            exp: Math.floor(Date.now() / 1000) + 900,
          });
        }
        if (body?.token === TOKEN_RW || body?.token === TOKEN_RO) {
          return sendJson(res, 200, {
            active: true,
            token_type: 'Bearer',
            scope:
              body.token === TOKEN_RW ? 'posts:read posts:write' : 'posts:read',
            sub: 'user-1',
            client_id: 'pmc_test',
            exp: Math.floor(Date.now() / 1000) + 900,
          });
        }
        return sendJson(res, 200, { active: false });
      }

      if (path.startsWith('/public/v1/')) {
        state.apiCalls.push({
          authorization: authorization as string | undefined,
          path,
        });
        if (path === '/public/v1/integrations') {
          return sendJson(res, 200, [
            { id: 'ch_1', name: 'Test channel', platform: 'x' },
          ]);
        }
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 404, { error: 'not_found' });
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, base: `http://127.0.0.1:${port}`, state };
}

function transportConfig(
  backendBase: string,
  overrides: Partial<HttpConfig> = {}
): HttpConfig {
  return {
    publicUrl: TEST_PUBLIC_URL,
    authorizationServerUrl: TEST_PUBLIC_URL.replace('mcp.', 'api.'),
    apiBaseUrl: backendBase,
    scopesSupported: ['posts:read', 'posts:write'],
    introspectionSecret: INTROSPECTION_SECRET,
    port: 0,
    bindHost: '127.0.0.1',
    rateLimitPerMinute: 240,
    ...overrides,
  };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function postMcp(
  base: string,
  token: string | undefined,
  body: unknown
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const initializeBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'transport-test', version: '0.0.0' },
  },
};

async function connectSdkClient(
  base: string,
  token: string
): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'transport-test', version: '0.0.0' });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await transport.close();
      await client.close();
    },
  };
}

describe('remote MCP transport', () => {
  let backend: { server: Server; base: string; state: BackendState };
  let mcp: { server: Server; base: string };

  beforeAll(async () => {
    backend = await startFakeBackend();
    mcp = await (async () => {
      const server = createHttpServer(transportConfig(backend.base));
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      );
      const { port } = server.address() as AddressInfo;
      return { server, base: `http://127.0.0.1:${port}` };
    })();
  });

  afterAll(async () => {
    if (mcp?.server) await closeServer(mcp.server);
    if (backend?.server) await closeServer(backend.server);
  });

  it('serves the shared tool inventory to an authenticated client', async () => {
    const { client, close } = await connectSdkClient(mcp.base, TOKEN_RW);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      expect(names).toHaveLength(19);
      expect(names).toContain('postsider_list_channels');
      expect(names).toContain('postsider_create_post');
      expect(names).toContain('postsider_delete_post');
    } finally {
      await close();
    }
  });

  it('validates the token by introspection and forwards it to the API unchanged', async () => {
    backend.state.introspectCalls.length = 0;
    backend.state.apiCalls.length = 0;

    const { client, close } = await connectSdkClient(mcp.base, TOKEN_RW);
    try {
      const result = await client.callTool({
        name: 'postsider_list_channels',
        arguments: {},
      });
      const text = (result.content as Array<{ text?: string }>)[0]?.text ?? '';
      expect(text).toContain('ch_1');
      expect(result.isError).toBeFalsy();
    } finally {
      await close();
    }

    // The introspection call carried the resource server's shared secret and
    // the user's token in the body.
    expect(backend.state.introspectCalls.length).toBeGreaterThan(0);
    expect(backend.state.introspectCalls[0].authorization).toBe(
      `Bearer ${INTROSPECTION_SECRET}`
    );
    expect(backend.state.introspectCalls[0].token).toBe(TOKEN_RW);

    // The API saw the user's token in the canonical raw form, not the secret.
    const integrationsCall = backend.state.apiCalls.find(
      (call) => call.path === '/public/v1/integrations'
    );
    expect(integrationsCall?.authorization).toBe(TOKEN_RW);
    expect(
      backend.state.apiCalls.every(
        (call) => call.authorization !== `Bearer ${INTROSPECTION_SECRET}`
      )
    ).toBe(true);
  });

  it('gives a read-only grant the read surface and a scope error on writes', async () => {
    backend.state.apiCalls.length = 0;

    const { client, close } = await connectSdkClient(mcp.base, TOKEN_RO);
    try {
      const read = await client.callTool({
        name: 'postsider_list_channels',
        arguments: {},
      });
      expect(read.isError).toBeFalsy();

      const write = await client.callTool({
        name: 'postsider_create_post',
        arguments: {
          type: 'draft',
          date: '2026-07-01T10:00:00Z',
          posts: [{ channelId: 'ch_1', content: 'hello' }],
        },
      });
      expect(write.isError).toBe(true);
      const text =
        (write.content as Array<{ text?: string }>)[0]?.text ?? '';
      expect(text).toContain('posts:write');
      expect(text).not.toContain(TOKEN_RO);
    } finally {
      await close();
    }

    // The forbidden write never reached the API.
    expect(
      backend.state.apiCalls.some((call) => call.path === '/public/v1/posts')
    ).toBe(false);
  });

  it('rejects a revoked token with the discovery challenge and leaks nothing', async () => {
    const res = await postMcp(mcp.base, TOKEN_REVOKED, initializeBody);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      bearerChallenge(transportConfig(backend.base))
    );
    const raw = await res.text();
    expect(raw).toContain('invalid_token');
    expect(raw).not.toContain(TOKEN_REVOKED);
    expect(raw).not.toContain(INTROSPECTION_SECRET);
  });

  it('refuses a refresh token as a bearer credential', async () => {
    const res = await postMcp(mcp.base, TOKEN_REFRESH, initializeBody);
    expect(res.status).toBe(401);
    const raw = await res.text();
    expect(raw).not.toContain(TOKEN_REFRESH);
  });

  it('fails closed with 503 when introspection errors', async () => {
    const res = await postMcp(mcp.base, TOKEN_BOOM, initializeBody);
    expect(res.status).toBe(503);
    const raw = await res.text();
    expect(raw).toContain('temporarily_unavailable');
    expect(raw).not.toContain(TOKEN_BOOM);
  });

  it('fails closed with 503 when no introspection secret is configured', async () => {
    const server = createHttpServer(
      transportConfig(backend.base, { introspectionSecret: undefined })
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;
    try {
      const res = await postMcp(
        `http://127.0.0.1:${port}`,
        TOKEN_RW,
        initializeBody
      );
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('temporarily_unavailable');
    } finally {
      await closeServer(server);
    }
  });

  it('rate limits per token subject', async () => {
    const server = createHttpServer(
      transportConfig(backend.base, { rateLimitPerMinute: 2 })
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve)
    );
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    try {
      const first = await postMcp(base, TOKEN_RW, initializeBody);
      const second = await postMcp(base, TOKEN_RW, initializeBody);
      const third = await postMcp(base, TOKEN_RW, initializeBody);

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(third.status).toBe(429);
      expect(third.headers.get('retry-after')).toBeTruthy();
    } finally {
      await closeServer(server);
    }
  });

  it('rejects non-POST methods on /mcp with 405', async () => {
    const res = await fetch(`${mcp.base}/mcp`, {
      method: 'GET',
      headers: { authorization: `Bearer ${TOKEN_RW}` },
    });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('rejects a foreign browser Origin without CORS headers', async () => {
    const res = await fetch(`${mcp.base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${TOKEN_RW}`,
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify(initializeBody),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
