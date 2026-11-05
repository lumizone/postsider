const mockActivities: Record<string, jest.Mock> = {
  getPostsListForPublish: jest.fn(),
  getPostForPublish: jest.fn(),
  claimPostForPublish: jest.fn(),
  inAppNotification: jest.fn(),
  changeState: jest.fn(),
  updatePost: jest.fn(),
  sendWebhooks: jest.fn(),
  isCommentableById: jest.fn(),
  publishPostById: jest.fn(),
  publishCommentById: jest.fn(),
  markPublishFailed: jest.fn(),
  refreshTokenWithCauseById: jest.fn(),
  internalPlugsById: jest.fn(),
  globalPlugsById: jest.fn(),
  processInternalPlug: jest.fn(),
  processPlug: jest.fn(),
};
const mockSleep = jest.fn();
const mockProxyOptions: any[] = [];

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn((opts: any) => {
    mockProxyOptions.push(opts);
    return mockActivities;
  }),
  sleep: (...args: any[]) => mockSleep(...args),
  defineSignal: jest.fn(() => 'poke'),
  setHandler: jest.fn(),
  startChild: jest.fn(),
  ActivityFailure: class {},
  ApplicationFailure: class {},
}));

import { postWorkflowV109 } from './post.workflow.v1.0.9';

describe('v1.0.9 activity proxies', () => {
  it('has a dedicated unlimited-retry proxy for post-call writes', () => {
    const writes = mockProxyOptions.find(
      (o) => o?.retry?.maximumAttempts === 0
    );
    expect(writes).toEqual(
      expect.objectContaining({
        retry: {
          maximumAttempts: 0,
          initialInterval: '30 seconds',
          backoffCoefficient: 2,
          maximumInterval: '10 minutes',
        },
      })
    );
    expect(writes.startToCloseTimeout).toBeDefined();
  });
});

const integration = (over: any = {}) => ({
  id: 'int1',
  organizationId: 'org',
  providerIdentifier: 'x',
  name: 'N',
  refreshNeeded: false,
  disabled: false,
  deletedAt: null,
  ...over,
});
const row = (id: string, over: any = {}) => ({
  id,
  organizationId: 'org',
  settings: '{}',
  intervalInDays: null,
  firstComment: null,
  integration: integration(),
  ...over,
});
const published = {
  outcome: 'published',
  results: [{ postId: 'rel1', releaseURL: 'https://x/1', status: 'completed' }],
};
const rateLimited = {
  outcome: 'failed',
  failure: {
    category: 'RATE_LIMITED',
    retryable: true,
    autoRetry: 'delay',
    message: 'slow',
  },
};
const authExpired = {
  outcome: 'failed',
  failure: {
    category: 'AUTH_EXPIRED',
    retryable: false,
    autoRetry: 'refresh',
    message: 'msg',
  },
};
// The pre-flight wait sleeps 0 ms for an overdue post; only retry delays are strings.
const retrySleeps = () =>
  mockSleep.mock.calls.map((c) => c[0]).filter((v) => typeof v === 'string');
const run = (extra: any = {}) =>
  postWorkflowV109({
    taskQueue: 'x',
    postId: 'p1',
    organizationId: 'org',
    ...extra,
  });

