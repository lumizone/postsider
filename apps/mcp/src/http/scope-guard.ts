import type { PostsiderClient } from '../client.js';

/**
 * Per-tool scope enforcement for the remote transport.
 *
 * The shared tool factory only talks to the client, so scope enforcement lives
 * ON the client boundary: every read goes through `posts:read`, every mutation
 * (`POST`/`PUT`/`DELETE`) needs `posts:write`, except channel configuration,
 * which needs `channels:write`. A read-only grant therefore
 * still gets the full read surface, and a write attempt fails with an
 * actionable MCP error instead of a bare API rejection — new grants default to
 * read-only (locked decision D4), so read-only is a normal state, not an error
 * case to hide.
 */
export const READ_SCOPE = 'posts:read';
export const WRITE_SCOPE = 'posts:write';
/**
 * Separate grant for reconfiguring the workspace: connecting, enabling,
 * disabling, re-timing, re-assigning and disconnecting channels.
 */
export const CHANNELS_SCOPE = 'channels:write';

/**
 * Whether a request touches channel configuration. Every mutation under
 * `/integrations`, plus fetching an OAuth link to connect a channel (a GET, but
 * it starts a connection), needs `channels:write` instead of `posts:write`.
 * Reading channels, queue plans and rules stays under `posts:read`.
 */
export function isChannelAdminRequest(method: string, path: string): boolean {
  // Mirrors requiredScopeFor() in the API (mcp-scope-policy.ts), which enforces
  // the same rule for tokens used against the API directly. The API matches
  // routes case-insensitively, so this must too.
  const p = path.toLowerCase();
  if (method.toUpperCase() === 'GET') {
    return /^\/social(\/|$)/.test(p);
  }
  return /^\/integrations(\/|$)/.test(p);
}

export class MissingScopeError extends Error {}

export function scopeGuardedClient(
  client: PostsiderClient,
  scopes: ReadonlySet<string>
): PostsiderClient {
  const requireScope = (scope: string): void => {
    if (scopes.has(scope)) return;
    throw new MissingScopeError(
      scope === CHANNELS_SCOPE
        ? `This tool changes channel settings and needs the ${CHANNELS_SCOPE} scope, which this connection was not granted. The user can grant it by reconnecting PostSider and approving it on the consent screen.`
        : scope === WRITE_SCOPE
        ? `This connection has read-only access (${READ_SCOPE}); the requested tool changes data and needs ${WRITE_SCOPE}. The user can grant ${WRITE_SCOPE} by reconnecting PostSider and approving it on the consent screen.`
        : `This connection does not include the ${scope} scope. Reconnect PostSider and approve read access on the consent screen.`
    );
  };

  return {
    get: (path: string, query?: Record<string, unknown>) => {
      requireScope(isChannelAdminRequest('GET', path) ? CHANNELS_SCOPE : READ_SCOPE);
      return client.get(path, query);
    },
    post: (path: string, body?: unknown, idempotencyKey?: string) => {
      requireScope(isChannelAdminRequest('POST', path) ? CHANNELS_SCOPE : WRITE_SCOPE);
      return client.post(path, body, idempotencyKey);
    },
    put: (path: string, body?: unknown) => {
      requireScope(isChannelAdminRequest('PUT', path) ? CHANNELS_SCOPE : WRITE_SCOPE);
      return client.put(path, body);
    },
    del: (path: string) => {
      requireScope(isChannelAdminRequest('DELETE', path) ? CHANNELS_SCOPE : WRITE_SCOPE);
      return client.del(path);
    },
  } as unknown as PostsiderClient;
}
