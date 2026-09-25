ALTER TABLE "ApiKey"
ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[
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
  'webhooks:write'
]::TEXT[];
