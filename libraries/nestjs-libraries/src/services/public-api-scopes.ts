export const PUBLIC_API_SCOPES = [
  'organization:read',
  'channels:read',
  'channels:write',
  'posts:read',
  'posts:write',
  'media:write',
  'approvals:read',
  'approvals:write',
  'analytics:read',
  'notifications:read',
  'publishing:read',
  'publishing:write',
  'webhooks:read',
  'webhooks:write',
] as const;

export type PublicApiScope = (typeof PUBLIC_API_SCOPES)[number];

export function isPublicApiScope(value: string): value is PublicApiScope {
  return (PUBLIC_API_SCOPES as readonly string[]).includes(value);
}
