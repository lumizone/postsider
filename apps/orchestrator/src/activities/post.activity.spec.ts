jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (value: string) => value },
}));

import { PostActivity } from './post.activity';
import {
  BadBody,
  RefreshToken,
} from '@postsider/nestjs-libraries/integrations/social.abstract';
import { markPublishSideEffect } from '@postsider/nestjs-libraries/integrations/publish-side-effect.context';

function createActivity() {
  const posts = {
    changeState: jest.fn().mockResolvedValue(undefined),
    getPostById: jest.fn().mockResolvedValue({ id: 'p1', releaseId: null }),
    updatePost: jest.fn().mockResolvedValue(undefined),
    recordPublishAttempt: jest.fn().mockResolvedValue(undefined),
    getPostByForWebhookId: jest.fn().mockResolvedValue({
      id: 'post-1',
      state: 'PUBLISHED',
    }),
  };
  const legacyWebhooks = {
    getWebhooksForDelivery: jest.fn().mockResolvedValue([]),
  };
  const publicWebhooks = { deliver: jest.fn().mockResolvedValue(undefined) };
  const integrations = {
    getIntegrationById: jest.fn().mockResolvedValue({ id: 'c1' }),
  };
  const signalWithStart = jest.fn().mockResolvedValue(undefined);
  const temporal = {
    client: { getRawClient: () => ({ workflow: { signalWithStart } }) },
  };
  const activity = new PostActivity(
    posts as any,
    {} as any,
    {} as any,
    integrations as any,
    {} as any,
    legacyWebhooks as any,
    publicWebhooks as any,
    temporal as any,
    {} as any,
    {} as any
  );
  return { activity, posts, legacyWebhooks, publicWebhooks, signalWithStart };
}

describe('PostActivity public webhook events', () => {
  it('delivers post.published even when no legacy webhook exists', async () => {
    const { activity, publicWebhooks } = createActivity();

    await activity.sendWebhooks('post-1', 'org-1', 'channel-1');

    expect(publicWebhooks.deliver).toHaveBeenCalledWith(
      'org-1',
      'post.published',
      expect.objectContaining({ post: { id: 'post-1', state: 'PUBLISHED' } })
    );
  });

  it('delivers post.failed after committing the ERROR state', async () => {
    const { activity, posts, publicWebhooks } = createActivity();

    await activity.changeState('post-1', 'ERROR' as any, 'provider failure', [
      { integration: { organizationId: 'org-1' } },
    ]);

    expect(posts.changeState).toHaveBeenCalledWith(
      'post-1',
      'ERROR',
      'provider failure',
      [{ integration: { organizationId: 'org-1' } }],
      undefined,
      { category: 'UNKNOWN', retryable: false }
    );
    expect(publicWebhooks.deliver).toHaveBeenCalledWith(
      'org-1',
      'post.failed',
      expect.objectContaining({
        postId: 'post-1',
        error: 'provider failure',
        errorCategory: 'UNKNOWN',
        errorRetryable: false,
        post: { id: 'post-1', state: 'PUBLISHED' },
      })
    );
    expect(posts.changeState.mock.invocationCallOrder[0]).toBeLessThan(
      publicWebhooks.deliver.mock.invocationCallOrder[0]
    );
  });
});

