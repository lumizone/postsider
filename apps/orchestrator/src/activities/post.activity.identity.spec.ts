jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (value: string) => value },
}));

import { PostActivity } from './post.activity';

const IDENT = {
  actor: { createdBy: { type: 'API_KEY', apiKeyId: 'k1' }, lastModifiedBy: { type: 'SYSTEM' } },
  provenance: { agentName: 'bot', workflowId: null, runId: null, externalRef: null, source: 'mcp' },
};
const NULLS = {
  actor: { createdBy: null, lastModifiedBy: null },
  provenance: { agentName: null, workflowId: null, runId: null, externalRef: null, source: null },
};

function create(identity: () => Promise<any>, legacy: any[] = []) {
  const post = [{ id: 'p1', releaseURL: 'https://x.test/1' }];
  const posts = {
    changeState: jest.fn().mockResolvedValue(undefined),
    getPostByForWebhookId: jest.fn().mockResolvedValue(post),
    getPostIdentity: jest.fn(identity),
  };
  const deliver = jest.fn().mockResolvedValue(undefined);
  const activity = new PostActivity(
    posts as any, {} as any, {} as any, {} as any, {} as any,
    { getWebhooksForDelivery: jest.fn().mockResolvedValue(legacy) } as any,
    { deliver } as any,
    {} as any, {} as any, {} as any,
    { logResourceEvent: jest.fn().mockResolvedValue(undefined) } as any
  );
  return { activity, deliver, post };
}

describe('PostActivity webhook identity', () => {
  it('post.published carries actor and provenance', async () => {
    const { activity, deliver } = create(async () => IDENT);
    await activity.sendWebhooks('p1', 'o1', 'int1');
    expect(deliver).toHaveBeenCalledWith('o1', 'post.published', expect.objectContaining({
      post: expect.anything(), actor: IDENT.actor, provenance: IDENT.provenance,
    }));
  });

  it('post.published still delivers when identity lookup rejects', async () => {
    const { activity, deliver } = create(async () => { throw new Error('boom'); });
    await activity.sendWebhooks('p1', 'o1', 'int1');
    expect(deliver.mock.calls[0][2]).toMatchObject(NULLS);
  });

  it('post.failed keeps its keys and adds identity', async () => {
    const { activity, deliver } = create(async () => IDENT);
    await activity.markPublishFailed('o1', 'p1', { message: 'bad', category: 'RATE_LIMITED', retryable: true } as any);
    expect(deliver).toHaveBeenCalledWith('o1', 'post.failed', expect.objectContaining({
      postId: 'p1', error: 'bad', errorCategory: 'RATE_LIMITED', errorRetryable: true,
      post: expect.anything(), actor: IDENT.actor, provenance: IDENT.provenance,
    }));
  });

  it('post.failed still delivers when identity rejects', async () => {
    const { activity, deliver } = create(async () => { throw new Error('boom'); });
    await activity.markPublishFailed('o1', 'p1', { message: 'bad', category: 'UNKNOWN', retryable: false } as any);
    expect(deliver.mock.calls[0][2]).toMatchObject(NULLS);
  });
});
