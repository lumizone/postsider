// Single source of truth for how a post row maps to an activity bucket.
// Pure module: no Nest, Prisma or React imports.

/** Row buckets in group priority order, highest first. */
export const ROW_BUCKETS = [
  'unknown_outcome',
  'blocked',
  'retryable',
  'failed_other',
  'review',
  'held',
  'scheduled',
  'draft',
  'published',
] as const;
export type RowBucket = (typeof ROW_BUCKETS)[number];

export const ACTIVITY_BUCKETS = [
  'all',
  'attention',
  'failed',
  'review',
  'blocked',
  'retryable',
  'unknown_outcome',
  'failed_other',
  'published',
  'scheduled',
  'draft',
  'held',
] as const;
export type ActivityBucket = (typeof ACTIVITY_BUCKETS)[number];

export const AUTOMATION_ACTOR_TYPES = ['API_KEY', 'OAUTH_CLIENT'] as const;

export function bucketOfRow(row: {
  state: string;
  errorCategory?: string | null;
  errorRetryable?: boolean | null;
}): RowBucket {
  switch (row.state) {
    case 'QUEUE':
      return 'scheduled';
    case 'DRAFT':
      return 'draft';
    case 'HELD':
      return 'held';
    case 'PUBLISHED':
      return 'published';
    case 'APPROVAL':
      return 'review';
    default:
      break;
  }
  if (row.errorCategory === 'POLICY_BLOCKED') return 'blocked';
  if (row.errorCategory === 'UNKNOWN_OUTCOME') return 'unknown_outcome';
  if (row.errorRetryable === true) return 'retryable';
  return 'failed_other';
}

/** Highest priority bucket of a group. */
export function groupBucket(buckets: readonly RowBucket[]): RowBucket {
  if (buckets.length === 0) {
    throw new Error('groupBucket needs at least one bucket');
  }
  const rank = (b: RowBucket) => ROW_BUCKETS.indexOf(b);
  return buckets.reduce((best, b) => (rank(b) < rank(best) ? b : best));
}

export function expandBucket(b: ActivityBucket): RowBucket[] {
  switch (b) {
    case 'all':
      return [...ROW_BUCKETS];
    case 'attention':
      return ['review', 'blocked', 'unknown_outcome', 'retryable', 'failed_other'];
    case 'failed':
      return ['unknown_outcome', 'retryable', 'failed_other'];
    default:
      return [b];
  }
}
