// Prisma-shaped where builders for the agent activity queries.
// Pure module: returns plain objects, no Prisma import.
import {
  ActivityBucket,
  AUTOMATION_ACTOR_TYPES,
  RowBucket,
  expandBucket,
} from './activity-buckets';

export type PostWhere = Record<string, unknown>;
export type ActorFilter = {
  type: 'USER' | 'API_KEY' | 'OAUTH_CLIENT' | 'SYSTEM';
  id: string | null;
};

const MAX_ACTOR_ID = 100;

export function parseActorFilter(raw: string): ActorFilter | null {
  if (typeof raw !== 'string') return null;
  if (raw === 'SYSTEM') return { type: 'SYSTEM', id: null };
  const idx = raw.indexOf(':');
  if (idx < 0) return null;
  const type = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (type !== 'USER' && type !== 'API_KEY' && type !== 'OAUTH_CLIENT') return null;
  if (id.length === 0 || id.length > MAX_ACTOR_ID) return null;
  if (type === 'API_KEY' && id === 'legacy') return { type: 'API_KEY', id: null };
  return { type, id };
}

const SPECIAL_CATEGORIES = ['POLICY_BLOCKED', 'UNKNOWN_OUTCOME'];

export function rowBucketWhere(b: RowBucket): PostWhere {
  switch (b) {
    case 'scheduled':
      return { state: 'QUEUE' };
    case 'draft':
      return { state: 'DRAFT' };
    case 'held':
      return { state: 'HELD' };
    case 'published':
      return { state: 'PUBLISHED' };
    case 'review':
      return { state: 'APPROVAL' };
    case 'blocked':
      return { state: 'ERROR', errorCategory: 'POLICY_BLOCKED' };
    case 'unknown_outcome':
      return { state: 'ERROR', errorCategory: 'UNKNOWN_OUTCOME' };
    case 'retryable':
      return {
        state: 'ERROR',
        errorRetryable: true,
        // notIn alone drops null categories in SQL, so null is explicit
        OR: [{ errorCategory: null }, { errorCategory: { notIn: SPECIAL_CATEGORIES } }],
      };
    case 'failed_other':
      return {
        state: 'ERROR',
        OR: [{ errorCategory: null }, { errorCategory: { notIn: SPECIAL_CATEGORIES } }],
        AND: [{ OR: [{ errorRetryable: null }, { errorRetryable: false }] }],
      };
  }
}

export function bucketWhere(b: ActivityBucket): PostWhere | null {
  if (b === 'all') return null;
  return { OR: expandBucket(b).map(rowBucketWhere) };
}

export function scopeWhere(scope: 'relevant' | 'automation'): PostWhere {
  const types = [...AUTOMATION_ACTOR_TYPES];
  const or: PostWhere[] = [
    { createdByType: { in: types } },
    { lastModifiedByType: { in: types } },
  ];
  if (scope === 'relevant') {
    or.push({ state: { in: ['APPROVAL', 'ERROR'] } });
  }
  return { OR: or };
}

export function actorWhere(a: ActorFilter): PostWhere {
  switch (a.type) {
    case 'USER':
      return {
        OR: [
          { createdByType: 'USER', createdByUserId: a.id },
          { lastModifiedByType: 'USER', lastModifiedByUserId: a.id },
        ],
      };
    case 'API_KEY':
      return {
        OR: [
          { createdByType: 'API_KEY', createdByApiKeyId: a.id },
          { lastModifiedByType: 'API_KEY', lastModifiedByApiKeyId: a.id },
        ],
      };
    case 'OAUTH_CLIENT':
      return {
        OR: [
          { createdByType: 'OAUTH_CLIENT', createdByOAuthClientId: a.id },
          { lastModifiedByType: 'OAUTH_CLIENT', lastModifiedByOAuthClientId: a.id },
        ],
      };
    case 'SYSTEM':
      return { OR: [{ createdByType: 'SYSTEM' }, { lastModifiedByType: 'SYSTEM' }] };
  }
}

export type ActivityFilters = {
  bucket: ActivityBucket;
  scope: 'relevant' | 'automation';
  integrationIds?: string[];
  actor?: ActorFilter;
  agentName?: string;
  source?: string;
  from?: Date;
  to?: Date;
};

export function buildActivityWhere(orgId: string, f: ActivityFilters): PostWhere {
  const and: PostWhere[] = [
    { organizationId: orgId },
    { deletedAt: null },
    { parentPostId: null },
    { integration: { deletedAt: null } },
    scopeWhere(f.scope),
  ];
  const bucket = bucketWhere(f.bucket);
  if (bucket) and.push(bucket);
  if (f.integrationIds && f.integrationIds.length > 0) {
    and.push({ integrationId: { in: f.integrationIds } });
  }
  if (f.actor) and.push(actorWhere(f.actor));
  if (f.agentName) and.push({ agentName: f.agentName });
  if (f.source) and.push({ source: f.source });
  if (f.from || f.to) {
    const range: Record<string, Date> = {};
    if (f.from) range.gte = f.from;
    if (f.to) range.lte = f.to;
    and.push({ updatedAt: range });
  }
  return { AND: and };
}
