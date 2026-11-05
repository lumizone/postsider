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

const SAMPLE_ACTOR = {
  createdBy: { type: 'API_KEY', apiKeyId: 'api_key_example' },
  lastModifiedBy: { type: 'SYSTEM' },
};
const SAMPLE_PROVENANCE = {
  agentName: 'content-agent',
  workflowId: null,
  runId: null,
  externalRef: null,
  source: 'api',
};

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
    actor: SAMPLE_ACTOR,
    provenance: SAMPLE_PROVENANCE,
  },
  'post.failed': {
    postId: 'post_example',
    error: 'Provider rejected the post',
    post: { id: 'post_example', state: 'ERROR' },
    errorCategory: 'RATE_LIMITED',
    errorRetryable: true,
    actor: SAMPLE_ACTOR,
    provenance: SAMPLE_PROVENANCE,
  },
  'approval.requested': {
    approvalId: 'approval_example',
    postId: 'post_example',
    status: 'PENDING',
    actor: SAMPLE_ACTOR,
    provenance: SAMPLE_PROVENANCE,
    approval: {
      requestedBy: { type: 'API_KEY', apiKeyId: 'api_key_example' },
      decidedBy: null,
    },
  },
  'approval.resolved': {
    approvalId: 'approval_example',
    postId: 'post_example',
    status: 'APPROVED',
    note: null,
    actor: SAMPLE_ACTOR,
    provenance: SAMPLE_PROVENANCE,
    approval: {
      requestedBy: { type: 'API_KEY', apiKeyId: 'api_key_example' },
      decidedBy: { type: 'USER', userId: 'user_example' },
    },
  },
};

export function isPublicWebhookEvent(
  value: string
): value is PublicWebhookEvent {
  return (PUBLIC_WEBHOOK_EVENTS as readonly string[]).includes(value);
}
