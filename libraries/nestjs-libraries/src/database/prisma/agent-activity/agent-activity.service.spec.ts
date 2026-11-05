import { BadRequestException } from '@nestjs/common';
import { AgentActivityService } from './agent-activity.service';
import { encodeGroupCursor, decodeGroupCursor } from '../../../agent-activity/activity-cursor';
import { buildActivityWhere } from '../../../agent-activity/activity-where';

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 5, h, m));

const baseRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  group: 'g1',
  state: 'QUEUE',
  publishDate: T(10),
  updatedAt: T(9),
  content: '<p>Hi</p>',
  image: null,
  error: null,
  errorCategory: null,
  errorRetryable: null,
  publishAttempts: 0,
  releaseId: null,
  releaseURL: null,
  integrationId: 'i1',
  createdByType: null,
  createdByUserId: null,
  createdByApiKeyId: null,
  createdByOAuthClientId: null,
  lastModifiedByType: null,
  lastModifiedByUserId: null,
  lastModifiedByApiKeyId: null,
  lastModifiedByOAuthClientId: null,
  agentName: null,
  workflowId: null,
  runId: null,
  externalRef: null,
  source: null,
  integration: { id: 'i1', name: 'Chan', providerIdentifier: 'x', picture: null },
  ...over,
});

const make = () => {
  const repo = {
    pageGroups: jest.fn().mockResolvedValue([]),
    rowsForGroups: jest.fn().mockResolvedValue([]),
    pendingApprovalIds: jest.fn().mockResolvedValue([]),
    openCounts: jest.fn().mockResolvedValue([]),
    publishedCount: jest.fn().mockResolvedValue(0),
    automationActionCount: jest.fn().mockResolvedValue(0),
    recentActors: jest.fn().mockResolvedValue([]),
    recentProvenance: jest.fn().mockResolvedValue({ agentNames: [], sources: [] }),
  };
  const resolver = jest.fn((v: any) =>
    v ? { type: v.type, id: v.apiKeyId ?? v.oauthClientId ?? null, name: 'N', state: 'ok', authorizedBy: null } : null
  );
  const directory = { resolve: jest.fn().mockResolvedValue(resolver) };
  const svc = new AgentActivityService(repo as any, directory as any);
  return { svc, repo, directory, resolver };
};

const filters = { bucket: 'attention', scope: 'relevant' } as const;

describe('AgentActivityService.summary', () => {
  it('reduces open counts through the bucket mapping', async () => {
    const { svc, repo } = make();
    repo.openCounts.mockResolvedValue([
      { state: 'APPROVAL', errorCategory: null, errorRetryable: null, count: 3 },
      { state: 'ERROR', errorCategory: 'POLICY_BLOCKED', errorRetryable: false, count: 1 },
      { state: 'ERROR', errorCategory: 'UNKNOWN_OUTCOME', errorRetryable: null, count: 2 },
      { state: 'ERROR', errorCategory: 'RATE_LIMITED', errorRetryable: true, count: 4 },
      { state: 'ERROR', errorCategory: null, errorRetryable: null, count: 5 },
    ]);
    repo.automationActionCount.mockResolvedValue(9);
    repo.publishedCount.mockResolvedValue(6);
    const out = await svc.summary('org-1', {
      timezone: 'UTC',
      now: new Date('2026-11-05T12:00:00Z'),
    });
    expect(out).toEqual({
      timezone: 'UTC',
      dayStart: '2026-11-05T00:00:00.000Z',
      dayEnd: '2026-11-06T00:00:00.000Z',
      actionsToday: 9,
      waitingForReview: 3,
      policyBlocked: 1,
      failed: { total: 11, retryable: 4, unknownOutcome: 2, other: 5 },
      publishedToday: 6,
    });
  });

  it('computes day bounds from now in the resolved zone and passes them on', async () => {
    const { svc, repo } = make();
    const out = await svc.summary('org-1', {
      timezone: 'Europe/Warsaw',
      now: new Date('2026-11-05T12:00:00Z'),
    });
    expect(out.timezone).toBe('Europe/Warsaw');
    const range = { start: new Date('2026-11-04T23:00:00Z'), end: new Date('2026-11-05T23:00:00Z') };
    expect(repo.publishedCount).toHaveBeenCalledWith('org-1', range);
    expect(repo.automationActionCount).toHaveBeenCalledWith('org-1', range);
  });

  it('falls back from a bad zone to the org default, then UTC, without throwing', async () => {
    const { svc } = make();
    const now = new Date('2026-11-05T12:00:00Z');
    expect((await svc.summary('o', { timezone: 'bad', orgDefaultTimezone: 'Europe/Warsaw', now })).timezone).toBe('Europe/Warsaw');
    expect((await svc.summary('o', { timezone: 'bad', orgDefaultTimezone: 'worse', now })).timezone).toBe('UTC');
    expect((await svc.summary('o', { now })).timezone).toBe('UTC');
  });
});

