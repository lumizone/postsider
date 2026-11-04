import { BadBody, RefreshToken, NotEnoughScopes } from './social.abstract';
import {
  classifyPublishError,
  sanitizeFailureMessage,
  isPreConnectionError,
  PUBLISH_ERROR_CATEGORIES,
  UNKNOWN_OUTCOME_MESSAGE,
  PrePublishError,
} from './publish-error.classifier';
import { PublishErrorCategory } from '@prisma/client';
import { ActivityFailure, TimeoutFailure, TimeoutType } from '@temporalio/common';

const wrapped = (cause: unknown) => ({
  name: 'ActivityFailure',
  message: 'Activity task failed',
  cause,
});
const net = (code: string) =>
  Object.assign(new TypeError('fetch failed'), { cause: { code } });

describe('classifyPublishError', () => {
  it('refresh_token -> AUTH_EXPIRED, retryable false, autoRetry refresh', () => {
    expect(
      classifyPublishError(new RefreshToken('x', '{}', '', 'expired'))
    ).toEqual({
      category: 'AUTH_EXPIRED',
      retryable: false,
      autoRetry: 'refresh',
      message: 'expired',
    });
  });
  it('same through an ActivityFailure wrapper', () => {
    expect(
      classifyPublishError(wrapped(new RefreshToken('x', '{}', '', 'expired')))
        .category
    ).toBe('AUTH_EXPIRED');
  });
  it('not_enough_scopes -> PERMISSION_MISSING false none', () => {
    expect(classifyPublishError(new NotEnoughScopes())).toMatchObject({
      category: 'PERMISSION_MISSING',
      retryable: false,
      autoRetry: 'none',
    });
  });
  it('bad_body without kind -> INVALID_CONTENT false none, keeps provider message', () => {
    expect(
      classifyPublishError(new BadBody('x', '{}', '', 'Text too long'))
    ).toEqual({
      category: 'INVALID_CONTENT',
      retryable: false,
      autoRetry: 'none',
      message: 'Text too long',
    });
  });
  it.each([
    ['rate_limited', 'RATE_LIMITED', true, 'delay'],
    ['provider_unavailable', 'PROVIDER_UNAVAILABLE', false, 'none'],
    ['pre_connection', 'PROVIDER_UNAVAILABLE', true, 'delay'],
    ['unknown_outcome', 'UNKNOWN_OUTCOME', false, 'none'],
  ])('bad_body kind %s', (kind, category, retryable, autoRetry) => {
    const err = Object.assign(new BadBody('x', '{}', '', 'm'), {
      details: [{ identifier: 'x', json: '{}', body: '', kind }],
    });
    expect(classifyPublishError(err)).toMatchObject({
      category,
      retryable,
      autoRetry,
    });
  });
  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])(
    '%s before connect -> PROVIDER_UNAVAILABLE retryable delay',
    (code) => {
      expect(classifyPublishError(net(code))).toMatchObject({
        category: 'PROVIDER_UNAVAILABLE',
        retryable: true,
        autoRetry: 'delay',
      });
      expect(isPreConnectionError(net(code))).toBe(true);
    }
  );
  it('Temporal timeout is UNKNOWN_OUTCOME with the exact message', () => {
    expect(
      classifyPublishError(
        wrapped({ name: 'TimeoutFailure', timeoutType: 'START_TO_CLOSE' })
      )
    ).toEqual({
      category: 'UNKNOWN_OUTCOME',
      retryable: false,
      autoRetry: 'none',
      message: UNKNOWN_OUTCOME_MESSAGE,
    });
  });
  it.each([
    Object.assign(new Error('x'), { name: 'AbortError' }),
    Object.assign(new Error('x'), { name: 'TimeoutError' }),
    net('ECONNRESET'),
    net('ETIMEDOUT'),
    net('UND_ERR_SOCKET'),
    new Error('boom'),
    'a string',
    undefined,
    null,
  ])('ambiguous %# is UNKNOWN_OUTCOME', (e) => {
    expect(classifyPublishError(e)).toMatchObject({
      category: 'UNKNOWN_OUTCOME',
      retryable: false,
      autoRetry: 'none',
    });
    expect(isPreConnectionError(e)).toBe(false);
  });
  it('PrePublishError is UNKNOWN, not retryable, nothing sent', () => {
    expect(
      classifyPublishError(new PrePublishError('No active subscription'))
    ).toEqual({
      category: 'UNKNOWN',
      retryable: false,
      autoRetry: 'none',
      message: 'No active subscription',
    });
  });
  it('messages are capped at 500 chars and contain no em/en dash', () => {
    const m = sanitizeFailureMessage(
      'a—b–c' + 'x'.repeat(600),
      'fallback'
    );
    expect(m.length).toBe(500);
    expect(m).not.toMatch(/[–—]/);
    expect(m.startsWith('a-b-c')).toBe(true);
    expect(sanitizeFailureMessage('', 'fallback')).toBe('fallback');
    expect(UNKNOWN_OUTCOME_MESSAGE).not.toMatch(/[–—]/);
  });
  it('includes POLICY_BLOCKED and still ends with UNKNOWN', () => {
    expect(PUBLISH_ERROR_CATEGORIES).toContain('POLICY_BLOCKED');
    expect(PUBLISH_ERROR_CATEGORIES[PUBLISH_ERROR_CATEGORIES.length - 1]).toBe('UNKNOWN');
  });
  it('category list equals the Prisma enum', () => {
    expect([...PUBLISH_ERROR_CATEGORIES].sort()).toEqual(
      Object.values(PublishErrorCategory).sort()
    );
  });
});

describe('classifyPublishError with real Temporal failures', () => {
  it('treats an activity START_TO_CLOSE timeout as UNKNOWN_OUTCOME', () => {
    const err = new ActivityFailure(
      'Activity task timed out',
      'publishPostById',
      'a1',
      0 as any,
      'worker',
      new TimeoutFailure(
        'timeout',
        undefined,
        TimeoutType.TIMEOUT_TYPE_START_TO_CLOSE
      )
    );
    expect(classifyPublishError(err)).toMatchObject({
      category: 'UNKNOWN_OUTCOME',
      retryable: false,
      autoRetry: 'none',
    });
  });
});
