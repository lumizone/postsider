import { PostsRepository } from './posts.repository';

const build = () => {
  const post = {
    model: {
      post: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'p1' }),
      },
    },
  };
  const tagsPostsMock = {
    model: { tagsPosts: { deleteMany: jest.fn().mockResolvedValue(undefined) } },
  };
  const repo = new PostsRepository(
    post as any,
    {} as any,
    {} as any,
    {} as any,
    tagsPostsMock as any,
    {} as any,
    {} as any
  );
  return { repo, p: post.model.post };
};

const body = () =>
  ({
    integration: { id: 'c' },
    settings: { __type: 'x' },
    value: [{ content: 'hi', image: [] }],
  } as any);

const FIVE = ['agentName', 'workflowId', 'runId', 'externalRef', 'source'];
const run = (repo: PostsRepository, prov?: any) =>
  repo.createOrUpdatePost(
    'schedule',
    'org',
    '2030-01-01',
    body(),
    [],
    'API' as any,
    undefined,
    prov
  );

describe('PostsRepository provenance', () => {
  it('writes the given keys on create and update', async () => {
    const { repo, p } = build();
    await run(repo, { agentName: 'a', runId: 'r' });
    const arg = p.upsert.mock.calls[0][0];
    expect(arg.create).toMatchObject({ agentName: 'a', runId: 'r' });
    expect(arg.update).toMatchObject({ agentName: 'a', runId: 'r' });
    expect(arg.create).not.toHaveProperty('workflowId');
  });

  it('writes only the defined keys on update', async () => {
    const { repo, p } = build();
    await run(repo, { source: 'n8n', externalRef: undefined });
    const arg = p.upsert.mock.calls[0][0];
    expect(arg.update).toHaveProperty('source', 'n8n');
    expect(arg.update).not.toHaveProperty('externalRef');
    expect(arg.update).not.toHaveProperty('agentName');
  });

  it('writes none of the five keys for undefined or {}', async () => {
    for (const prov of [undefined, {}]) {
      const { repo, p } = build();
      await run(repo, prov);
      const arg = p.upsert.mock.calls[0][0];
      for (const k of FIVE) {
        expect(arg.update).not.toHaveProperty(k);
        expect(arg.create).not.toHaveProperty(k);
      }
    }
  });

  it('never writes a key outside the five names', async () => {
    const { repo, p } = build();
    const base = build();
    await run(base.repo, undefined);
    const baseKeys = Object.keys(base.p.upsert.mock.calls[0][0].create);
    await run(repo, { agentName: 'a', createdByType: 'USER', state: 'X', organizationId: 'evil' });
    const keys = Object.keys(p.upsert.mock.calls[0][0].create);
    expect(keys.filter((k) => !baseKeys.includes(k))).toEqual(['agentName']);
    expect(p.upsert.mock.calls[0][0].create.organization).toEqual({ connect: { id: 'org' } });
  });
});