describe('PostActivity classified publishing', () => {
  const net = (code: string) => Object.assign(new Error(code), { code });
  const publishedRow = (state: string) => ({
    id: 'p1',
    releaseId: 'rel-1',
    releaseURL: 'https://x',
    state,
  });
  const setup = () => {
    const ctx = createActivity();
    const postSocial = jest
      .spyOn(ctx.activity, 'postSocial')
      .mockResolvedValue([{ id: 'p1' }] as any);
    const postComment = jest
      .spyOn(ctx.activity, 'postComment')
      .mockResolvedValue([{ id: 'c' }] as any);
    return { ...ctx, postSocial, postComment };
  };
  const posts = [{ id: 'p1' }] as any;

  it('returns already_published without touching the provider', async () => {
    const { activity, posts: repo, postSocial } = setup();
    repo.getPostById.mockResolvedValue(publishedRow('PUBLISHED'));
    await expect(
      activity.publishPostById('org-1', 'c1', posts, false)
    ).resolves.toEqual({ outcome: 'already_published', releaseId: 'rel-1' });
    expect(postSocial).not.toHaveBeenCalled();
    expect(repo.recordPublishAttempt).not.toHaveBeenCalled();
    expect(repo.updatePost).not.toHaveBeenCalled();
  });

  it('repairs a QUEUE row that already has a releaseId', async () => {
    const { activity, posts: repo, postSocial } = setup();
    repo.getPostById.mockResolvedValue(publishedRow('QUEUE'));
    await activity.publishPostById('org-1', 'c1', posts, false);
    expect(repo.updatePost).toHaveBeenCalledTimes(1);
    expect(repo.updatePost).toHaveBeenCalledWith(
      'p1',
      'rel-1',
      'https://x',
      'org-1'
    );
    expect(postSocial).not.toHaveBeenCalled();
  });

  it('publishes when releaseId is missing or republish is allowed', async () => {
    const { activity, posts: repo, postSocial } = setup();
    repo.getPostById.mockResolvedValue({
      ...publishedRow('QUEUE'),
      releaseId: 'missing',
    });
    expect(
      (await activity.publishPostById('org-1', 'c1', posts, false)).outcome
    ).toBe('published');
    repo.getPostById.mockResolvedValue(publishedRow('PUBLISHED'));
    expect(
      (await activity.publishPostById('org-1', 'c1', posts, true)).outcome
    ).toBe('published');
    expect(postSocial).toHaveBeenCalledTimes(2);
  });

  it('records the attempt before calling the provider', async () => {
    const { activity, posts: repo, postSocial } = setup();
    const res = await activity.publishPostById('org-1', 'c1', posts, false);
    expect(res).toEqual({ outcome: 'published', results: [{ id: 'p1' }] });
    expect(repo.recordPublishAttempt).toHaveBeenCalledWith('org-1', 'p1');
    expect(repo.recordPublishAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      postSocial.mock.invocationCallOrder[0]
    );
  });

  it('classifies provider errors as values and never rejects', async () => {
    const { activity, postSocial } = setup();
    postSocial.mockRejectedValueOnce(new RefreshToken('x', '{}', '', 'exp'));
    const auth: any = await activity.publishPostById(
      'org-1',
      'c1',
      posts,
      false
    );
    expect(auth.outcome).toBe('failed');
    expect(auth.failure).toEqual(
      expect.objectContaining({
        category: 'AUTH_EXPIRED',
        autoRetry: 'refresh',
      })
    );
    postSocial.mockRejectedValueOnce(net('ECONNRESET'));
    const unknown: any = await activity.publishPostById(
      'org-1',
      'c1',
      posts,
      false
    );
    expect(unknown.failure.category).toBe('UNKNOWN_OUTCOME');
  });

  describe('write already accepted by the provider in the same call', () => {
    const rateLimited = () =>
      new BadBody('x', '{}', '', 'Rate limit', 'rate_limited');

    it('a 2xx write then a rate-limited failure is UNKNOWN_OUTCOME, no auto retry', async () => {
      const { activity, postSocial } = setup();
      postSocial.mockImplementationOnce(async () => {
        markPublishSideEffect('POST');
        throw rateLimited();
      });
      const res: any = await activity.publishPostById('org-1', 'c1', posts, false);
      expect(res.failure).toEqual(
        expect.objectContaining({
          category: 'UNKNOWN_OUTCOME',
          retryable: false,
          autoRetry: 'none',
        })
      );
      expect(res.failure.message).toContain('Rate limit');
    });

    it('the same failure without a prior write stays RATE_LIMITED', async () => {
      const { activity, postSocial } = setup();
      postSocial.mockImplementationOnce(async () => {
        markPublishSideEffect('GET');
        throw rateLimited();
      });
      const res: any = await activity.publishPostById('org-1', 'c1', posts, false);
      expect(res.failure.category).toBe('RATE_LIMITED');
      expect(res.failure.autoRetry).toBe('delay');
    });

    it('a RefreshToken after a 2xx write is UNKNOWN_OUTCOME', async () => {
      const { activity, postSocial } = setup();
      postSocial.mockImplementationOnce(async () => {
        markPublishSideEffect('POST');
        throw new RefreshToken('x', '{}', '', 'exp');
      });
      const res: any = await activity.publishPostById('org-1', 'c1', posts, false);
      expect(res.failure).toEqual(
        expect.objectContaining({
          category: 'UNKNOWN_OUTCOME',
          retryable: false,
          autoRetry: 'none',
        })
      );
    });

    it('publishCommentById applies the same rule', async () => {
      const { activity, postComment } = setup();
      postComment.mockImplementationOnce(async () => {
        markPublishSideEffect('POST');
        throw rateLimited();
      });
      const res: any = await activity.publishCommentById(
        'org-1',
        'c1',
        'id',
        undefined,
        posts
      );
      expect(res.failure.category).toBe('UNKNOWN_OUTCOME');
      expect(res.failure.autoRetry).toBe('none');
    });
  });

  it('turns a pre-call failure into UNKNOWN without calling the provider', async () => {
    const { activity, posts: repo, postSocial } = setup();
    repo.getPostById.mockRejectedValue(new Error('db down'));
    const res: any = await activity.publishPostById(
      'org-1',
      'c1',
      posts,
      false
    );
    expect(res.failure).toEqual(
      expect.objectContaining({ category: 'UNKNOWN', retryable: true })
    );
    expect(res.failure.message).toMatch(/^Publishing could not start:/);
    expect(postSocial).not.toHaveBeenCalled();
  });

  it('publishCommentById records the attempt and classifies errors', async () => {
    const { activity, posts: repo, postComment } = setup();
    const ok = await activity.publishCommentById(
      'org-1',
      'c1',
      'id',
      undefined,
      posts
    );
    expect(ok.outcome).toBe('published');
    expect(repo.recordPublishAttempt).toHaveBeenCalledWith('org-1', 'p1');
    postComment.mockRejectedValueOnce(net('ECONNRESET'));
    const bad: any = await activity.publishCommentById(
      'org-1',
      'c1',
      'id',
      undefined,
      posts
    );
    expect(bad.failure.category).toBe('UNKNOWN_OUTCOME');
  });

  it('publishCommentById still publishes when recording the attempt fails', async () => {
    const { activity, posts: repo, postComment } = setup();
    repo.recordPublishAttempt.mockRejectedValueOnce(new Error('no row'));
    const res = await activity.publishCommentById(
      'org-1',
      'c1',
      'id',
      undefined,
      [{ id: 'p1_first_comment' }] as any
    );
    expect(res.outcome).toBe('published');
    expect(postComment).toHaveBeenCalledTimes(1);
  });

  it('markPublishFailed persists the failure and emits post.failed', async () => {
    const { activity, posts: repo, publicWebhooks } = setup();
    await activity.markPublishFailed('org-1', 'p1', {
      category: 'RATE_LIMITED',
      retryable: true,
      autoRetry: 'delay',
      message: 'slow down',
    });
    expect(repo.changeState).toHaveBeenCalledWith(
      'p1',
      'ERROR',
      'slow down',
      undefined,
      'org-1',
      { category: 'RATE_LIMITED', retryable: true }
    );
    expect(publicWebhooks.deliver).toHaveBeenCalledWith(
      'org-1',
      'post.failed',
      expect.objectContaining({
        postId: 'p1',
        error: 'slow down',
        errorCategory: 'RATE_LIMITED',
        errorRetryable: true,
      })
    );
  });

  it('legacy changeState classifies object errors', async () => {
    const { activity, posts: repo } = setup();
    await activity.changeState(
      'p1',
      'ERROR' as any,
      new BadBody('x', '{}', '', 'm', 'rate_limited'),
      undefined,
      'org-1'
    );
    expect(repo.changeState).toHaveBeenCalledWith(
      'p1',
      'ERROR',
      expect.anything(),
      undefined,
      'org-1',
      { category: 'RATE_LIMITED', retryable: true }
    );
  });

  it('searchForMissingThreeHoursPosts signals postWorkflowV109', async () => {
    const { activity, posts: repo, signalWithStart } = setup();
    (repo as any).searchForMissingThreeHoursPosts = jest
      .fn()
      .mockResolvedValue([
        {
          id: 'p1',
          organizationId: 'org-1',
          integration: { providerIdentifier: 'x-twitter' },
        },
      ]);
    await activity.searchForMissingThreeHoursPosts();
    expect(signalWithStart).toHaveBeenCalledWith(
      'postWorkflowV109',
      expect.objectContaining({ workflowId: 'post_p1' })
    );
  });
});
