jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (value: string) => value },
}));

import { PostActivity } from './post.activity';
import { SYSTEM_ACTOR } from '@postsider/nestjs-libraries/actor/post-actor';

function create(auditImpl?: () => Promise<void>) {
  const posts = {
    changeState: jest.fn().mockResolvedValue(undefined),
    getPostByForWebhookId: jest
      .fn()
      .mockResolvedValue([{ id: 'p1', releaseURL: 'https://x.test/1', content: 'PRIVATE BODY' }]),
  };
  const audit = { logResourceEvent: jest.fn(auditImpl ?? (() => Promise.resolve())) };
  const activity = new PostActivity(
    posts as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { getWebhooksForDelivery: jest.fn().mockResolvedValue([]) } as any,
    { deliver: jest.fn().mockResolvedValue(undefined) } as any,
    {} as any,
    {} as any,
    {} as any,
    audit as any
  );
  return { activity, audit };
}

describe('PostActivity audit hooks', () => {
  it('sendWebhooks emits post.published with the release url', async () => {
    const { activity, audit } = create();
    await activity.sendWebhooks('p1', 'o1', 'int1');
    expect(audit.logResourceEvent).toHaveBeenCalledTimes(1);
    expect(audit.logResourceEvent).toHaveBeenCalledWith({
      organizationId: 'o1',
      event: 'post.published',
      targetType: 'post',
      targetId: 'p1',
      actor: SYSTEM_ACTOR,
      metadata: { integrationId: 'int1', releaseUrl: 'https://x.test/1' },
    });
  });

  it('markPublishFailed emits post.failed once with status error', async () => {
    const { activity, audit } = create();
    await activity.markPublishFailed('o1', 'p1', {
      category: 'RATE_LIMITED',
      retryable: true,
      autoRetry: 'delay',
      message: 'slow down PRIVATE',
    } as any);
    expect(audit.logResourceEvent).toHaveBeenCalledTimes(1);
    const e = audit.logResourceEvent.mock.calls[0][0];
    expect(e).toMatchObject({
      organizationId: 'o1',
      event: 'post.failed',
      targetId: 'p1',
      status: 'error',
      actor: SYSTEM_ACTOR,
      metadata: { errorCategory: 'RATE_LIMITED', errorRetryable: true },
    });
    expect(JSON.stringify(e)).not.toContain('PRIVATE');
  });

  it('legacy changeState ERROR emits once', async () => {
    const { activity, audit } = create();
    await activity.changeState('p1', 'ERROR' as any, 'boom', undefined, 'o1');
    expect(audit.logResourceEvent).toHaveBeenCalledTimes(1);
    expect(audit.logResourceEvent.mock.calls[0][0].event).toBe('post.failed');
  });

  it('a rejecting audit writer leaves both activities resolving', async () => {
    const { activity } = create(() => Promise.reject(new Error('db')));
    await expect(activity.sendWebhooks('p1', 'o1', 'int1')).resolves.toBeUndefined();
    await expect(
      activity.markPublishFailed('o1', 'p1', {
        category: 'UNKNOWN',
        retryable: false,
        autoRetry: 'none',
        message: 'm',
      } as any)
    ).resolves.toBeUndefined();
  });
});
