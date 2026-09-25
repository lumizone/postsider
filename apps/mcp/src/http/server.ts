import { createServer, type Server } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HttpConfig } from './config.js';
import { bearerChallenge, protectedResourceMetadata } from './well-known.js';

/**
 * The remote MCP HTTP surface.
 *
 * Served today: OAuth discovery metadata, the OpenAI domain-verification token,
 * and a health probe. The Streamable HTTP transport itself (`/mcp`) is not
 * wired yet — until OAuth token validation lands, every `/mcp` request gets a
 * spec-shaped 401 with the discovery challenge, so the endpoint never pretends
 * to accept unauthenticated traffic.
 */

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

export function handleRequest(
  config: HttpConfig,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): void {
  const method = (req.method ?? 'GET').toUpperCase();
  const isGet = method === 'GET' || method === 'HEAD';

  if (pathname === '/.well-known/oauth-protected-resource') {
    if (!isGet) return methodNotAllowed(res, 'GET');
    return sendJson(res, 200, protectedResourceMetadata(config));
  }

  if (pathname === '/.well-known/openai-apps-challenge') {
    if (!isGet) return methodNotAllowed(res, 'GET');
    if (!config.openaiAppsChallengeToken) {
      return sendJson(res, 404, { error: 'not_found' });
    }
    return sendText(res, 200, config.openaiAppsChallengeToken);
  }

  if (pathname === '/healthz') {
    if (!isGet) return methodNotAllowed(res, 'GET');
    return sendJson(res, 200, { status: 'ok' });
  }

  if (pathname === '/mcp') {
    // Unauthenticated for now by design: no anonymous or weakly authenticated
    // access (threat model T5), and the challenge tells clients where to go.
    return sendJson(
      res,
      401,
      {
        error: 'invalid_token',
        error_description: 'An OAuth access token is required.',
      },
      { 'www-authenticate': bearerChallenge(config) }
    );
  }

  return sendJson(res, 404, { error: 'not_found' });
}

export function createHttpServer(config: HttpConfig): Server {
  return createServer((req, res) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://internal.invalid').pathname;
    } catch {
      return sendJson(res, 400, { error: 'invalid_request' });
    }
    handleRequest(config, req, res, pathname);
  });
}
