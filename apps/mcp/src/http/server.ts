import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { HttpConfig } from './config.js';
import { bearerChallenge, protectedResourceMetadata } from './well-known.js';
import { TokenIntrospector } from './introspection.js';
import { scopeGuardedClient } from './scope-guard.js';
import { SubjectRateLimiter } from './rate-limit.js';
import { PostsiderClient } from '../client.js';
import { createPostSiderMcpServer } from '../server.js';

/**
 * The remote MCP HTTP surface.
 *
 * Served: OAuth discovery metadata, the OpenAI domain-verification token, a
 * health probe, and the Streamable HTTP transport at `/mcp`. Every `/mcp`
 * request must present an OAuth access token; the token is validated by
 * introspection and is the only source of tenant identity — a fresh
 * server+client pair is bound to THAT token for the request, so nothing is
 * ever shared across subjects (stateless mode: no session id to replay).
 */

export interface HttpServerDeps {
  /** Test seam: injection point for the introspection HTTP call. */
  fetchImpl?: typeof fetch;
  /** Test seam: clock for the rate limiter. */
  now?: () => number;
}

interface RequestContext {
  config: HttpConfig;
  introspector: TokenIntrospector;
  limiter: SubjectRateLimiter;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
): void {
  res.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function methodNotAllowed(res: ServerResponse, allow: string): void {
  res.setHeader('allow', allow);
  sendJson(res, 405, { error: 'method_not_allowed' });
}

/** `Authorization: Bearer <token>` — the MCP-spec client→server credential. */
function readBearerToken(header: string | undefined): string | null {
  const match = (header ?? '').match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : null;
}

function unauthorized(
  config: HttpConfig,
  res: ServerResponse,
  description: string
): void {
  sendJson(
    res,
    401,
    { error: 'invalid_token', error_description: description },
    { 'www-authenticate': bearerChallenge(config) }
  );
}

function publicOrigin(config: HttpConfig): string {
  try {
    return new URL(config.publicUrl).origin;
  } catch {
    return '';
  }
}

async function handleMcpRequest(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    // Stateless mode: no server-initiated SSE stream to GET and no session to
    // DELETE, so POST is the whole surface.
    return methodNotAllowed(res, 'POST');
  }

  // No CORS headers anywhere on this endpoint: it is called server-to-server
  // by MCP clients. A browser Origin that is not our own public origin has no
  // business here (DNS-rebinding defence); server-side clients send none.
  const origin = req.headers.origin;
  if (
    typeof origin === 'string' &&
    origin &&
    origin !== publicOrigin(ctx.config)
  ) {
    return sendJson(res, 403, { error: 'forbidden' });
  }

  const token = readBearerToken(req.headers.authorization);
  if (!token) {
    return unauthorized(
      ctx.config,
      res,
      'An OAuth access token is required.'
    );
  }

  if (!ctx.config.introspectionSecret) {
    return sendJson(res, 503, {
      error: 'temporarily_unavailable',
      error_description: 'Token validation is not configured on this server.',
    });
  }

  let introspection;
  try {
    introspection = await ctx.introspector.introspect(token);
  } catch {
    // Fail closed: an unreachable introspection endpoint is an outage, not a
    // bad credential, and never a reason to accept the token.
    return sendJson(res, 503, {
      error: 'temporarily_unavailable',
      error_description:
        'The access token could not be validated right now. Try again shortly.',
    });
  }
  if (!introspection.active) {
    return unauthorized(
      ctx.config,
      res,
      'The access token is invalid, expired or revoked.'
    );
  }

  const rate = ctx.limiter.hit(introspection.subject);
  if (!rate.allowed) {
    return sendJson(
      res,
      429,
      {
        error: 'temporarily_unavailable',
        error_description: `Too many requests; retry in ${rate.retryAfterSeconds}s.`,
      },
      { 'retry-after': String(rate.retryAfterSeconds) }
    );
  }

  // Per-request identities, built from the token: the scoped client gates
  // read tools on posts:read and write tools on posts:write, and forwards the
  // SAME token to the API in the canonical raw form the stdio client uses.
  const client = scopeGuardedClient(
    new PostsiderClient(token, ctx.config.apiBaseUrl),
    introspection.scopes
  );
  const server = createPostSiderMcpServer(client);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch {
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'server_error' });
    } else {
      res.end();
    }
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

export function createHttpServer(
  config: HttpConfig,
  deps: HttpServerDeps = {}
): Server {
  const ctx: RequestContext = {
    config,
    introspector: new TokenIntrospector({
      endpoint: `${config.apiBaseUrl}/oauth/introspect`,
      secret: config.introspectionSecret,
      fetchImpl: deps.fetchImpl,
    }),
    limiter: new SubjectRateLimiter(config.rateLimitPerMinute, deps.now),
  };

  return createServer((req, res) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://internal.invalid').pathname;
    } catch {
      return sendJson(res, 400, { error: 'invalid_request' });
    }
    void handleRequest(ctx, req, res, pathname).catch(() => {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'server_error' });
      } else {
        res.end();
      }
    });
  });
}

async function handleRequest(
  ctx: RequestContext,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  const isGet = method === 'GET' || method === 'HEAD';

  if (pathname === '/.well-known/oauth-protected-resource') {
    if (!isGet) return methodNotAllowed(res, 'GET');
    return sendJson(res, 200, protectedResourceMetadata(ctx.config));
  }

  if (pathname === '/.well-known/openai-apps-challenge') {
    if (!isGet) return methodNotAllowed(res, 'GET');
    if (!ctx.config.openaiAppsChallengeToken) {
      return sendJson(res, 404, { error: 'not_found' });
    }
    return sendText(res, 200, ctx.config.openaiAppsChallengeToken);
  }

  if (pathname === '/healthz') {
    if (!isGet) return methodNotAllowed(res, 'GET');
    return sendJson(res, 200, { status: 'ok' });
  }

  if (pathname === '/mcp') {
    return handleMcpRequest(ctx, req, res);
  }

  return sendJson(res, 404, { error: 'not_found' });
}
