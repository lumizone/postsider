jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { PostsService } from './posts.service';

const SECRET = 'my-private-post-content-123';

function build(overrides: Record<string, unknown> = {}) {
  const audit = { logResourceEvent: jest.fn().mockResolvedValue(undefined) };
  const repo = {
    createOrUpdatePost: jest.fn(),
    deletePost: jest.fn().mockResolvedValue({ id: 'p1' }),
    getPostById: jest.fn().mockResolvedValue({
      id: 'p1',
      state: 'DRAFT',
      integration: { providerIdentifier: 'x' },
    }),
    changeState: jest.fn().mockResolvedValue(undefined),
    changeDate: jest.fn().mockResolvedValue({ id: 'p1' }),
  };
  const svc: any = Object.create(PostsService.prototype);
  Object.assign(
    svc,
    {
      _audit: audit,
      _postRepository: repo,
      _logger: { error: jest.fn(), warn: jest.fn() },
      _temporalService: { client: { getRawClient: () => undefined } },
      _subscriptionService: {
        reserveMonthlyPostSlots: jest.fn().mockResolvedValue(null),
        reserveTrialXPosts: jest.fn().mockResolvedValue(null),
        releaseTrialXReservation: jest.fn().mockResolvedValue(undefined),
        releaseMonthlyPostReservation: jest.fn().mockResolvedValue(undefined),
      },
      _integrationService: { getIntegrationById: jest.fn().mockResolvedValue({ providerIdentifier: 'x' }) },
      _integrationManager: { getSocialIntegration: jest.fn().mockReturnValue({}) },
      _shortLinkService: {},
      assertOrgNotPausedForSchedule: jest.fn().mockResolvedValue(undefined),
      startWorkflow: jest.fn().mockResolvedValue(undefined),
      tiktokProblemsForStoredPost: jest.fn().mockResolvedValue([]),
      getTopLevelPostsByGroup: jest.fn(),
    },
    overrides
  );
  return { svc, audit, repo };
}

const body = (type = 'draft') =>
  ({
    type,
    date: new Date(Date.now() + 3_600_000).toISOString(),
    tags: [],
    shortLink: false,
    posts: [
      {
        integration: { id: 'int1' },
        settings: { __type: 'x' },
        value: [{ content: SECRET, image: [] }],
      },
    ],
  } as any);

