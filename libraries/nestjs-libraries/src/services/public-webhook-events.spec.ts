import {
  PUBLIC_WEBHOOK_EVENTS,
  PUBLIC_WEBHOOK_EVENT_SAMPLES,
  PUBLIC_WEBHOOK_TEST_EVENT,
} from './public-webhook-events';
import { PUBLISH_ERROR_CATEGORIES } from '@postsider/nestjs-libraries/integrations/publish-error.classifier';

describe('public webhook event samples', () => {
  it('has a sample for every event', () => {
    for (const event of PUBLIC_WEBHOOK_EVENTS) {
      expect(PUBLIC_WEBHOOK_EVENT_SAMPLES[event]).toBeDefined();
    }
  });

  it('post.failed sample carries the error taxonomy', () => {
    const sample = PUBLIC_WEBHOOK_EVENT_SAMPLES['post.failed'];
    expect(sample).toEqual(
      expect.objectContaining({
        postId: expect.anything(),
        error: expect.anything(),
        post: expect.anything(),
        errorCategory: expect.anything(),
        errorRetryable: expect.anything(),
      })
    );
    expect(PUBLISH_ERROR_CATEGORIES as readonly string[]).toContain(
      sample.errorCategory
    );
  });
});

describe('webhook test event', () => {
  it('is a delivery event but not a subscribable event', () => {
    expect(PUBLIC_WEBHOOK_TEST_EVENT).toBe('webhook.test');
    expect((PUBLIC_WEBHOOK_EVENTS as readonly string[]).includes(PUBLIC_WEBHOOK_TEST_EVENT)).toBe(false);
  });
});
