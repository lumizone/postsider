export const PUBLIC_WEBHOOK_EVENTS = [
  'post.published',
  'post.failed',
  'approval.requested',
  'approval.resolved',
] as const;

export type PublicWebhookEvent = (typeof PUBLIC_WEBHOOK_EVENTS)[number];

// Delivered only by the explicit "send test" route; never subscribable.
export const PUBLIC_WEBHOOK_TEST_EVENT = 'webhook.test' as const;
export type PublicWebhookDeliveryEvent =
  | PublicWebhookEvent
  | typeof PUBLIC_WEBHOOK_TEST_EVENT;

export const PUBLIC_WEBHOOK_EVENT_SAMPLES: Record<
  PublicWebhookEvent,
  Record<string, unknown>
> = {
  'post.published': {
    post: {
      id: 'post_example',
      state: 'PUBLISHED',
      releaseURL: 'https://social.example.com/post/123',
    },
  },
  'post.failed': {
    postId: 'post_example',
    error: 'Provider rejected the post',
    post: { id: 'post_example', state: 'ERROR' },
    errorCategory: 'RATE_LIMITED',
    errorRetryable: true,
  },
  'approval.requested': {
    approvalId: 'approval_example',
    postId: 'post_example',
    status: 'PENDING',
  },
  'approval.resolved': {
    approvalId: 'approval_example',
    postId: 'post_example',
    status: 'APPROVED',
    note: null,
  },
};

export function isPublicWebhookEvent(
  value: string
): value is PublicWebhookEvent {
  return (PUBLIC_WEBHOOK_EVENTS as readonly string[]).includes(value);
}
