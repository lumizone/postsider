import { PUBLIC_API_SCOPES, type PublicApiScope } from './public-api-scopes';

/**
 * Existing credentials predate public webhook subscriptions. Preserve their
 * ability to call every pre-existing Public API route, but do not grant new
 * webhook administration without an explicit opt-in.
 */
export const LEGACY_PUBLIC_API_SCOPES: PublicApiScope[] =
  PUBLIC_API_SCOPES.filter((scope) => !scope.startsWith('webhooks:'));

/**
 * MCP grants are scoped to posts:read, posts:write and channels:write.
 * Map them to the existing Public API actions they previously authorized,
 * rather than granting every endpoint with a wildcard. In particular,
 * posts:write does not grant management of webhook secrets.
 *
 * Non-MCP legacy OAuth apps have no scope list, so retain access to the
 * pre-existing Public API surface without access to newly added webhooks.
 */
export function grantedScopesForOAuth(
  scopes: readonly string[] | undefined | null
): PublicApiScope[] {
  if (!Array.isArray(scopes)) return [...LEGACY_PUBLIC_API_SCOPES];
  const granted = new Set<PublicApiScope>();
  if (scopes.includes('posts:read')) {
    for (const scope of [
      'organization:read',
      'channels:read',
      'posts:read',
      'approvals:read',
      'analytics:read',
      'notifications:read',
      'publishing:read',
    ] as const) granted.add(scope);
  }
  if (scopes.includes('posts:write')) {
    for (const scope of [
      'posts:write',
      'media:write',
      'approvals:write',
      'publishing:write',
    ] as const) granted.add(scope);
  }
  if (scopes.includes('channels:write')) {
    granted.add('channels:write');
  }
  return [...granted];
}
