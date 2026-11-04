import { PostsRepository } from './posts.repository';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';
import { PostActor } from '@postsider/nestjs-libraries/actor/post-actor';

const build = () => {
  const post = {
    model: {
      post: {
        update: jest.fn().mockResolvedValue({
          organizationId: 'o',
          integration: { providerIdentifier: 'x' },
          id: 'p1',
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
    },
  };
  const txPost = {
    update: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  };
  const tx = {
    organization: { findUnique: jest.fn(), update: jest.fn() },
    post: txPost,
  };
  const transaction = {
    model: { $transaction: jest.fn((fn: any) => fn(tx)) },
  };
  const tagsPostsMock = {
    model: {
      tagsPosts: { deleteMany: jest.fn().mockResolvedValue(undefined) },
    },
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
    transaction as any
  );
  return { repo, p: post.model.post, tx };
};

const body = (values: any[] = [{}]) =>
  ({
    integration: { id: 'c' },
    settings: { __type: 'x' },
    value: values.map((v) => ({ content: 'hi', image: [], ...v })),
  } as any);

const USER: PostActor = { type: 'USER', userId: 'u1' };
const USER_COLS = { lastModifiedByType: 'USER', lastModifiedByUserId: 'u1' };

describe('PostsRepository actor columns', () => {
  it('createOrUpdatePost records an API key actor, creationMethod is not the actor', async () => {
    const { repo, p } = build();
    await runWithActor({ type: 'API_KEY', apiKeyId: 'k1' }, () =>
      repo.createOrUpdatePost(
        'schedule',
        'org',
        '2030-01-01',
        body(),
        [],
        'CSV' as any
      )
    );
    const arg = p.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({
      createdByType: 'API_KEY',
      createdByApiKeyId: 'k1',
      createdByUserId: null,
      lastModifiedByType: 'API_KEY',
      lastModifiedByApiKeyId: 'k1',
      creationMethod: 'CSV',
    });
    expect(arg.update).toHaveProperty('lastModifiedByType', 'API_KEY');
    expect(arg.update).toHaveProperty('lastModifiedByApiKeyId', 'k1');
    expect(arg.update).toHaveProperty('lastModifiedByUserId', null);
    expect(arg.update).toHaveProperty('lastModifiedByOAuthClientId', null);
    expect(Object.keys(arg.update).some((k) => k.startsWith('createdBy'))).toBe(
      false
    );
  });

  it('createOrUpdatePost records an OAuth client actor with its user', async () => {
    const { repo, p } = build();
    await runWithActor(
      { type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u7' },
      () =>
        repo.createOrUpdatePost(
          'draft',
          'org',
          '2030-01-01',
          body(),
          [],
          'API' as any
        )
    );
    expect(p.upsert.mock.calls[0][0].create).toMatchObject({
      createdByType: 'OAUTH_CLIENT',
      createdByOAuthClientId: 'c1',
      createdByUserId: 'u7',
      lastModifiedByType: 'OAUTH_CLIENT',
      lastModifiedByUserId: 'u7',
    });
  });

  it('createOrUpdatePost without an ambient actor is SYSTEM', async () => {
    const { repo, p } = build();
    await repo.createOrUpdatePost(
      'draft',
      'org',
      '2030-01-01',
      body(),
      [],
      'API' as any
    );
    expect(p.upsert.mock.calls[0][0].create).toMatchObject({
      createdByType: 'SYSTEM',
      createdByUserId: null,
      createdByApiKeyId: null,
      createdByOAuthClientId: null,
      lastModifiedByType: 'SYSTEM',
      lastModifiedByUserId: null,
    });
  });

  it('createOrUpdatePost returns createdIds for rows that did not exist', async () => {
    const { repo, p } = build();
    p.findFirst
      .mockResolvedValueOnce({ id: 'p-old', state: 'QUEUE' })
      .mockResolvedValueOnce(null);
    p.upsert
      .mockResolvedValueOnce({ id: 'p-old' })
      .mockResolvedValueOnce({ id: 'p-new' });
    const res = await repo.createOrUpdatePost(
      'schedule',
      'org',
      '2030-01-01',
      body([{ id: 'p-old' }, {}]),
      [],
      'API' as any
    );
    expect(res.createdIds).toEqual(['p-new']);
  });

  it('createOrUpdatePost spreads provenance into the data', async () => {
    const { repo, p } = build();
    await repo.createOrUpdatePost(
      'draft',
      'org',
      '2030-01-01',
      body(),
      [],
      'API' as any,
      undefined,
      {
        agentName: 'bot',
      }
    );
    expect(p.upsert.mock.calls[0][0].create).toMatchObject({
      agentName: 'bot',
    });
  });

  it('provenance cannot override actor or row fields', async () => {
    const { repo, p } = build();
    await runWithActor({ type: 'API_KEY', apiKeyId: 'k1' }, () =>
      repo.createOrUpdatePost(
        'schedule',
        'org',
        '2030-01-01',
        body(),
        [],
        'API' as any,
        undefined,
        {
          createdByType: 'USER',
          lastModifiedByType: 'USER',
          state: 'PUBLISHED',
          organizationId: 'evil',
          agentName: 'x',
        } as any
      )
    );
    const arg = p.upsert.mock.calls[0][0];
    for (const d of [arg.create, arg.update]) {
      expect(d).toMatchObject({
        agentName: 'x',
        lastModifiedByType: 'API_KEY',
        lastModifiedByApiKeyId: 'k1',
        state: 'QUEUE',
        organization: { connect: { id: 'org' } },
      });
      expect(d.organizationId).toBeUndefined();
    }
    expect(arg.create).toMatchObject({ createdByType: 'API_KEY' });
  });

  it('changeState, changeDate, claimErrorForRetry, updateReleaseId, deletePost stamp lastModifiedBy', async () => {
    const { repo, p } = build();
    await runWithActor(USER, async () => {
      await repo.changeState('p1', 'PUBLISHED');
      await repo.changeDate('org', 'p1', '2030-01-01', false);
      await repo.claimErrorForRetry('org', 'p1');
      await repo.updateReleaseId('p1', 'org', 'rel');
      await repo.deletePost('org', 'g1');
    });
    expect(p.update.mock.calls[0][0].data).toMatchObject(USER_COLS);
    expect(p.update.mock.calls[1][0].data).toMatchObject(USER_COLS);
    expect(p.updateMany.mock.calls[0][0].data).toMatchObject(USER_COLS);
    expect(p.update.mock.calls[2][0].data).toMatchObject(USER_COLS);
    const del = p.updateMany.mock.calls[1][0].data;
    expect(del).toMatchObject(USER_COLS);
    expect(del.deletedAt).toBeInstanceOf(Date);
    expect(del).toHaveProperty('lastModifiedByApiKeyId', null);
    expect(del).toHaveProperty('lastModifiedByOAuthClientId', null);
  });

  it('updatePost (publish success) is always SYSTEM', async () => {
    const { repo, p } = build();
    await runWithActor(USER, () => repo.updatePost('p1', 'rel', 'url', 'org'));
    expect(p.update.mock.calls[0][0].data).toMatchObject({
      lastModifiedByType: 'SYSTEM',
      lastModifiedByUserId: null,
    });
  });

  it('claimPostForPublish HELD flip is SYSTEM', async () => {
    const { repo, tx } = build();
    tx.organization.findUnique.mockResolvedValue({
      publishingState: 'PAUSED',
      publishingPauseReason: 'r',
    });
    tx.post.findFirst.mockResolvedValue({ state: 'QUEUE' });
    const res = await runWithActor(USER, () =>
      repo.claimPostForPublish('org', 'p1')
    );
    expect(res.outcome).toBe('held');
    expect(tx.post.update.mock.calls[0][0].data).toMatchObject({
      state: 'HELD',
      lastModifiedByType: 'SYSTEM',
      lastModifiedByUserId: null,
    });
  });

  it('resumePublishing stamps the ambient actor on each post', async () => {
    const { repo, tx } = build();
    tx.post.findMany.mockResolvedValue([
      {
        id: 'a',
        publishDate: new Date(0),
        integration: { providerIdentifier: 'x' },
      },
      {
        id: 'b',
        publishDate: new Date(Date.now() + 1e9),
        integration: { providerIdentifier: 'x' },
      },
    ]);
    await runWithActor(USER, () => repo.resumePublishing('org', 'to_draft'));
    expect(tx.post.update).toHaveBeenCalledTimes(2);
    for (const c of tx.post.update.mock.calls) {
      expect(c[0].data).toMatchObject({ state: 'DRAFT', ...USER_COLS });
    }
  });
});
