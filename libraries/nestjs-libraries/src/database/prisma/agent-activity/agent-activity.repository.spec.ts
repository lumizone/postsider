import { AgentActivityRepository } from './agent-activity.repository';

const make = () => {
  const post = {
    groupBy: jest.fn().mockResolvedValue([]),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const approval = { findMany: jest.fn().mockResolvedValue([]) };
  const audit = { count: jest.fn().mockResolvedValue(0) };
  const repo = new AgentActivityRepository(
    { model: { post } } as any,
    { model: { postApproval: approval } } as any,
    { model: { auditLog: audit } } as any
  );
  return { repo, post, approval, audit };
};

const where = { AND: [{ organizationId: 'org-1' }] };

describe('AgentActivityRepository', () => {
  describe('pageGroups', () => {
    it('groups by group with the keyset order and no having without a cursor', async () => {
      const { repo, post } = make();
      post.groupBy.mockResolvedValue([
        { group: 'g2', _max: { updatedAt: new Date('2026-11-05T10:00:00.000Z') } },
        { group: 'g1', _max: { updatedAt: new Date('2026-11-05T09:00:00.000Z') } },
      ]);
      const out = await repo.pageGroups('org-1', where, null, 26);
      expect(post.groupBy).toHaveBeenCalledTimes(1);
      const arg = post.groupBy.mock.calls[0][0];
      expect(arg.by).toEqual(['group']);
      expect(arg.where).toBe(where);
      expect(arg._max).toEqual({ updatedAt: true });
      expect(arg.orderBy).toEqual([{ _max: { updatedAt: 'desc' } }, { group: 'desc' }]);
      expect(arg.take).toBe(26);
      expect(arg).not.toHaveProperty('having');
      expect(out).toEqual([
        { group: 'g2', updatedAt: new Date('2026-11-05T10:00:00.000Z') },
        { group: 'g1', updatedAt: new Date('2026-11-05T09:00:00.000Z') },
      ]);
    });

    it('adds the keyset having for a cursor', async () => {
      const { repo, post } = make();
      const t = new Date('2026-11-05T10:00:00.000Z');
      await repo.pageGroups('org-1', where, { updatedAt: t, group: 'g5' }, 10);
      expect(post.groupBy.mock.calls[0][0].having).toEqual({
        OR: [
          { updatedAt: { _max: { lt: t } } },
          { AND: [{ updatedAt: { _max: { equals: t } } }, { group: { lt: 'g5' } }] },
        ],
      });
    });
  });

  describe('rowsForGroups', () => {
    it('queries one findMany scoped to the org, top level and not deleted', async () => {
      const { repo, post } = make();
      await repo.rowsForGroups('org-1', ['g1', 'g2']);
      expect(post.findMany).toHaveBeenCalledTimes(1);
      const arg = post.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        organizationId: 'org-1',
        parentPostId: null,
        deletedAt: null,
        integration: { deletedAt: null },
        group: { in: ['g1', 'g2'] },
      });
      const keys = Object.keys(arg.select);
      for (const k of ['settings', 'token', 'key']) expect(keys).not.toContain(k);
      expect(Object.keys(arg.select.integration.select).sort()).toEqual(
        ['id', 'name', 'picture', 'providerIdentifier'].sort()
      );
      expect(keys).toEqual(expect.arrayContaining(['id', 'group', 'state', 'content', 'agentName', 'createdByType']));
    });

    it('does not query for an empty group list', async () => {
      const { repo, post } = make();
      expect(await repo.rowsForGroups('org-1', [])).toEqual([]);
      expect(post.findMany).not.toHaveBeenCalled();
    });
  });

  describe('pendingApprovalIds', () => {
    it('selects only id and postId for PENDING approvals of the org', async () => {
      const { repo, approval } = make();
      await repo.pendingApprovalIds('org-1', ['p1', 'p2']);
      const arg = approval.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        organizationId: 'org-1',
        status: 'PENDING',
        postId: { in: ['p1', 'p2'] },
      });
      expect(arg.select).toEqual({ id: true, postId: true });
    });

    it('does not query for no posts', async () => {
      const { repo, approval } = make();
      expect(await repo.pendingApprovalIds('org-1', [])).toEqual([]);
      expect(approval.findMany).not.toHaveBeenCalled();
    });
  });

  describe('counts', () => {
    const range = { start: new Date('2026-11-05T00:00:00Z'), end: new Date('2026-11-06T00:00:00Z') };

    it('openCounts groups open states of top level destinations', async () => {
      const { repo, post } = make();
      post.groupBy.mockResolvedValue([
        { state: 'ERROR', errorCategory: null, errorRetryable: null, _count: { _all: 5 } },
      ]);
      const out = await repo.openCounts('org-1');
      const arg = post.groupBy.mock.calls[0][0];
      expect(arg.by).toEqual(['state', 'errorCategory', 'errorRetryable']);
      expect(arg.where).toMatchObject({
        organizationId: 'org-1',
        parentPostId: null,
        deletedAt: null,
        state: { in: ['APPROVAL', 'ERROR'] },
      });
      expect(out).toEqual([
        { state: 'ERROR', errorCategory: null, errorRetryable: null, count: 5 },
      ]);
    });

    it('publishedCount filters automation created PUBLISHED rows in the range', async () => {
      const { repo, post } = make();
      post.count.mockResolvedValue(7);
      expect(await repo.publishedCount('org-1', range)).toBe(7);
      expect(post.count.mock.calls[0][0].where).toMatchObject({
        organizationId: 'org-1',
        state: 'PUBLISHED',
        parentPostId: null,
        deletedAt: null,
        createdByType: { in: ['API_KEY', 'OAUTH_CLIENT'] },
        updatedAt: { gte: range.start, lt: range.end },
      });
    });

    it('automationActionCount counts resource audit events of automation actors', async () => {
      const { repo, audit } = make();
      audit.count.mockResolvedValue(4);
      expect(await repo.automationActionCount('org-1', range)).toBe(4);
      expect(audit.count.mock.calls[0][0].where).toEqual({
        organizationId: 'org-1',
        type: 'resource',
        actorType: { in: ['API_KEY', 'OAUTH_CLIENT'] },
        createdAt: { gte: range.start, lt: range.end },
      });
    });
  });

  describe('recentActors', () => {
    it('merges createdBy and lastModifiedBy identities, most recent first, deduplicated', async () => {
      const { repo, post } = make();
      const t = (h: number) => new Date(`2026-11-05T${String(h).padStart(2, '0')}:00:00.000Z`);
      post.groupBy
        .mockResolvedValueOnce([
          {
            createdByType: 'API_KEY',
            createdByUserId: null,
            createdByApiKeyId: 'k1',
            createdByOAuthClientId: null,
            _max: { updatedAt: t(8) },
          },
        ])
        .mockResolvedValueOnce([
          {
            lastModifiedByType: 'OAUTH_CLIENT',
            lastModifiedByUserId: 'u1',
            lastModifiedByApiKeyId: null,
            lastModifiedByOAuthClientId: 'c1',
            _max: { updatedAt: t(10) },
          },
          {
            lastModifiedByType: 'API_KEY',
            lastModifiedByUserId: null,
            lastModifiedByApiKeyId: 'k1',
            lastModifiedByOAuthClientId: null,
            _max: { updatedAt: t(9) },
          },
        ]);
      const since = new Date('2026-08-01T00:00:00Z');
      const out = await repo.recentActors('org-1', since);
      expect(post.groupBy).toHaveBeenCalledTimes(2);
      const first = post.groupBy.mock.calls[0][0];
      expect(first.by).toEqual([
        'createdByType',
        'createdByUserId',
        'createdByApiKeyId',
        'createdByOAuthClientId',
      ]);
      expect(first.where).toMatchObject({
        organizationId: 'org-1',
        parentPostId: null,
        deletedAt: null,
        createdByType: { in: ['API_KEY', 'OAUTH_CLIENT'] },
        updatedAt: { gte: since },
      });
      expect(first.take).toBe(50);
      expect(out).toEqual([
        { type: 'OAUTH_CLIENT', userId: 'u1', oauthClientId: 'c1' },
        { type: 'API_KEY', apiKeyId: 'k1' },
      ]);
    });
  });

  describe('recentProvenance', () => {
    it('returns distinct non-null values, at most 50 each', async () => {
      const { repo, post } = make();
      post.groupBy
        .mockResolvedValueOnce([
          { agentName: 'bot-a', _max: { updatedAt: new Date() } },
          { agentName: 'bot-b', _max: { updatedAt: new Date() } },
        ])
        .mockResolvedValueOnce([{ source: 'cron', _max: { updatedAt: new Date() } }]);
      const since = new Date('2026-08-01T00:00:00Z');
      const out = await repo.recentProvenance('org-1', since);
      expect(out).toEqual({ agentNames: ['bot-a', 'bot-b'], sources: ['cron'] });
      const [a, s] = post.groupBy.mock.calls.map((c) => c[0]);
      expect(a.by).toEqual(['agentName']);
      expect(a.where).toMatchObject({ organizationId: 'org-1', agentName: { not: null } });
      expect(s.by).toEqual(['source']);
      expect(a.take).toBe(50);
      expect(s.take).toBe(50);
    });
  });

  describe('detailRows', () => {
    it('is scoped to org and group, top level, not deleted, with the detail columns', async () => {
      const { repo, post } = make();
      await repo.detailRows('org-1', 'g1');
      const arg = post.findMany.mock.calls[0][0];
      expect(arg.where).toMatchObject({
        organizationId: 'org-1',
        group: 'g1',
        parentPostId: null,
        deletedAt: null,
        integration: { deletedAt: null },
      });
      expect(arg.select.lastPublishAttemptAt).toBe(true);
      expect(arg.select.firstComment).toBe(true);
      expect(arg.select.image).toBe(true);
      expect(arg.select.error).toBe(true);
      expect(JSON.stringify(arg.select)).not.toMatch(/token|"key"/i);
      expect(arg.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    });
  });

  describe('childRows', () => {
    it('returns [] without a query for no parents', async () => {
      const { repo, post } = make();
      expect(await repo.childRows('org-1', [])).toEqual([]);
      expect(post.findMany).not.toHaveBeenCalled();
    });

    it('walks the chain level by level, scoped to the org and not deleted', async () => {
      const { repo, post } = make();
      post.findMany
        .mockResolvedValueOnce([{ id: 'c1', parentPostId: 'p1', content: 'a', createdAt: new Date(1) }])
        .mockResolvedValueOnce([{ id: 'c2', parentPostId: 'c1', content: 'b', createdAt: new Date(2) }])
        .mockResolvedValueOnce([]);
      const out = await repo.childRows('org-1', ['p1']);
      expect(out).toEqual([
        { parentPostId: 'p1', content: 'a', createdAt: new Date(1), id: 'c1' },
        { parentPostId: 'c1', content: 'b', createdAt: new Date(2), id: 'c2' },
      ]);
      const first = post.findMany.mock.calls[0][0];
      expect(first.where).toMatchObject({
        organizationId: 'org-1',
        parentPostId: { in: ['p1'] },
        deletedAt: null,
      });
      expect(post.findMany.mock.calls[1][0].where.parentPostId).toEqual({ in: ['c1'] });
    });

    it('stops at a depth limit', async () => {
      const { repo, post } = make();
      let n = 0;
      post.findMany.mockImplementation(async () => [
        { id: `c${++n}`, parentPostId: 'x', content: '', createdAt: new Date(n) },
      ]);
      await repo.childRows('org-1', ['p1']);
      expect(post.findMany.mock.calls.length).toBeLessThanOrEqual(101);
    });
  });

  describe('approvalsFor', () => {
    it('selects explicit columns and never the guest token', async () => {
      const { repo, approval } = make();
      await repo.approvalsFor('org-1', ['p1']);
      const arg = approval.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ organizationId: 'org-1', postId: { in: ['p1'] } });
      expect(Object.keys(arg.select).sort()).toEqual(
        [
          'id', 'postId', 'status', 'note', 'requestedAt', 'resolvedAt',
          'requestedByType', 'requestedByUserId', 'requestedByApiKeyId',
          'requestedByOAuthClientId', 'decidedByType', 'approverId', 'guestName', 'guestEmail',
        ].sort()
      );
      expect(arg.select).not.toHaveProperty('guestToken');
      expect(arg.select).not.toHaveProperty('guestTokenExpiresAt');
    });

    it('returns [] without a query for no posts', async () => {
      const { repo, approval } = make();
      expect(await repo.approvalsFor('org-1', [])).toEqual([]);
      expect(approval.findMany).not.toHaveBeenCalled();
    });
  });
});