describe('PostsService audit hooks', () => {
  it('emits post.created with creationMethod when the row was created', async () => {
    const { svc, audit, repo } = build();
    repo.createOrUpdatePost.mockResolvedValue({
      posts: [{ id: 'p1', state: 'DRAFT', group: 'g1', publishDate: new Date('2030-01-01T00:00:00Z') }],
      createdIds: ['p1'],
    });
    const res = await svc.createPost('o1', body(), 'api' as any);
    expect(res).toEqual([{ postId: 'p1', integration: 'int1' }]);
    expect(audit.logResourceEvent).toHaveBeenCalledTimes(1);
    const e = audit.logResourceEvent.mock.calls[0][0];
    expect(e).toMatchObject({ organizationId: 'o1', event: 'post.created', targetType: 'post', targetId: 'p1' });
    expect(e.metadata).toMatchObject({
      state: 'DRAFT',
      integrationId: 'int1',
      group: 'g1',
      publishDate: '2030-01-01T00:00:00.000Z',
      creationMethod: 'api',
    });
    expect(JSON.stringify(e.metadata)).not.toContain(SECRET);
  });

  it('emits post.updated without creationMethod when nothing was created', async () => {
    const { svc, audit, repo } = build();
    repo.createOrUpdatePost.mockResolvedValue({
      posts: [{ id: 'p1', state: 'DRAFT', group: 'g1', publishDate: new Date('2030-01-01T00:00:00Z') }],
      createdIds: [],
    });
    await svc.createPost('o1', body('update'), 'api' as any);
    const e = audit.logResourceEvent.mock.calls[0][0];
    expect(e.event).toBe('post.updated');
    expect(e.metadata).not.toHaveProperty('creationMethod');
  });

  it('still resolves when the audit writer rejects or is missing', async () => {
    const a = build();
    a.audit.logResourceEvent.mockRejectedValue(new Error('x'));
    a.repo.createOrUpdatePost.mockResolvedValue({
      posts: [{ id: 'p1', state: 'DRAFT', group: 'g1', publishDate: new Date() }],
      createdIds: ['p1'],
    });
    await expect(a.svc.createPost('o1', body(), 'api' as any)).resolves.toEqual([
      { postId: 'p1', integration: 'int1' },
    ]);
    const b = build({ _audit: undefined });
    b.repo.createOrUpdatePost.mockResolvedValue({
      posts: [{ id: 'p1', state: 'DRAFT', group: 'g1', publishDate: new Date() }],
      createdIds: ['p1'],
    });
    await expect(b.svc.createPost('o1', body(), 'api' as any)).resolves.toHaveLength(1);
  });

  it('deletePost emits one post.deleted per top-level row, none for an empty group', async () => {
    const { svc, audit } = build();
    svc.getTopLevelPostsByGroup.mockResolvedValue([
      { id: 'a', integrationId: 'i1' },
      { id: 'b', integrationId: 'i2' },
    ]);
    await expect(svc.deletePost('o1', 'g1')).resolves.toEqual({ success: true });
    expect(audit.logResourceEvent.mock.calls.map((c: any) => [c[0].event, c[0].targetId, c[0].metadata])).toEqual([
      ['post.deleted', 'a', { group: 'g1', integrationId: 'i1' }],
      ['post.deleted', 'b', { group: 'g1', integrationId: 'i2' }],
    ]);

    audit.logResourceEvent.mockClear();
    svc.getTopLevelPostsByGroup.mockResolvedValue([]);
    await svc.deletePost('o1', 'g2');
    expect(audit.logResourceEvent).not.toHaveBeenCalled();
  });

  it('changePostStatus emits status_changed with from and to', async () => {
    const { svc, audit } = build();
    await svc.changePostStatus('o1', 'p1', 'schedule');
    expect(audit.logResourceEvent).toHaveBeenCalledTimes(1);
    expect(audit.logResourceEvent.mock.calls[0][0]).toMatchObject({
      event: 'post.status_changed',
      targetId: 'p1',
      metadata: { from: 'DRAFT', to: 'QUEUE' },
    });
  });

  it('changeDate emits status_changed for schedule and updated for update', async () => {
    const { svc, audit } = build();
    await svc.changeDate('o1', 'p1', '2030-01-01T00:00:00.000Z', 'schedule');
    expect(audit.logResourceEvent.mock.calls[0][0]).toMatchObject({
      event: 'post.status_changed',
      metadata: { from: 'DRAFT', to: 'QUEUE' },
    });
    audit.logResourceEvent.mockClear();
    await svc.changeDate('o1', 'p1', '2030-01-01T00:00:00.000Z', 'update');
    expect(audit.logResourceEvent.mock.calls[0][0]).toMatchObject({
      event: 'post.updated',
      metadata: { publishDate: '2030-01-01T00:00:00.000Z' },
    });
  });

  it('setPostState emits status_changed', async () => {
    const { svc, audit } = build();
    await svc.setPostState('o1', 'p1', 'APPROVAL' as any);
    expect(audit.logResourceEvent.mock.calls[0][0]).toMatchObject({
      event: 'post.status_changed',
      metadata: { from: 'DRAFT', to: 'APPROVAL' },
    });
  });

  it('retryFailedByGroup emits exactly one retry_requested for the requeued row', async () => {
    const { svc, audit } = build();
    svc.getTopLevelPostsByGroup.mockResolvedValue([
      {
        id: 'A',
        state: 'ERROR',
        integrationId: 'iA',
        errorCategory: 'RATE_LIMITED',
        releaseId: null,
        integration: { providerIdentifier: 'x' },
      },
      {
        id: 'B',
        state: 'PUBLISHED',
        integrationId: 'iB',
        errorCategory: null,
        releaseId: null,
        integration: { providerIdentifier: 'x' },
      },
    ]);
    svc.claimErrorForRetry = jest.fn().mockResolvedValue(true);
    await svc.retryFailedByGroup('o1', 'g1', { includeUnknownOutcome: true });
    expect(audit.logResourceEvent).toHaveBeenCalledTimes(1);
    expect(audit.logResourceEvent.mock.calls[0][0]).toMatchObject({
      event: 'post.retry_requested',
      targetId: 'A',
      metadata: { includeUnknownOutcome: true, previousErrorCategory: 'RATE_LIMITED' },
    });
  });
});
