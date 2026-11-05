import {
  ACTIVITY_BUCKETS,
  AUTOMATION_ACTOR_TYPES,
  ROW_BUCKETS,
  bucketOfRow,
  expandBucket,
  groupBucket,
} from './activity-buckets';

describe('bucketOfRow', () => {
  it.each([
    ['QUEUE', 'scheduled'],
    ['DRAFT', 'draft'],
    ['HELD', 'held'],
    ['PUBLISHED', 'published'],
    ['APPROVAL', 'review'],
  ])('%s -> %s', (state, bucket) => {
    expect(bucketOfRow({ state })).toBe(bucket);
  });

  it('ERROR with POLICY_BLOCKED is blocked', () => {
    expect(bucketOfRow({ state: 'ERROR', errorCategory: 'POLICY_BLOCKED', errorRetryable: false })).toBe('blocked');
  });
  it('category wins over the retryable flag', () => {
    expect(bucketOfRow({ state: 'ERROR', errorCategory: 'POLICY_BLOCKED', errorRetryable: true })).toBe('blocked');
    expect(bucketOfRow({ state: 'ERROR', errorCategory: 'UNKNOWN_OUTCOME', errorRetryable: true })).toBe('unknown_outcome');
  });
  it('ERROR with UNKNOWN_OUTCOME is unknown_outcome', () => {
    expect(bucketOfRow({ state: 'ERROR', errorCategory: 'UNKNOWN_OUTCOME', errorRetryable: false })).toBe('unknown_outcome');
  });
  it('ERROR retryable other category is retryable', () => {
    expect(bucketOfRow({ state: 'ERROR', errorCategory: 'UNKNOWN', errorRetryable: true })).toBe('retryable');
    expect(bucketOfRow({ state: 'ERROR', errorCategory: 'RATE_LIMITED', errorRetryable: true })).toBe('retryable');
  });
  it('ERROR not retryable is failed_other', () => {
    expect(bucketOfRow({ state: 'ERROR', errorCategory: 'AUTH_EXPIRED', errorRetryable: false })).toBe('failed_other');
  });
  it('legacy ERROR with null category is failed_other', () => {
    expect(bucketOfRow({ state: 'ERROR', errorCategory: null, errorRetryable: null })).toBe('failed_other');
    expect(bucketOfRow({ state: 'ERROR' })).toBe('failed_other');
  });
});

describe('groupBucket', () => {
  it('picks the highest priority', () => {
    expect(groupBucket(['published', 'retryable', 'review'])).toBe('retryable');
    expect(groupBucket(['review', 'blocked'])).toBe('blocked');
    expect(groupBucket(['unknown_outcome', 'blocked'])).toBe('unknown_outcome');
    expect(groupBucket(['published'])).toBe('published');
  });
  it('throws on empty', () => {
    expect(() => groupBucket([])).toThrow();
  });
});

describe('expandBucket', () => {
  it('all -> nine', () => {
    expect([...expandBucket('all')].sort()).toEqual([...ROW_BUCKETS].sort());
  });
  it('attention', () => {
    expect(expandBucket('attention')).toEqual(['review', 'blocked', 'unknown_outcome', 'retryable', 'failed_other']);
  });
  it('failed', () => {
    expect(expandBucket('failed')).toEqual(['unknown_outcome', 'retryable', 'failed_other']);
  });
  it('single buckets map to themselves', () => {
    expect(expandBucket('published')).toEqual(['published']);
    expect(expandBucket('held')).toEqual(['held']);
  });
});

describe('constants', () => {
  it('ROW_BUCKETS has nine unique entries in priority order', () => {
    expect(ROW_BUCKETS).toHaveLength(9);
    expect(new Set(ROW_BUCKETS).size).toBe(9);
    expect(ROW_BUCKETS[0]).toBe('unknown_outcome');
    expect(ROW_BUCKETS[8]).toBe('published');
  });
  it('ACTIVITY_BUCKETS has twelve unique entries', () => {
    expect(ACTIVITY_BUCKETS).toHaveLength(12);
    expect(new Set(ACTIVITY_BUCKETS).size).toBe(12);
  });
  it('automation actor types', () => {
    expect([...AUTOMATION_ACTOR_TYPES]).toEqual(['API_KEY', 'OAUTH_CLIENT']);
  });
});