describe('postWorkflowV109', () => {
  beforeEach(() => {
    Object.values(mockActivities).forEach((m) => m.mockReset());
    mockSleep.mockReset();
    mockActivities.getPostForPublish.mockResolvedValue({
      publishDate: new Date(0),
      state: 'QUEUE',
    });
    mockActivities.claimPostForPublish.mockResolvedValue({ outcome: 'publish' });
    mockActivities.getPostsListForPublish.mockResolvedValue([row('p1')]);
    mockActivities.internalPlugsById.mockResolvedValue([]);
    mockActivities.globalPlugsById.mockResolvedValue([]);
    mockActivities.publishPostById.mockResolvedValue(published);
  });

  it('1. publishes once, saves result, sends webhooks', async () => {
    await run();
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(1);
    expect(mockActivities.publishPostById).toHaveBeenCalledWith(
      'org',
      'int1',
      [expect.objectContaining({ id: 'p1' })],
      false
    );
    expect(mockActivities.updatePost).toHaveBeenCalledWith(
      'p1',
      'rel1',
      'https://x/1'
    );
    expect(mockActivities.sendWebhooks).toHaveBeenCalledWith(
      'rel1',
      'org',
      'int1'
    );
    expect(mockActivities.markPublishFailed).not.toHaveBeenCalled();
  });

  it('2. postNow passes allowRepublish true', async () => {
    await run({ postNow: true });
    expect(mockActivities.publishPostById.mock.calls[0][3]).toBe(true);
  });

  it('3. already_published does nothing else', async () => {
    mockActivities.publishPostById.mockResolvedValue({
      outcome: 'already_published',
      releaseId: 'r',
    });
    await run();
    expect(mockActivities.updatePost).not.toHaveBeenCalled();
    expect(mockActivities.sendWebhooks).not.toHaveBeenCalled();
    expect(mockActivities.markPublishFailed).not.toHaveBeenCalled();
  });

  it('3b. withheld for policy approval returns without touching state, webhooks, plugs or repeat', async () => {
    // A REQUIRE_APPROVAL rule matched at publish time: the activity parks the post
    // in the approval queue and reports it through the frozen already_published outcome.
    mockActivities.getPostsListForPublish.mockResolvedValue([
      row('p1', { intervalInDays: 2 }),
    ]);
    mockActivities.internalPlugsById.mockResolvedValue([
      { type: 'internal-plug', delay: 0 },
    ]);
    mockActivities.publishPostById.mockResolvedValue({
      outcome: 'already_published',
      releaseId: '',
      withheld: 'policy_approval',
    });
    await expect(run()).resolves.toBeUndefined();
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(1);
    expect(mockActivities.markPublishFailed).not.toHaveBeenCalled();
    expect(mockActivities.updatePost).not.toHaveBeenCalled();
    expect(mockActivities.sendWebhooks).not.toHaveBeenCalled();
    expect(mockActivities.internalPlugsById).not.toHaveBeenCalled();
    expect(mockActivities.globalPlugsById).not.toHaveBeenCalled();
    expect(mockActivities.processInternalPlug).not.toHaveBeenCalled();
    expect(mockActivities.changeState).not.toHaveBeenCalled();
    expect(mockActivities.inAppNotification).not.toHaveBeenCalled();
    expect(require('@temporalio/workflow').startChild).not.toHaveBeenCalled();
    expect(retrySleeps()).toEqual([]);
  });

  it('3c. a POLICY_BLOCKED failure is recorded once, notified once and never retried', async () => {
    mockActivities.publishPostById.mockResolvedValue({
      outcome: 'failed',
      failure: {
        category: 'POLICY_BLOCKED',
        retryable: false,
        autoRetry: 'none',
        message: 'Blocked by policy: No links.',
      },
    });
    await expect(run()).resolves.toBe(false);
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(1);
    expect(mockActivities.refreshTokenWithCauseById).not.toHaveBeenCalled();
    expect(retrySleeps()).toEqual([]);
    expect(mockActivities.markPublishFailed).toHaveBeenCalledTimes(1);
    expect(mockActivities.markPublishFailed).toHaveBeenCalledWith(
      'org',
      'p1',
      expect.objectContaining({ category: 'POLICY_BLOCKED', retryable: false }),
      expect.any(Array)
    );
    expect(mockActivities.inAppNotification).toHaveBeenCalledTimes(1);
    expect(mockActivities.updatePost).not.toHaveBeenCalled();
    expect(mockActivities.sendWebhooks).not.toHaveBeenCalled();
  });

  it('4. rate limited once then success', async () => {
    mockActivities.publishPostById
      .mockResolvedValueOnce(rateLimited)
      .mockResolvedValueOnce(published);
    await run();
    expect(retrySleeps()).toEqual(['2 minutes']);
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(2);
    expect(mockActivities.markPublishFailed).not.toHaveBeenCalled();
  });

  it('5. always rate limited stops after 3 calls', async () => {
    mockActivities.publishPostById.mockResolvedValue(rateLimited);
    const res = await run();
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(3);
    expect(retrySleeps()).toEqual(['2 minutes', '10 minutes']);
    expect(mockActivities.markPublishFailed).toHaveBeenCalledWith(
      'org',
      'p1',
      expect.objectContaining({ category: 'RATE_LIMITED' }),
      expect.anything()
    );
    expect(res).toBe(false);
  });

  it('6. activity timeout is never retried', async () => {
    mockActivities.publishPostById.mockRejectedValue({
      name: 'ActivityFailure',
      cause: { name: 'TimeoutFailure', timeoutType: 'START_TO_CLOSE' },
    });
    await run();
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(1);
    expect(retrySleeps()).toEqual([]);
    expect(mockActivities.markPublishFailed).toHaveBeenCalledWith(
      'org',
      'p1',
      expect.objectContaining({
        category: 'UNKNOWN_OUTCOME',
        retryable: false,
      }),
      expect.anything()
    );
  });

  it('7. auth expired refreshes then succeeds', async () => {
    mockActivities.publishPostById
      .mockResolvedValueOnce(authExpired)
      .mockResolvedValueOnce(published);
    mockActivities.refreshTokenWithCauseById.mockResolvedValue(true);
    await run();
    expect(mockActivities.refreshTokenWithCauseById).toHaveBeenCalledTimes(1);
    expect(mockActivities.refreshTokenWithCauseById).toHaveBeenCalledWith(
      'org',
      'int1',
      'msg'
    );
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(2);
  });

  it('8. auth expired, refresh fails', async () => {
    mockActivities.publishPostById.mockResolvedValue(authExpired);
    mockActivities.refreshTokenWithCauseById.mockResolvedValue(false);
    await run();
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(1);
    expect(mockActivities.markPublishFailed).toHaveBeenCalledWith(
      'org',
      'p1',
      expect.objectContaining({ category: 'AUTH_EXPIRED', retryable: false }),
      expect.anything()
    );
  });

  it('9. auth expired forever is bounded', async () => {
    mockActivities.publishPostById.mockResolvedValue(authExpired);
    mockActivities.refreshTokenWithCauseById.mockResolvedValue(true);
    await run();
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(3);
    expect(mockActivities.markPublishFailed).toHaveBeenCalledTimes(1);
  });

  it('10. non-retryable failure', async () => {
    mockActivities.publishPostById.mockResolvedValue({
      outcome: 'failed',
      failure: {
        category: 'INVALID_CONTENT',
        retryable: false,
        autoRetry: 'none',
        message: 'bad',
      },
    });
    await run();
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(1);
    expect(mockActivities.markPublishFailed).toHaveBeenCalledTimes(1);
    expect(mockActivities.inAppNotification).toHaveBeenCalledTimes(1);
  });

  it('11. updatePost failure after publish is UNKNOWN_OUTCOME, no re-publish', async () => {
    mockActivities.updatePost.mockRejectedValue(new Error('db down'));
    await run();
    expect(mockActivities.publishPostById).toHaveBeenCalledTimes(1);
    expect(mockActivities.markPublishFailed).toHaveBeenCalledWith(
      'org',
      'p1',
      expect.objectContaining({
        category: 'UNKNOWN_OUTCOME',
        retryable: false,
        message: expect.stringContaining('https://x/1'),
      }),
      expect.anything()
    );
  });

  it('12. channel guards', async () => {
    mockActivities.getPostsListForPublish.mockResolvedValue([
      row('p1', { integration: integration({ refreshNeeded: true }) }),
    ]);
    await run();
    expect(mockActivities.publishPostById).not.toHaveBeenCalled();
    expect(mockActivities.markPublishFailed).toHaveBeenCalledWith(
      'org',
      'p1',
      expect.objectContaining({
        category: 'AUTH_EXPIRED',
        retryable: false,
        message: 'Refresh channel needed',
      }),
      expect.anything()
    );

    mockActivities.markPublishFailed.mockClear();
    mockActivities.getPostsListForPublish.mockResolvedValue([
      row('p1', { integration: integration({ disabled: true }) }),
    ]);
    await run();
    expect(mockActivities.markPublishFailed).toHaveBeenCalledWith(
      'org',
      'p1',
      expect.objectContaining({ category: 'UNKNOWN', message: 'Channel disabled' }),
      expect.anything()
    );

    mockActivities.markPublishFailed.mockClear();
    mockActivities.getPostsListForPublish.mockResolvedValue([
      row('p1', { integration: integration({ deletedAt: new Date() }) }),
    ]);
    await run();
    expect(mockActivities.markPublishFailed).toHaveBeenCalledWith(
      'org',
      'p1',
      expect.objectContaining({ category: 'UNKNOWN', message: 'Channel deleted' }),
      expect.anything()
    );

    mockActivities.markPublishFailed.mockClear();
    mockActivities.getPostForPublish.mockResolvedValue(false);
    await run();
    expect(mockActivities.changeState).toHaveBeenCalledWith(
      'p1',
      'ERROR',
      'No Post'
    );
    expect(mockActivities.markPublishFailed).not.toHaveBeenCalled();
  });

  it('13. thread comment failure does not mark row 1', async () => {
    const rows = [row('p1'), row('p2')];
    mockActivities.getPostsListForPublish.mockResolvedValue(rows);
    mockActivities.isCommentableById.mockResolvedValue(true);
    mockActivities.publishCommentById.mockResolvedValue({
      outcome: 'failed',
      failure: {
        category: 'INVALID_CONTENT',
        retryable: false,
        autoRetry: 'none',
        message: 'bad',
      },
    });
    await run();
    expect(mockActivities.publishCommentById).toHaveBeenCalledWith(
      'org',
      'int1',
      'rel1',
      undefined,
      [rows[1]]
    );
    expect(mockActivities.markPublishFailed).not.toHaveBeenCalled();
    expect(mockActivities.inAppNotification).toHaveBeenCalled();
  });

  it('13b. first comment is published with the synthetic id after the main post', async () => {
    mockActivities.getPostsListForPublish.mockResolvedValue([
      row('p1', { firstComment: 'hello' }),
    ]);
    mockActivities.isCommentableById.mockResolvedValue(true);
    mockActivities.publishCommentById.mockResolvedValue({
      outcome: 'published',
      results: [{ postId: 'c1', releaseURL: 'https://x/c', status: 'completed' }],
    });
    await run();
    expect(mockActivities.publishCommentById).toHaveBeenCalledWith(
      'org',
      'int1',
      'rel1',
      undefined,
      [expect.objectContaining({ id: 'p1_first_comment', content: 'hello' })]
    );
    expect(mockActivities.markPublishFailed).not.toHaveBeenCalled();
  });

  it('14. never references the legacy retrying activities', async () => {
    await run();
    expect(mockActivities.postSocialById).toBeUndefined();
    expect(mockActivities.postCommentById).toBeUndefined();
  });
});