describe('AgentActivityService.list', () => {
  it('builds the where, asks for limit + 1 groups and reports no next page when it fits', async () => {
    const { svc, repo } = make();
    repo.pageGroups.mockResolvedValue([{ group: 'g1', updatedAt: T(9) }]);
    repo.rowsForGroups.mockResolvedValue([baseRow()]);
    const out = await svc.list('org-1', { ...filters, limit: 2 });
    expect(repo.pageGroups).toHaveBeenCalledWith(
      'org-1',
      buildActivityWhere('org-1', { ...filters }),
      null,
      3
    );
    expect(out.nextCursor).toBeNull();
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0].group).toBe('g1');
  });

  it('returns a decodable nextCursor only when more than limit came back, and fetches rows for the page only', async () => {
    const { svc, repo } = make();
    repo.pageGroups.mockResolvedValue([
      { group: 'g3', updatedAt: T(9) },
      { group: 'g2', updatedAt: T(8) },
      { group: 'g1', updatedAt: T(7) },
    ]);
    repo.rowsForGroups.mockResolvedValue([
      baseRow({ id: 'a', group: 'g3' }),
      baseRow({ id: 'b', group: 'g2' }),
    ]);
    const out = await svc.list('org-1', { ...filters, limit: 2 });
    expect(repo.rowsForGroups).toHaveBeenCalledTimes(1);
    expect(repo.rowsForGroups).toHaveBeenCalledWith('org-1', ['g3', 'g2']);
    expect(out.groups.map((g) => g.group)).toEqual(['g3', 'g2']);
    expect(decodeGroupCursor(out.nextCursor as string)).toEqual({ updatedAt: T(8), group: 'g2' });
  });

  it('passes a decoded cursor to the repository', async () => {
    const { svc, repo } = make();
    const cursor = encodeGroupCursor({ updatedAt: T(8), group: 'g2' });
    await svc.list('org-1', { ...filters, limit: 5, cursor });
    expect(repo.pageGroups.mock.calls[0][2]).toEqual({ updatedAt: T(8), group: 'g2' });
    expect(repo.rowsForGroups).not.toHaveBeenCalled();
  });

  it('keeps the page order, also for equal updatedAt (group desc), whatever order rows come back in', async () => {
    const { svc, repo } = make();
    repo.pageGroups.mockResolvedValue([
      { group: 'gb', updatedAt: T(9) },
      { group: 'ga', updatedAt: T(9) },
    ]);
    repo.rowsForGroups.mockResolvedValue([
      baseRow({ id: 'x', group: 'ga', updatedAt: T(9) }),
      baseRow({ id: 'y', group: 'gb', updatedAt: T(9) }),
    ]);
    const out = await svc.list('org-1', { ...filters, limit: 10 });
    expect(out.groups.map((g) => g.group)).toEqual(['gb', 'ga']);
  });

  it('attaches pending approval ids to their group', async () => {
    const { svc, repo } = make();
    repo.pageGroups.mockResolvedValue([
      { group: 'g1', updatedAt: T(9) },
      { group: 'g2', updatedAt: T(8) },
    ]);
    repo.rowsForGroups.mockResolvedValue([
      baseRow({ id: 'p1', group: 'g1', state: 'APPROVAL' }),
      baseRow({ id: 'p2', group: 'g2' }),
    ]);
    repo.pendingApprovalIds.mockResolvedValue([{ id: 'ap1', postId: 'p1' }]);
    const out = await svc.list('org-1', { ...filters, limit: 10 });
    expect(repo.pendingApprovalIds).toHaveBeenCalledWith('org-1', ['p1', 'p2']);
    expect(out.groups[0].pendingApprovalIds).toEqual(['ap1']);
    expect(out.groups[1].pendingApprovalIds).toEqual([]);
  });

  it('resolves actors with exactly one directory call for the org', async () => {
    const { svc, repo, directory } = make();
    repo.pageGroups.mockResolvedValue([
      { group: 'g1', updatedAt: T(9) },
      { group: 'g2', updatedAt: T(8) },
    ]);
    repo.rowsForGroups.mockResolvedValue([
      baseRow({ id: 'p1', group: 'g1', createdByType: 'API_KEY', createdByApiKeyId: 'k1' }),
      baseRow({ id: 'p2', group: 'g2', createdByType: 'API_KEY', createdByApiKeyId: 'k2' }),
    ]);
    const out = await svc.list('org-1', { ...filters, limit: 10 });
    expect(directory.resolve).toHaveBeenCalledTimes(1);
    expect(directory.resolve.mock.calls[0][0]).toBe('org-1');
    const views = directory.resolve.mock.calls[0][1].filter(Boolean);
    expect(views).toEqual(
      expect.arrayContaining([
        { type: 'API_KEY', apiKeyId: 'k1' },
        { type: 'API_KEY', apiKeyId: 'k2' },
      ])
    );
    expect(out.groups[0].createdBy?.name).toBe('N');
  });

  it('turns a request actor string into a filter and rejects a bad one', async () => {
    const { svc, repo } = make();
    await svc.list('org-1', { ...filters, limit: 5, actor: 'API_KEY:legacy' });
    expect(repo.pageGroups.mock.calls[0][1]).toEqual(
      buildActivityWhere('org-1', { ...filters, actor: { type: 'API_KEY', id: null } })
    );
    await expect(svc.list('org-1', { ...filters, limit: 5, actor: 'nope' })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('rejects a bad cursor and from > to with 400 before touching the database', async () => {
    const { svc, repo } = make();
    await expect(svc.list('org-1', { ...filters, limit: 5, cursor: '%%%' })).rejects.toBeInstanceOf(
      BadRequestException
    );
    await expect(
      svc.list('org-1', { ...filters, limit: 5, from: T(10), to: T(9) })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.pageGroups).not.toHaveBeenCalled();
  });
});

describe('AgentActivityService.filters', () => {
  it('returns actor keys, resolved names, provenance and a 90 day window', async () => {
    const { svc, repo, directory } = make();
    repo.recentActors.mockResolvedValue([
      { type: 'API_KEY' },
      { type: 'API_KEY', apiKeyId: 'k1' },
      { type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u1' },
      { type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u2' },
      { type: 'OAUTH_CLIENT' },
    ]);
    repo.recentProvenance.mockResolvedValue({ agentNames: ['bot'], sources: ['cron'] });
    const now = new Date('2026-11-05T12:00:00Z');
    const out = await svc.filters('org-1', now);
    const since = new Date('2026-08-07T12:00:00Z');
    expect(repo.recentActors).toHaveBeenCalledWith('org-1', since);
    expect(repo.recentProvenance).toHaveBeenCalledWith('org-1', since);
    expect(directory.resolve).toHaveBeenCalledTimes(1);
    expect(out.actors.map((a) => a.key)).toEqual(['API_KEY:legacy', 'API_KEY:k1', 'OAUTH_CLIENT:c1']);
    expect(out.actors[1]).toEqual({ key: 'API_KEY:k1', type: 'API_KEY', id: 'k1', name: 'N', state: 'ok' });
    expect(out.agentNames).toEqual(['bot']);
    expect(out.sources).toEqual(['cron']);
  });
});
