import { PUBLIC_API_SCOPES, type PublicApiScope } from '@postsider/nestjs-libraries/services/public-api-scopes';

/**
 * Legacy OAuth app consent predates per-route grants. Preserve its historical
 * Public API privileges without granting the newly introduced webhook
 * administration powers. MCP OAuth scopes are also verified by tokenAllows()
 * on the incoming request, before this finer-grained route permission check.
 */
const READ = new Set<PublicApiScope>([
  'organization:read', 'channels:read', 'posts:read', 'approvals:read',
  'analytics:read', 'notifications:read', 'publishing:read',
]);
const WRITE = new Set<PublicApiScope>([
  'posts:write', 'media:write', 'approvals:write', 'publishing:write',
]);
const LEGACY = PUBLIC_API_SCOPES.filter(
  (scope) => scope !== 'webhooks:read' && scope !== 'webhooks:write'
);

export function publicApiScopesForOAuth(
  oauthGrant: readonly string[] | null | undefined
): PublicApiScope[] {
  if (oauthGrant == null) return [...LEGACY];
  if (!Array.isArray(oauthGrant)) return [];
  const granted = new Set(oauthGrant);
  return PUBLIC_API_SCOPES.filter(
    (scope) =>
      (granted.has('posts:read') && READ.has(scope)) ||
      (granted.has('posts:write') && WRITE.has(scope)) ||
      (granted.has('channels:write') && scope === 'channels:write')
  );
}
