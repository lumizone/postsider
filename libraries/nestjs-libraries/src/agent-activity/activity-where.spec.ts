import { ACTIVITY_BUCKETS, ROW_BUCKETS, bucketOfRow, expandBucket } from './activity-buckets';
import {
  actorWhere,
  bucketWhere,
  buildActivityWhere,
  parseActorFilter,
  rowBucketWhere,
  scopeWhere,
} from './activity-where';

type Row = { state: string; errorCategory: string | null; errorRetryable: boolean | null };

function evalCond(value: unknown, cond: any): boolean {
  if (cond === null) return value === null;
  if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('in' in cond && !cond.in.includes(value)) return false;
    // SQL semantics: notIn never matches a null column
    if ('notIn' in cond && (value === null || cond.notIn.includes(value))) return false;
    return true;
  }
  return value === cond;
}

function evalWhere(row: Row, where: any): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as any[]).some((w) => evalWhere(row, w));
    if (k === 'AND') return (v as any[]).every((w) => evalWhere(row, w));
    if (k === 'NOT') return !evalWhere(row, v);
    return evalCond((row as any)[k], v);
  });
}

const STATES = ['QUEUE', 'DRAFT', 'HELD', 'PUBLISHED', 'APPROVAL', 'ERROR'];
const CATS = [null, 'POLICY_BLOCKED', 'UNKNOWN_OUTCOME', 'RATE_LIMITED', 'UNKNOWN'];
const RETRY = [null, true, false];
const ROWS: Row[] = [];
for (const state of STATES)
  for (const errorCategory of CATS)
    for (const errorRetryable of RETRY) ROWS.push({ state, errorCategory, errorRetryable });

describe('where parity with bucketOfRow', () => {
  it.each([...ROW_BUCKETS])('rowBucketWhere(%s) matches exactly the rows in that bucket', (b) => {
    for (const row of ROWS) {
      expect(evalWhere(row, rowBucketWhere(b))).toBe(bucketOfRow(row) === b);
    }
  });

  it.each([...ACTIVITY_BUCKETS])('bucketWhere(%s) matches exactly the expanded buckets', (b) => {
    const where = bucketWhere(b);
    if (b === 'all') {
      expect(where).toBeNull();
      return;
    }
    const set = new Set(expandBucket(b));
    for (const row of ROWS) {
      expect(evalWhere(row, where)).toBe(set.has(bucketOfRow(row)));
    }
  });

  it('failed_other catches legacy null category rows', () => {
    expect(evalWhere({ state: 'ERROR', errorCategory: null, errorRetryable: null }, rowBucketWhere('failed_other'))).toBe(true);
  });
});

describe('parseActorFilter', () => {
  it('parses valid forms', () => {
    expect(parseActorFilter('USER:u1')).toEqual({ type: 'USER', id: 'u1' });
    expect(parseActorFilter('API_KEY:k1')).toEqual({ type: 'API_KEY', id: 'k1' });
    expect(parseActorFilter('OAUTH_CLIENT:c1')).toEqual({ type: 'OAUTH_CLIENT', id: 'c1' });
    expect(parseActorFilter('API_KEY:legacy')).toEqual({ type: 'API_KEY', id: null });
    expect(parseActorFilter('SYSTEM')).toEqual({ type: 'SYSTEM', id: null });
  });
  it('rejects invalid forms', () => {
    expect(parseActorFilter('ROOT:1')).toBeNull();
    expect(parseActorFilter('USER:')).toBeNull();
    expect(parseActorFilter('USER')).toBeNull();
    expect(parseActorFilter('OAUTH_CLIENT')).toBeNull();
    expect(parseActorFilter('SYSTEM:x')).toBeNull();
    expect(parseActorFilter('USER:' + 'a'.repeat(101))).toBeNull();
    expect(parseActorFilter('')).toBeNull();
  });
  it('accepts exactly 100 chars', () => {
    expect(parseActorFilter('USER:' + 'a'.repeat(100))).not.toBeNull();
  });
});

