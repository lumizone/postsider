import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
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
    detailRows: jest.fn().mockResolvedValue([]),
    childRows: jest.fn().mockResolvedValue([]),
    approvalsFor: jest.fn().mockResolvedValue([]),
  };
  const audit = { list: jest.fn().mockResolvedValue({ events: [], nextCursor: null }) };
  const posts = { getPostIdsInGroupIncludingDeleted: jest.fn().mockResolvedValue(['p1', 'c1', 'gone']) };
  const policy = {
    targetFromStoredPost: jest.fn(async (_o: string, postId: string, opts: any) => ({ postId, ...opts })),
    evaluateTargets: jest.fn().mockResolvedValue({ effect: 'ALLOW', matched: [], channels: [] }),
  };
  const resolver = jest.fn((v: any) =>
    v ? { type: v.type, id: v.apiKeyId ?? v.oauthClientId ?? null, name: 'N', state: 'ok', authorizedBy: null } : null
  );
  const directory = { resolve: jest.fn().mockResolvedValue(resolver) };
  const svc = new AgentActivityService(repo as any, directory as any, audit as any, posts as any, policy as any);
  return { svc, repo, directory, resolver, audit, posts, policy };
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

  it('rejects an invalid from or to date with 400', async () => {
    const { svc, repo } = make();
    await expect(
      svc.list('org-1', { ...filters, limit: 5, from: new Date('x'), to: T(9) })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.list('org-1', { ...filters, limit: 5, to: new Date('x') })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.pageGroups).not.toHaveBeenCalled();
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
    expect(out.agentNames).toEqual([{ value: 'bot', label: 'bot' }]);
    expect(out.sources).toEqual([{ value: 'cron', label: 'cron' }]);
  });

  it('returns the raw value for filtering and a cleaned label for display', async () => {
    const { svc, repo } = make();
    repo.recentActors.mockResolvedValue([]);
    repo.recentProvenance.mockResolvedValue({
      agentNames: ['bo\u202Et', '\u200B'],
      sources: ['\u2066cron'],
    });
    const out = await svc.filters('org-1', new Date('2026-11-05T12:00:00Z'));
    expect(out.agentNames).toEqual([{ value: 'bo\u202Et', label: 'bot' }]);
    expect(out.sources).toEqual([{ value: '\u2066cron', label: 'cron' }]);
  });
});

