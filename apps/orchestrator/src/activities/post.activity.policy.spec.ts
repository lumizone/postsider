jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (value: string) => value },
}));

import { PostActivity } from './post.activity';

function setup(guard?: { checkBeforePublish: jest.Mock }) {
  const posts = {
    changeState: jest.fn().mockResolvedValue(undefined),
    getPostById: jest.fn().mockResolvedValue({ id: 'p1', releaseId: null }),
    updatePost: jest.fn().mockResolvedValue(undefined),
    recordPublishAttempt: jest.fn().mockResolvedValue(undefined),
    getPostByForWebhookId: jest.fn().mockResolvedValue({ id: 'p1', state: 'ERROR' }),
    getPostIdentity: jest.fn().mockRejectedValue(new Error('none')),
  };
  const publicWebhooks = { deliver: jest.fn().mockResolvedValue(undefined) };
  const integrations = { getIntegrationById: jest.fn().mockResolvedValue({ id: 'c1' }) };
  const activity = new PostActivity(
    posts as any,
    {} as any,
    {} as any,
    integrations as any,
    {} as any,
    { getWebhooksForDelivery: jest.fn().mockResolvedValue([]) } as any,
    publicWebhooks as any,
    {} as any,
    {} as any,
    {} as any,
    undefined,
    guard as any
  );
  const postSocial = jest.spyOn(activity, 'postSocial').mockResolvedValue([{ id: 'p1' }] as any);
  return { activity, posts, publicWebhooks, postSocial };
}

const rows = [{ id: 'p1' }] as any;
const blockedFailure = {
  category: 'POLICY_BLOCKED' as const,
  retryable: false,
  autoRetry: 'none' as const,
  message: 'Blocked by policy: No links.',
};
const errorFailure = {
  category: 'UNKNOWN' as const,
  retryable: true,
  autoRetry: 'none' as const,
  message: 'Policy check could not run: db down',
};

describe('PostActivity publish time policy guard', () => {
  it('blocked: returns the failure, no attempt is recorded and the provider is not called', async () => {
    const guard = { checkBeforePublish: jest.fn().mockResolvedValue({ kind: 'blocked', failure: blockedFailure }) };
    const { activity, posts, postSocial } = setup(guard);
    await expect(activity.publishPostById('org', 'c1', rows, false)).resolves.toEqual({
      outcome: 'failed',
      failure: blockedFailure,
    });
    expect(guard.checkBeforePublish).toHaveBeenCalledWith('org', 'p1');
    expect(posts.recordPublishAttempt).not.toHaveBeenCalled();
    expect(postSocial).not.toHaveBeenCalled();
  });

  it('approval_requested: withholds with an empty release id and never calls the provider', async () => {
    const guard = { checkBeforePublish: jest.fn().mockResolvedValue({ kind: 'approval_requested' }) };
    const { activity, posts, postSocial } = setup(guard);
    await expect(activity.publishPostById('org', 'c1', rows, false)).resolves.toEqual({
      outcome: 'already_published',
      releaseId: '',
      withheld: 'policy_approval',
    });
    expect(posts.recordPublishAttempt).not.toHaveBeenCalled();
    expect(posts.updatePost).not.toHaveBeenCalled();
    expect(postSocial).not.toHaveBeenCalled();
  });

  it('error: returns the failure as a value, no provider call', async () => {
    const guard = { checkBeforePublish: jest.fn().mockResolvedValue({ kind: 'error', failure: errorFailure }) };
    const { activity, posts, postSocial } = setup(guard);
    await expect(activity.publishPostById('org', 'c1', rows, false)).resolves.toEqual({
      outcome: 'failed',
      failure: errorFailure,
    });
    expect(posts.recordPublishAttempt).not.toHaveBeenCalled();
    expect(postSocial).not.toHaveBeenCalled();
  });

  it('a guard that throws still fails closed as a value', async () => {
    const guard = { checkBeforePublish: jest.fn().mockRejectedValue(new Error('boom')) };
    const { activity, postSocial } = setup(guard);
    const res: any = await activity.publishPostById('org', 'c1', rows, false);
    expect(res.outcome).toBe('failed');
    expect(res.failure.category).toBe('UNKNOWN');
    expect(postSocial).not.toHaveBeenCalled();
  });

  it('allow: publishes as before and the guard runs before recordPublishAttempt', async () => {
    const guard = { checkBeforePublish: jest.fn().mockResolvedValue({ kind: 'allow' }) };
    const { activity, posts, postSocial } = setup(guard);
    const res = await activity.publishPostById('org', 'c1', rows, false);
    expect(res).toEqual({ outcome: 'published', results: [{ id: 'p1' }] });
    expect(guard.checkBeforePublish.mock.invocationCallOrder[0]).toBeLessThan(
      posts.recordPublishAttempt.mock.invocationCallOrder[0]
    );
    expect(postSocial).toHaveBeenCalledTimes(1);
  });

  it('without a guard injected publishing is unchanged', async () => {
    const { activity, postSocial } = setup(undefined);
    const res = await activity.publishPostById('org', 'c1', rows, false);
    expect(res.outcome).toBe('published');
    expect(postSocial).toHaveBeenCalledTimes(1);
  });

  it('runs after the already-published short circuit: a row with a release id never evaluates policies', async () => {
    const guard = { checkBeforePublish: jest.fn() };
    const { activity, posts } = setup(guard);
    posts.getPostById.mockResolvedValue({ id: 'p1', releaseId: 'rel-1', releaseURL: 'u', state: 'PUBLISHED' });
    await expect(activity.publishPostById('org', 'c1', rows, false)).resolves.toEqual({
      outcome: 'already_published',
      releaseId: 'rel-1',
    });
    expect(guard.checkBeforePublish).not.toHaveBeenCalled();
  });

  it('markPublishFailed with a POLICY_BLOCKED failure sets ERROR, not retryable, and the webhook carries the category', async () => {
    const { activity, posts, publicWebhooks } = setup(undefined);
    await activity.markPublishFailed('org', 'p1', blockedFailure);
    expect(posts.changeState).toHaveBeenCalledWith(
      'p1',
      'ERROR',
      'Blocked by policy: No links.',
      undefined,
      'org',
      { category: 'POLICY_BLOCKED', retryable: false }
    );
    expect(publicWebhooks.deliver).toHaveBeenCalledTimes(1);
    expect(publicWebhooks.deliver).toHaveBeenCalledWith(
      'org',
      'post.failed',
      expect.objectContaining({
        postId: 'p1',
        error: 'Blocked by policy: No links.',
        errorCategory: 'POLICY_BLOCKED',
        errorRetryable: false,
      })
    );
  });
});
