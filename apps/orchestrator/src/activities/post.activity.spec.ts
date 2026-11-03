jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (value: string) => value },
}));

import { PostActivity } from './post.activity';

function createActivity() {
  const posts = {
    changeState: jest.fn().mockResolvedValue(undefined),
    getPostByForWebhookId: jest.fn().mockResolvedValue({
      id: 'post-1',
      state: 'PUBLISHED',
    }),
  };
  const legacyWebhooks = {
    getWebhooksForDelivery: jest.fn().mockResolvedValue([]),
  };
  const publicWebhooks = { deliver: jest.fn().mockResolvedValue(undefined) };
  const activity = new PostActivity(
    posts as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    legacyWebhooks as any,
    publicWebhooks as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { activity, posts, legacyWebhooks, publicWebhooks };
}

describe('PostActivity public webhook events', () => {
  it('delivers post.published even when no legacy webhook exists', async () => {
    const { activity, publicWebhooks } = createActivity();

    await activity.sendWebhooks('post-1', 'org-1', 'channel-1');

    expect(publicWebhooks.deliver).toHaveBeenCalledWith(
      'org-1',
      'post.published',
      { post: { id: 'post-1', state: 'PUBLISHED' } }
    );
  });

  it('delivers post.failed after committing the ERROR state', async () => {
    const { activity, posts, publicWebhooks } = createActivity();

    await activity.changeState('post-1', 'ERROR' as any, 'provider failure', [
      { integration: { organizationId: 'org-1' } },
    ]);

    expect(posts.changeState).toHaveBeenCalled();
    expect(publicWebhooks.deliver).toHaveBeenCalledWith(
      'org-1',
      'post.failed',
      {
        postId: 'post-1',
        error: 'provider failure',
        post: { id: 'post-1', state: 'PUBLISHED' },
      }
    );
    expect(posts.changeState.mock.invocationCallOrder[0]).toBeLessThan(
      publicWebhooks.deliver.mock.invocationCallOrder[0]
    );
  });
});
