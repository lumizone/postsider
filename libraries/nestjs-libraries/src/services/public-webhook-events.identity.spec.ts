import {
  PUBLIC_WEBHOOK_EVENTS,
  PUBLIC_WEBHOOK_EVENT_SAMPLES,
} from './public-webhook-events';

describe('webhook samples identity', () => {
  it.each([...PUBLIC_WEBHOOK_EVENTS])('%s sample has actor and provenance', (event) => {
    const sample: any = PUBLIC_WEBHOOK_EVENT_SAMPLES[event];
    expect(typeof sample.actor).toBe('object');
    expect(typeof sample.provenance).toBe('object');
  });

  it('approval samples carry approval and keep original keys', () => {
    const s: any = PUBLIC_WEBHOOK_EVENT_SAMPLES;
    expect(s['approval.requested'].approval).toBeDefined();
    expect(s['approval.resolved'].approval).toBeDefined();
    expect(s['approval.requested']).toMatchObject({ approvalId: expect.any(String), postId: expect.any(String), status: 'PENDING' });
    expect(s['approval.resolved']).toMatchObject({ status: 'APPROVED', note: null });
    expect(s['post.published'].post).toBeDefined();
    expect(s['post.failed']).toMatchObject({ postId: expect.any(String), error: expect.any(String), errorCategory: expect.any(String), errorRetryable: true });
  });
});
