import { z } from 'zod';

/**
 * Configuration for the remote (Streamable HTTP) MCP server.
 *
 * The remote entrypoint (`http.ts`) runs as a PostSider-operated service and
 * authenticates callers with OAuth access tokens, so it has none of the stdio
 * server's client-side env vars (`POSTSIDER_API_KEY` etc. belong to index.ts).
 * Everything it reads is validated here, once, at startup: a misconfigured
 * container must fail fast rather than serve a half-configured discovery
 * document to MCP clients.
 */

export const DEFAULT_PUBLIC_URL = 'https://mcp.postsider.com';
export const DEFAULT_AUTHORIZATION_SERVER_URL = 'https://api.postsider.com';
/** Where tool calls are forwarded; the AS host doubles as the product API. */
export const DEFAULT_API_URL = 'https://api.postsider.com';
export const DEFAULT_SCOPES = ['posts:read', 'posts:write'] as const;
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 240;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * HTTPS everywhere except loopback, matching the stdio client's rule: a plain
 * HTTP URL off the machine would leak bearer tokens in transit.
 */
export function assertHttpsOrLoopback(raw: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be an absolute URL, got: ${raw}`);
  }
  if (url.protocol === 'https:') return raw;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return raw;
  throw new Error(
    `${label} must use HTTPS (plain HTTP is accepted only on loopback), got: ${raw}`
  );
}

const HttpConfigSchema = z.object({
  publicUrl: z.string().min(1),
  authorizationServerUrl: z.string().min(1),
  /** Base URL of the PostSider API; tool calls go to `<apiBaseUrl>/public/v1`. */
  apiBaseUrl: z.string().min(1),
  scopesSupported: z.array(z.string().min(1)).min(1),
  /** Unset means `/mcp` fails closed with 503 until an operator configures it. */
  introspectionSecret: z.string().min(1).optional(),
  openaiAppsChallengeToken: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535),
  bindHost: z.string().min(1),
  rateLimitPerMinute: z.number().int().min(1).max(100000),
});

export type HttpConfig = z.infer<typeof HttpConfigSchema>;

/** Strip trailing slashes so URL building cannot produce `//.well-known/...`. */
function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

export function loadHttpConfig(
  env: NodeJS.ProcessEnv = process.env
): HttpConfig {
  const portRaw = (env.MCP_PORT ?? '8080').trim();
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `MCP_PORT must be an integer between 1 and 65535, got: ${portRaw}`
    );
  }

  const rateRaw = (
    env.MCP_RATE_LIMIT_RPM ?? String(DEFAULT_RATE_LIMIT_PER_MINUTE)
  ).trim();
  const rateLimitPerMinute = Number(rateRaw);
  if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 1) {
    throw new Error(
      `MCP_RATE_LIMIT_RPM must be a positive integer, got: ${rateRaw}`
    );
  }

  const scopesSupported = (env.MCP_SCOPES ?? DEFAULT_SCOPES.join(','))
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);

  return HttpConfigSchema.parse({
    publicUrl: stripTrailingSlashes(
      assertHttpsOrLoopback(
        (env.MCP_PUBLIC_URL ?? DEFAULT_PUBLIC_URL).trim(),
        'MCP_PUBLIC_URL'
      )
    ),
    authorizationServerUrl: stripTrailingSlashes(
      assertHttpsOrLoopback(
        (
          env.MCP_AUTHORIZATION_SERVER_URL ?? DEFAULT_AUTHORIZATION_SERVER_URL
        ).trim(),
        'MCP_AUTHORIZATION_SERVER_URL'
      )
    ),
    apiBaseUrl: stripTrailingSlashes(
      assertHttpsOrLoopback(
        (env.MCP_API_URL ?? DEFAULT_API_URL).trim(),
        'MCP_API_URL'
      )
    ),
    scopesSupported,
    introspectionSecret: env.MCP_INTROSPECTION_SECRET?.trim() || undefined,
    openaiAppsChallengeToken:
      env.MCP_OPENAI_APPS_CHALLENGE?.trim() || undefined,
    port,
    bindHost: (env.MCP_BIND_HOST ?? '0.0.0.0').trim(),
    rateLimitPerMinute,
  });
}