describe('AgentActivityService.detail', () => {
  const detailRow = (over: Record<string, unknown> = {}) =>
    baseRow({ lastPublishAttemptAt: null, firstComment: null, ...over });
  const ev = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    type: 'post.created',
    createdAt: T(8),
    actor: { type: 'SYSTEM' },
    target: { type: 'post', id: 'p1' },
    metadata: {},
    ...over,
  });
  const approvalRow = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    postId: 'p1',
    status: 'PENDING',
    note: null,
    requestedAt: T(7),
    resolvedAt: null,
    requestedByType: 'API_KEY',
    requestedByUserId: null,
    requestedByApiKeyId: 'k1',
    requestedByOAuthClientId: null,
    decidedByType: null,
    approverId: null,
    guestName: null,
    guestEmail: null,
    ...over,
  });

  it('throws NotFoundException for a group without rows and queries nothing else', async () => {
    const { svc, repo, audit } = make();
    await expect(svc.detail('org-1', 'nope')).rejects.toThrow(new NotFoundException('Group not found'));
    expect(repo.detailRows).toHaveBeenCalledWith('org-1', 'nope');
    expect(repo.approvalsFor).not.toHaveBeenCalled();
    expect(audit.list).not.toHaveBeenCalled();
  });

  it('builds destinations with plain text, thread order, trimmed error and raw image', async () => {
    const { svc, repo } = make();
    repo.detailRows.mockResolvedValue([
      detailRow({
        content: '<p>Hello <b>world</b></p><p>Second</p>',
        image: '[{"id":"m","path":"https://x/y.png"}]',
        state: 'ERROR',
        error: 'e'.repeat(900),
        errorCategory: 'RATE_LIMITED',
        errorRetryable: true,
        lastPublishAttemptAt: T(9, 30),
        firstComment: '<p>first</p>',
      }),
    ]);
    repo.childRows.mockResolvedValue([
      { id: 'c2', parentPostId: 'c1', content: '<p>third</p>', createdAt: T(2) },
      { id: 'c1', parentPostId: 'p1', content: '<p>second</p>', createdAt: T(1) },
    ]);
    const out = await svc.detail('org-1', 'g1');
    expect(repo.childRows).toHaveBeenCalledWith('org-1', ['p1']);
    const d = out.destinations[0];
    expect(d.contentText).toBe('Hello world\nSecond');
    expect(d.thread).toEqual(['second', 'third']);
    expect(d.firstComment).toBe('first');
    expect(Array.from(d.errorMessage as string).length).toBe(500);
    expect(d.image).toBe('[{"id":"m","path":"https://x/y.png"}]');
    expect(d.bucket).toBe('retryable');
    expect(d.lastPublishAttemptAt).toEqual(T(9, 30));
    expect(d.integration).toEqual({ id: 'i1', name: 'Chan', providerIdentifier: 'x', picture: null });
    expect(d.approval).toBeNull();
    expect(out.group).toBe('g1');
    expect(out.updatedAt).toEqual(T(9));
  });

  it('uses one batched call per lookup', async () => {
    const { svc, repo, audit, directory, posts } = make();
    repo.detailRows.mockResolvedValue([detailRow(), detailRow({ id: 'p2', integrationId: 'i2' })]);
    await svc.detail('org-1', 'g1');
    expect(repo.detailRows).toHaveBeenCalledTimes(1);
    expect(repo.childRows).toHaveBeenCalledTimes(1);
    expect(repo.approvalsFor).toHaveBeenCalledWith('org-1', ['p1', 'p2']);
    expect(repo.approvalsFor).toHaveBeenCalledTimes(1);
    expect(posts.getPostIdsInGroupIncludingDeleted).toHaveBeenCalledWith('org-1', 'p1');
    expect(audit.list).toHaveBeenCalledTimes(1);
    expect(audit.list).toHaveBeenCalledWith('org-1', {
      targetType: 'post',
      targetIds: ['p1', 'c1', 'gone'],
      limit: 100,
    });
    expect(directory.resolve).toHaveBeenCalledTimes(1);
  });

  it('resolves the approval requester and a USER decider', async () => {
    const { svc, repo, resolver } = make();
    repo.detailRows.mockResolvedValue([detailRow({ state: 'APPROVAL' })]);
    repo.approvalsFor.mockResolvedValue([
      approvalRow({ status: 'APPROVED', note: 'ok\u202E!', decidedByType: 'USER', approverId: 'u1', resolvedAt: T(8) }),
    ]);
    const out = await svc.detail('org-1', 'g1');
    const a = out.destinations[0].approval as any;
    expect(a).toMatchObject({ id: 'a1', status: 'APPROVED', note: 'ok!', resolvedAt: T(8) });
    expect(a.requestedBy).toMatchObject({ type: 'API_KEY', id: 'k1' });
    expect(a.decidedBy).toMatchObject({ type: 'USER', name: 'N' });
    expect(resolver).toHaveBeenCalled();
  });

  it('shows a guest decider with a cleaned name and email and no token anywhere', async () => {
    const { svc, repo } = make();
    repo.detailRows.mockResolvedValue([detailRow({ state: 'APPROVAL' })]);
    repo.approvalsFor.mockResolvedValue([
      {
        ...approvalRow({ status: 'REJECTED', guestName: 'Gu\u202Eest', guestEmail: 'g@x.io\u200B' }),
        guestToken: 'SECRET-TOKEN',
        guestTokenExpiresAt: T(1),
      },
    ]);
    const out = await svc.detail('org-1', 'g1');
    const a = out.destinations[0].approval as any;
    expect(a.decidedBy).toEqual({ type: 'GUEST', name: 'Guest', email: 'g@x.io' });
    const json = JSON.stringify(out);
    expect(json).not.toContain('guestToken');
    expect(json).not.toContain('SECRET-TOKEN');
    expect(json).not.toMatch(/token/i);
  });

  it('maps timeline events newest first with resolved actors and a GUEST actor', async () => {
    const { svc, repo, audit, directory } = make();
    repo.detailRows.mockResolvedValue([detailRow()]);
    audit.list.mockResolvedValue({
      events: [
        ev({ id: 'e2', type: 'post.approval_resolved', actor: { type: 'GUEST' }, metadata: { by: 'guest' } }),
        ev({ id: 'e1', actor: { type: 'API_KEY', apiKeyId: 'k1' }, metadata: { ruleNames: 'a\u202Eb', matchedCount: 3, guestToken: 'secret', nested: { s: 'x' } } }),
      ],
      nextCursor: null,
    });
    const out = await svc.detail('org-1', 'g1');
    expect(out.timeline).toHaveLength(2);
    expect(out.timeline[0]).toMatchObject({ id: 'e2', type: 'post.approval_resolved', postId: 'p1', actor: { type: 'GUEST' } });
    expect(out.timeline[0].actor).not.toHaveProperty('name');
    expect(out.timeline[1].actor).toMatchObject({ type: 'API_KEY', id: 'k1' });
    expect(out.timeline[1].metadata).toEqual({ ruleNames: 'ab', matchedCount: 3 });
    const views = directory.resolve.mock.calls[0][1];
    expect(views).toContainEqual({ type: 'API_KEY', apiKeyId: 'k1' });
    expect(JSON.stringify(views)).not.toContain('GUEST');
  });

  it('keeps the name of a revoked key actor in the timeline', async () => {
    const { svc, repo, audit, directory } = make();
    directory.resolve.mockResolvedValue((v: any) =>
      v ? { type: v.type, id: v.apiKeyId ?? null, name: 'Old key', state: 'revoked', authorizedBy: null } : null
    );
    repo.detailRows.mockResolvedValue([detailRow()]);
    audit.list.mockResolvedValue({ events: [ev({ actor: { type: 'API_KEY', apiKeyId: 'k9' } })], nextCursor: null });
    const out = await svc.detail('org-1', 'g1');
    expect(out.timeline[0].actor).toMatchObject({ name: 'Old key', state: 'revoked' });
  });

  it('cleans claimed provenance and the channel name', async () => {
    const { svc, repo } = make();
    repo.detailRows.mockResolvedValue([
      detailRow({ agentName: 'bo\u202Et', source: '\u2066cron', integration: { id: 'i1', name: 'Ch\u202Ean', providerIdentifier: 'x', picture: null } }),
    ]);
    const out = await svc.detail('org-1', 'g1');
    expect(out.destinations[0].claimed).toMatchObject({ agentName: 'bot', source: 'cron' });
    expect(out.destinations[0].integration.name).toBe('Chan');
  });

  describe('policy.recorded', () => {
    it('parses the newest policy_evaluated event', async () => {
      const { svc, repo, audit } = make();
      repo.detailRows.mockResolvedValue([detailRow()]);
      audit.list.mockResolvedValue({
        events: [
          ev({ id: 'e3', type: 'post.created' }),
          ev({
            id: 'e2',
            type: 'post.policy_evaluated',
            createdAt: T(8, 30),
            metadata: { effect: 'REQUIRE_APPROVAL', phase: 'write', matchedCount: 2, ruleNames: 'No links | Night\u202E window' },
          }),
          ev({ id: 'e1', type: 'post.policy_evaluated', metadata: { effect: 'ALLOW', phase: 'publish', matchedCount: 0, ruleNames: '' } }),
        ],
        nextCursor: null,
      });
      const out = await svc.detail('org-1', 'g1');
      expect(out.policy.recorded).toEqual({
        effect: 'REQUIRE_APPROVAL',
        phase: 'write',
        at: T(8, 30),
        ruleNames: ['No links', 'Night window'],
        matchedCount: 2,
      });
    });

    it('is null without such an event', async () => {
      const { svc, repo } = make();
      repo.detailRows.mockResolvedValue([detailRow()]);
      expect((await svc.detail('org-1', 'g1')).policy.recorded).toBeNull();
    });
  });

  describe('policy.current', () => {
    it('evaluates evaluable destinations with approved only for an APPROVED approval', async () => {
      const { svc, repo, policy } = make();
      repo.detailRows.mockResolvedValue([
        detailRow({ id: 'p1', state: 'QUEUE' }),
        detailRow({ id: 'p2', state: 'PUBLISHED' }),
        detailRow({ id: 'p3', state: 'ERROR' }),
      ]);
      repo.approvalsFor.mockResolvedValue([approvalRow({ postId: 'p1', status: 'APPROVED' }), approvalRow({ id: 'a3', postId: 'p3', status: 'REJECTED' })]);
      policy.evaluateTargets.mockResolvedValue({
        effect: 'BLOCK',
        matched: [{ ruleId: 'r1', name: 'No\u202E links', effect: 'BLOCK', condition: 'TEXT_CONTAINS' }],
        channels: [],
      });
      const out = await svc.detail('org-1', 'g1');
      expect(policy.targetFromStoredPost).toHaveBeenCalledTimes(2);
      expect(policy.targetFromStoredPost).toHaveBeenCalledWith('org-1', 'p1', { action: 'SCHEDULE', approved: true });
      expect(policy.targetFromStoredPost).toHaveBeenCalledWith('org-1', 'p3', { action: 'SCHEDULE', approved: false });
      expect(policy.evaluateTargets).toHaveBeenCalledWith('org-1', expect.any(Array), 'publish');
      expect(policy.evaluateTargets.mock.calls[0][1]).toHaveLength(2);
      expect(out.policy.current).toEqual({
        effect: 'BLOCK',
        matched: [{ ruleId: 'r1', name: 'No links', effect: 'BLOCK', condition: 'TEXT_CONTAINS' }],
      });
    });

    it('is null when every destination is PUBLISHED', async () => {
      const { svc, repo, policy } = make();
      repo.detailRows.mockResolvedValue([detailRow({ state: 'PUBLISHED' })]);
      const out = await svc.detail('org-1', 'g1');
      expect(out.policy.current).toBeNull();
      expect(policy.evaluateTargets).not.toHaveBeenCalled();
    });

    it('is null when the policy service is absent', async () => {
      const { repo, directory, audit, posts } = make();
      repo.detailRows.mockResolvedValue([detailRow()]);
      const svc = new AgentActivityService(repo as any, directory as any, audit as any, posts as any);
      expect((await svc.detail('org-1', 'g1')).policy.current).toBeNull();
    });

    it('is null and the detail still resolves when the evaluation throws', async () => {
      const { svc, repo, policy } = make();
      repo.detailRows.mockResolvedValue([detailRow()]);
      policy.evaluateTargets.mockRejectedValue(new Error('too large'));
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const out = await svc.detail('org-1', 'g1');
      expect(out.policy.current).toBeNull();
      expect(out.destinations).toHaveLength(1);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('is null when no stored target could be built', async () => {
      const { svc, repo, policy } = make();
      repo.detailRows.mockResolvedValue([detailRow()]);
      policy.targetFromStoredPost.mockResolvedValue(null);
      expect((await svc.detail('org-1', 'g1')).policy.current).toBeNull();
      expect(policy.evaluateTargets).not.toHaveBeenCalled();
    });
  });
});
