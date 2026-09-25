import type { PostsiderClient } from '../client.js';

/**
 * Per-tool scope enforcement for the remote transport.
 *
 * The shared tool factory only talks to the client, so scope enforcement lives
 * ON the client boundary: every read goes through `posts:read`, every mutation
 * (`POST`/`PUT`/`DELETE`) needs `posts:write`. A read-only grant therefore
 * still gets the full read surface, and a write attempt fails with an
 * actionable MCP error instead of a bare API rejection — new grants default to
 * read-only (locked decision D4), so read-only is a normal state, not an error
 * case to hide.
 */
export const READ_SCOPE = 'posts:read';
export const WRITE_SCOPE = 'posts:write';

export class MissingScopeError extends Error {}

export function scopeGuardedClient(
  client: PostsiderClient,
  scopes: ReadonlySet<string>
): PostsiderClient {
  const requireScope = (scope: string): void => {
    if (scopes.has(scope)) return;
    throw new MissingScopeError(
      scope === WRITE_SCOPE
        ? `This connection has read-only access (${READ_SCOPE}); the requested tool changes data and needs ${WRITE_SCOPE}. The user can grant ${WRITE_SCOPE} by reconnecting PostSider and approving it on the consent screen.`
        : `This connection does not include the ${scope} scope. Reconnect PostSider and approve read access on the consent screen.`
    );
  };

  return {
    get: (path: string, query?: Record<string, unknown>) => {
      requireScope(READ_SCOPE);
      return client.get(path, query);
    },
    post: (path: string, body?: unknown, idempotencyKey?: string) => {
      requireScope(WRITE_SCOPE);
      return client.post(path, body, idempotencyKey);
    },
    put: (path: string, body?: unknown) => {
      requireScope(WRITE_SCOPE);
      return client.put(path, body);
    },
    del: (path: string) => {
      requireScope(WRITE_SCOPE);
      return client.del(path);
    },
  } as unknown as PostsiderClient;
}
