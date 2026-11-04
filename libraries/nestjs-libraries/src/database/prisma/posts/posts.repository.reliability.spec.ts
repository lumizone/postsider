import { PostsRepository } from './posts.repository';

const build = () => {
  const post = {
    model: {
      post: {
        update: jest.fn().mockResolvedValue({
          organizationId: 'o',
          integration: { providerIdentifier: 'x' },
          id: 'p1',
        }),
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
    },
  };
  const tagsPostsMock = {
    model: { tagsPosts: { deleteMany: jest.fn().mockResolvedValue(undefined) } },
  };
  const errorsMock = {
    model: { errors: { create: jest.fn().mockResolvedValue(undefined) } },
  };
  const repo = new PostsRepository(
    post as any,
    {} as any,
    {} as any,
    {} as any,
    tagsPostsMock as any,
    errorsMock as any,
    {} as any
  );
  return { repo, p: post.model.post };
};

const NULLS = { error: null, errorCategory: null, errorRetryable: null };
const body = (extra: any = {}) =>
  ({
    integration: { id: 'c' },
    settings: { __type: 'x' },
    value: [{ content: 'hi', image: [], ...extra }],
  } as any);

describe('PostsRepository reliability', () => {
  it('changeState ERROR writes category and retryable from meta', async () => {
    const { repo, p } = build();
    await repo.changeState('p1', 'ERROR', 'boom', [{}], 'org-1', {
      category: 'RATE_LIMITED',
      retryable: true,
    });
    expect(p.update.mock.calls[0][0].data).toMatchObject({
      state: 'ERROR',
      error: 'boom',
      errorCategory: 'RATE_LIMITED',
      errorRetryable: true,
    });
  });

  it('changeState ERROR defaults to UNKNOWN / not retryable', async () => {
    const { repo, p } = build();
    await repo.changeState('p1', 'ERROR', 'boom');
    expect(p.update.mock.calls[0][0].data).toMatchObject({
      errorCategory: 'UNKNOWN',
      errorRetryable: false,
    });
  });

  it.each(['QUEUE', 'DRAFT'] as const)('changeState %s clears error meta', async (s) => {
    const { repo, p } = build();
    await repo.changeState('p1', s, undefined, undefined, 'org-1');
    expect(p.update.mock.calls[0][0].data).toMatchObject(NULLS);
  });

  it.each(['HELD', 'PUBLISHED'] as const)('changeState %s leaves error meta alone', async (s) => {
    const { repo, p } = build();
    await repo.changeState('p1', s as any, undefined, undefined, 'org-1');
    expect(p.update.mock.calls[0][0].data).not.toHaveProperty('errorCategory');
  });

  it('updatePost clears error meta', async () => {
    const { repo, p } = build();
    await repo.updatePost('p1', 'rel-1', 'https://x');
    expect(p.update.mock.calls[0][0].data).toMatchObject({
      state: 'PUBLISHED',
      releaseId: 'rel-1',
      ...NULLS,
    });
  });

  describe('changeDate', () => {
    it.each(['ERROR', 'QUEUE', 'DRAFT'])('schedule on %s row nulls release and error fields', async (state) => {
      const { repo, p } = build();
      p.findFirst.mockResolvedValue({ state });
      await repo.changeDate('org', 'p1', '2026-12-01T10:00:00Z', false, 'schedule');
      expect(p.update.mock.calls[0][0].data).toMatchObject({
        state: 'QUEUE',
        releaseId: null,
        releaseURL: null,
        ...NULLS,
      });
    });

    it('schedule on a PUBLISHED row keeps releaseId/releaseURL', async () => {
      const { repo, p } = build();
      p.findFirst.mockResolvedValue({ state: 'PUBLISHED' });
      await repo.changeDate('org', 'p1', '2026-12-01T10:00:00Z', false, 'schedule');
      const data = p.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('releaseId');
      expect(data).not.toHaveProperty('releaseURL');
      expect(data).toMatchObject({ state: 'QUEUE', ...NULLS });
    });

    it('update action writes none of those keys', async () => {
      const { repo, p } = build();
      await repo.changeDate('org', 'p1', '2026-12-01T10:00:00Z', false, 'update');
      const data = p.update.mock.calls[0][0].data;
      for (const k of ['state', 'releaseId', 'releaseURL', 'error', 'errorCategory', 'errorRetryable']) {
        expect(data).not.toHaveProperty(k);
      }
    });
  });

  it('recordPublishAttempt increments attempts', async () => {
    const { repo, p } = build();
    await repo.recordPublishAttempt('org-1', 'p1');
    expect(p.update).toHaveBeenCalledWith({
      where: { id: 'p1', organizationId: 'org-1' },
      data: {
        publishAttempts: { increment: 1 },
        lastPublishAttemptAt: expect.any(Date),
      },
    });
  });

  it('claimErrorForRetry is a conditional ERROR -> QUEUE claim', async () => {
    const { repo, p } = build();
    p.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(repo.claimErrorForRetry('org-1', 'p1')).resolves.toBe(true);
    expect(p.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'p1', organizationId: 'org-1', state: 'ERROR', deletedAt: null },
      data: { state: 'QUEUE', ...NULLS },
    });
    await expect(repo.claimErrorForRetry('org-1', 'p1')).resolves.toBe(false);
  });

  it('getTopLevelPostsByGroup scopes by org, group and top level', async () => {
    const { repo, p } = build();
    await repo.getTopLevelPostsByGroup('org-1', 'g1');
    expect(p.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      group: 'g1',
      deletedAt: null,
      parentPostId: null,
    });
  });

  describe('createOrUpdatePost', () => {
    const run = (repo: PostsRepository, state: any, b: any) =>
      repo.createOrUpdatePost(state, 'org-1', '2026-12-01T10:00:00Z', b, [], 'API' as any);

    it('schedule on a new row: create and update both null release and error fields', async () => {
      const { repo, p } = build();
      await run(repo, 'schedule', body());
      const arg = p.upsert.mock.calls[0][0];
      for (const d of [arg.create, arg.update]) {
        expect(d).toMatchObject({ releaseId: null, releaseURL: null, ...NULLS });
      }
    });

    it.each(['ERROR', 'QUEUE', 'DRAFT'])('schedule on existing %s row nulls release', async (state) => {
      const { repo, p } = build();
      p.findFirst.mockResolvedValue({ id: 'p1', state });
      await run(repo, 'schedule', body({ id: 'p1' }));
      expect(p.upsert.mock.calls[0][0].update).toMatchObject({
        releaseId: null,
        releaseURL: null,
        ...NULLS,
      });
    });

    it.each(['draft', 'schedule', 'now'])('%s on an existing PUBLISHED row keeps release ids', async (st) => {
      const { repo, p } = build();
      p.findFirst.mockResolvedValue({ id: 'p1', state: 'PUBLISHED' });
      await run(repo, st, body({ id: 'p1' }));
      const upd = p.upsert.mock.calls[0][0].update;
      expect(upd).not.toHaveProperty('releaseId');
      expect(upd).not.toHaveProperty('releaseURL');
      expect(upd).toMatchObject(NULLS);
    });

    it('update state writes none of those keys', async () => {
      const { repo, p } = build();
      p.findFirst.mockResolvedValue({ id: 'p1', state: 'ERROR' });
      await run(repo, 'update', body({ id: 'p1' }));
      const arg = p.upsert.mock.calls[0][0];
      for (const d of [arg.create, arg.update]) {
        for (const k of ['releaseId', 'releaseURL', 'error', 'errorCategory', 'errorRetryable']) {
          expect(d).not.toHaveProperty(k);
        }
      }
    });
  });
});
