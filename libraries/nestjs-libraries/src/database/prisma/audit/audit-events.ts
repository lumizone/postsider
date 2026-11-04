import { PostActor } from '@postsider/nestjs-libraries/actor/post-actor';

export const AUDIT_EVENT_TYPES = [
  'post.created',
  'post.updated',
  'post.deleted',
  'post.status_changed',
  'post.approval_requested',
  'post.approval_resolved',
  'post.published',
  'post.failed',
  'post.retry_requested',
  'post.policy_evaluated',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface ResourceAuditEntry {
  organizationId: string;
  event: AuditEventType;
  targetType: 'post' | 'organization';
  targetId: string;
  /** undefined -> currentActor(); null -> no verified actor (guest). */
  actor?: PostActor | null;
  status?: 'ok' | 'error';
  metadata?: AuditMetadata;
}

const MAX_KEYS = 12;
const MAX_STRING = 200;
const BLOCKED_KEYS = new Set(['content', 'text', 'error', 'token', 'secret', 'password', 'email']);

/** Primitives only, bounded, and never content, prompts or secrets. */
export function sanitizeAuditMetadata(input: unknown): AuditMetadata {
  const out: AuditMetadata = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (BLOCKED_KEYS.has(key.toLowerCase())) continue;
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value as number | boolean | null;
    } else if (typeof value === 'string') {
      out[key] = value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value;
    }
  }
  return out;
}