describe('scopeWhere / actorWhere', () => {
  it('automation is an OR over created and lastModified types', () => {
    expect(scopeWhere('automation')).toEqual({
      OR: [
        { createdByType: { in: ['API_KEY', 'OAUTH_CLIENT'] } },
        { lastModifiedByType: { in: ['API_KEY', 'OAUTH_CLIENT'] } },
      ],
    });
  });
  it('relevant additionally ORs APPROVAL and ERROR', () => {
    expect(scopeWhere('relevant')).toEqual({
      OR: [
        { createdByType: { in: ['API_KEY', 'OAUTH_CLIENT'] } },
        { lastModifiedByType: { in: ['API_KEY', 'OAUTH_CLIENT'] } },
        { state: { in: ['APPROVAL', 'ERROR'] } },
      ],
    });
  });
  it('API_KEY with id matches created or lastModified key id', () => {
    expect(actorWhere({ type: 'API_KEY', id: 'k1' })).toEqual({
      OR: [
        { createdByType: 'API_KEY', createdByApiKeyId: 'k1' },
        { lastModifiedByType: 'API_KEY', lastModifiedByApiKeyId: 'k1' },
      ],
    });
  });
  it('API_KEY legacy matches null key id', () => {
    expect(actorWhere({ type: 'API_KEY', id: null })).toEqual({
      OR: [
        { createdByType: 'API_KEY', createdByApiKeyId: null },
        { lastModifiedByType: 'API_KEY', lastModifiedByApiKeyId: null },
      ],
    });
  });
  it('USER, OAUTH_CLIENT and SYSTEM', () => {
    expect(actorWhere({ type: 'USER', id: 'u1' })).toEqual({
      OR: [
        { createdByType: 'USER', createdByUserId: 'u1' },
        { lastModifiedByType: 'USER', lastModifiedByUserId: 'u1' },
      ],
    });
    expect(actorWhere({ type: 'OAUTH_CLIENT', id: 'c1' })).toEqual({
      OR: [
        { createdByType: 'OAUTH_CLIENT', createdByOAuthClientId: 'c1' },
        { lastModifiedByType: 'OAUTH_CLIENT', lastModifiedByOAuthClientId: 'c1' },
      ],
    });
    expect(actorWhere({ type: 'SYSTEM', id: null })).toEqual({
      OR: [{ createdByType: 'SYSTEM' }, { lastModifiedByType: 'SYSTEM' }],
    });
  });
});

describe('buildActivityWhere', () => {
  const base = { bucket: 'all' as const, scope: 'relevant' as const };
  const clauses = (w: any) => w.AND as any[];

  it('always contains the tenant and top-level guards', () => {
    const c = clauses(buildActivityWhere('org-1', base));
    expect(c).toContainEqual({ organizationId: 'org-1' });
    expect(c).toContainEqual({ deletedAt: null });
    expect(c).toContainEqual({ parentPostId: null });
    expect(c).toContainEqual({ integration: { deletedAt: null } });
    expect(c).toContainEqual(scopeWhere('relevant'));
  });
  it('bucket all adds no bucket clause', () => {
    expect(clauses(buildActivityWhere('o', base))).toHaveLength(5);
  });
  it('a bucket adds its where', () => {
    const c = clauses(buildActivityWhere('o', { ...base, bucket: 'review' }));
    expect(c).toContainEqual(bucketWhere('review'));
  });
  it('empty integrationIds adds no clause', () => {
    expect(clauses(buildActivityWhere('o', { ...base, integrationIds: [] }))).toHaveLength(5);
    expect(clauses(buildActivityWhere('o', { ...base, integrationIds: ['i1', 'i2'] }))).toContainEqual({
      integrationId: { in: ['i1', 'i2'] },
    });
  });
  it('actor, agentName, source and range', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-01-02T00:00:00Z');
    const c = clauses(
      buildActivityWhere('o', {
        ...base,
        scope: 'automation',
        actor: { type: 'API_KEY', id: 'k1' },
        agentName: 'bot',
        source: 'cli',
        from,
        to,
      })
    );
    expect(c).toContainEqual(scopeWhere('automation'));
    expect(c).toContainEqual(actorWhere({ type: 'API_KEY', id: 'k1' }));
    expect(c).toContainEqual({ agentName: 'bot' });
    expect(c).toContainEqual({ source: 'cli' });
    expect(c).toContainEqual({ updatedAt: { gte: from, lte: to } });
  });
  it('only from gives a gte only', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    expect(clauses(buildActivityWhere('o', { ...base, from }))).toContainEqual({ updatedAt: { gte: from } });
  });
});
