/**
 * Which OAuth scope a Public API request needs.
 *
 * The remote MCP server checks this before it calls the API, but a bearer token
 * is also usable against the API directly, so the API has to enforce the same
 * rule or a read-only grant could write. Keep `apps/mcp/src/http/scope-guard.ts`
 * (`isChannelAdminRequest`) in step with this file.
 *
 * - `channels:write`: anything that reconfigures channels. Every mutation under
 *   `/integrations`, and fetching a connect link (`GET /social/...`, which
 *   starts a connection).
 * - `posts:write`: every other mutation.
 * - `posts:read`: every read.
 */
export type McpRequiredScope = 'posts:read' | 'posts:write' | 'channels:write';

const API_PREFIX = '/public/v1';

/** Normalised path below the API prefix: no query, lowercase, decoded. */
function pathsOf(rawUrl: string): string[] {
  const noQuery = rawUrl.split('?')[0].split('#')[0];
  const candidates = new Set<string>([noQuery]);
  try {
    candidates.add(decodeURIComponent(noQuery));
  } catch {
    // An undecodable path is classified on its raw form only.
  }
  return [...candidates].map((p) => {
    const lower = p.toLowerCase().replace(/\/{2,}/g, '/');
    return lower.startsWith(API_PREFIX) ? lower.slice(API_PREFIX.length) || '/' : lower;
  });
}

export function requiredScopeFor(method: string, rawUrl: string): McpRequiredScope {
  const verb = method.toUpperCase();
  const isRead = verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS';
  const paths = pathsOf(rawUrl);

  // Express matches routes case-insensitively and tolerates a trailing slash,
  // so classify on the normalised forms. If any form looks like channel
  // administration, require the stronger scope.
  const channelAdmin = paths.some((p) =>
    isRead ? /^\/social(\/|$)/.test(p) : /^\/integrations(\/|$)/.test(p)
  );
  if (channelAdmin) return 'channels:write';
  return isRead ? 'posts:read' : 'posts:write';
}

/**
 * `scopes` is only present on tokens minted by the MCP authorization server.
 * Legacy OAuth-app tokens and API keys carry no scope list and keep full access
 * (their consent model predates scopes).
 */
export function tokenAllows(
  scopes: readonly string[] | undefined,
  method: string,
  rawUrl: string
): { allowed: true } | { allowed: false; required: McpRequiredScope } {
  if (!Array.isArray(scopes)) return { allowed: true };
  const required = requiredScopeFor(method, rawUrl);
  return scopes.includes(required)
    ? { allowed: true }
    : { allowed: false, required };
}
