// Pure mapping from post rows to the group summary. No Nest, Prisma or React imports.
import { cleanDisplayName } from '@postsider/nestjs-libraries/agent-activity/display-name';
import { stripHtmlValidation } from '@postsider/helpers/utils/strip.html.validation';
import { actorViewFromColumns } from '@postsider/nestjs-libraries/actor/post-actor';
import type { ActorView } from '@postsider/nestjs-libraries/actor/post-actor';
import { approvalDecidedByView } from '@postsider/nestjs-libraries/database/prisma/approval/approval.projection';
import {
  RowBucket,
  bucketOfRow,
  groupBucket,
} from '@postsider/nestjs-libraries/agent-activity/activity-buckets';
import type {
  ActorDisplay,
  ActorResolver,
} from '@postsider/nestjs-libraries/database/prisma/agent-activity/actor-directory.service';

export type ActivityRow = {
  id: string;
  group: string;
  state: string;
  publishDate: Date;
  updatedAt: Date;
  content: string;
  image: string | null;
  error: string | null;
  errorCategory: string | null;
  errorRetryable: boolean | null;
  publishAttempts: number;
  releaseId: string | null;
  releaseURL: string | null;
  integrationId: string;
  createdByType: string | null;
  createdByUserId: string | null;
  createdByApiKeyId: string | null;
  createdByOAuthClientId: string | null;
  lastModifiedByType: string | null;
  lastModifiedByUserId: string | null;
  lastModifiedByApiKeyId: string | null;
  lastModifiedByOAuthClientId: string | null;
  agentName: string | null;
  workflowId: string | null;
  runId: string | null;
  externalRef: string | null;
  source: string | null;
  integration: {
    id: string;
    name: string;
    providerIdentifier: string;
    picture: string | null;
  };
};

export type GroupDestination = {
  postId: string;
  integrationId: string;
  integrationName: string;
  providerIdentifier: string;
  picture: string | null;
  state: string;
  bucket: RowBucket;
  errorCategory: string | null;
  errorRetryable: boolean | null;
  publishAttempts: number;
  releaseURL: string | null;
  publishDate: Date;
};

export type GroupSummary = {
  group: string;
  updatedAt: Date;
  bucket: RowBucket;
  contentPreview: string;
  destinations: GroupDestination[];
  createdBy: ActorDisplay | null;
  lastModifiedBy: ActorDisplay | null;
  claimed: {
    agentName: string | null;
    workflowId: string | null;
    runId: string | null;
    externalRef: string | null;
    source: string | null;
  };
  pendingApprovalIds: string[];
  canRetry: boolean;
};

export const PREVIEW_MAX = 240;
const RETRY_BUCKETS: RowBucket[] = ['retryable', 'unknown_outcome', 'failed_other'];

function preview(content: string): string {
  const text = stripHtmlValidation('none', (content ?? '').replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, PREVIEW_MAX).join('').trim();
}

// claimed provenance is untrusted text: strip controls, bidi and zero-width characters
const cleanClaim = (raw: unknown): string | null => cleanDisplayName(raw, 255);

export function toGroupSummary(
  rows: ActivityRow[],
  resolve: ActorResolver,
  pendingIds: string[]
): GroupSummary {
  if (rows.length === 0) {
    throw new Error('toGroupSummary needs at least one row');
  }
  const first = rows[0];
  const destinations: GroupDestination[] = rows.map((r) => ({
    postId: r.id,
    integrationId: r.integrationId,
    integrationName: r.integration.name,
    providerIdentifier: r.integration.providerIdentifier,
    picture: r.integration.picture,
    state: r.state,
    bucket: bucketOfRow(r),
    errorCategory: r.errorCategory,
    errorRetryable: r.errorRetryable,
    publishAttempts: r.publishAttempts,
    releaseURL: r.releaseURL,
    publishDate: r.publishDate,
  }));
  const canRetry = rows.some(
    (r, i) =>
      RETRY_BUCKETS.includes(destinations[i].bucket) &&
      (r.releaseId === null || r.releaseId === 'missing')
  );
  const updatedAt = rows.reduce(
    (max, r) => (r.updatedAt > max ? r.updatedAt : max),
    first.updatedAt
  );
  return {
    group: first.group,
    updatedAt,
    bucket: groupBucket(destinations.map((d) => d.bucket)),
    contentPreview: preview(first.content),
    destinations,
    createdBy: resolve(actorViewFromColumns(first, 'createdBy')),
    lastModifiedBy: resolve(actorViewFromColumns(first, 'lastModifiedBy')),
    claimed: {
      agentName: cleanClaim(first.agentName),
      workflowId: cleanClaim(first.workflowId),
      runId: cleanClaim(first.runId),
      externalRef: cleanClaim(first.externalRef),
      source: cleanClaim(first.source),
    },
    pendingApprovalIds: pendingIds,
    canRetry,
  };
}

// ---------------------------------------------------------------------------
// Group detail (spec R2). Every string that can carry untrusted text (guest
// names, notes, rule names, claimed provenance, stored errors, audit metadata)
// is cleaned here, on the server.
// ---------------------------------------------------------------------------

export type DetailRow = ActivityRow & {
  lastPublishAttemptAt: Date | null;
  firstComment: string | null;
};

/** `parentPostId` is the direct parent (a thread is a chain). */
export type ChildRow = { id: string; parentPostId: string; content: string; createdAt: Date };

export type ApprovalRow = {
  id: string;
  postId: string;
  status: string;
  note: string | null;
  requestedAt: Date;
  resolvedAt: Date | null;
  requestedByType: string | null;
  requestedByUserId: string | null;
  requestedByApiKeyId: string | null;
  requestedByOAuthClientId: string | null;
  decidedByType: string | null;
  approverId: string | null;
  guestName: string | null;
  guestEmail: string | null;
};

export type GuestDisplay = { type: 'GUEST'; name: string | null; email: string | null };

export type ApprovalDetail = {
  id: string;
  status: string;
  note: string | null;
  requestedAt: Date;
  resolvedAt: Date | null;
  requestedBy: ActorDisplay | null;
  decidedBy: ActorDisplay | GuestDisplay | null;
};

export type DestinationDetail = {
  postId: string;
  integration: { id: string; name: string; providerIdentifier: string; picture: string | null };
  state: string;
  bucket: RowBucket;
  errorCategory: string | null;
  errorRetryable: boolean | null;
  errorMessage: string | null;
  publishAttempts: number;
  lastPublishAttemptAt: Date | null;
  releaseURL: string | null;
  publishDate: Date;
  contentText: string;
  image: string | null;
  thread: string[];
  firstComment: string | null;
  createdBy: ActorDisplay | null;
  lastModifiedBy: ActorDisplay | null;
  claimed: GroupSummary['claimed'];
  approval: ApprovalDetail | null;
};

export type TimelineItem = {
  id: string;
  type: string;
  createdAt: Date;
  postId: string;
  actor: ActorDisplay | { type: 'GUEST' };
  metadata: Record<string, unknown>;
};

export type RecordedPolicy = {
  effect: 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';
  phase: 'write' | 'publish';
  at: Date;
  ruleNames: string[];
  matchedCount: number;
};

export const ERROR_MESSAGE_MAX = 500;
export const NOTE_MAX = 500;
export const EMAIL_MAX = 254;
export const RULE_NAME_MAX = 80;
/** Safety cap for one plain-text body; real posts are far shorter. */
export const CONTENT_TEXT_MAX = 20000;
const METADATA_STRING_MAX = 500;
const METADATA_MAX_DEPTH = 4;
// eslint-disable-next-line no-control-regex
const CONTROL_KEEP_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
// Post bodies keep ZWJ (U+200D) and LRM/RLM (U+200E/F): they are real content and the
// reviewer must see what will be published. Overrides, isolates and other zero-width stay out.
const INVISIBLE = /[\u200B\u200C\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Plain text of stored HTML: block boundaries become line breaks, untrusted characters are removed. */
export function plainText(html: string | null | undefined): string {
  const marked = (html ?? '').replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n');
  const text = stripHtmlValidation('none', marked)
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_KEEP_NEWLINE, '')
    .replace(INVISIBLE, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return Array.from(text).slice(0, CONTENT_TEXT_MAX).join('').trim();
}

/** Keys the audit writers emit (approval, post, retry, publish and policy events). */
const TIMELINE_METADATA_KEYS = new Set([
  'approvalId', 'decision', 'by', 'group', 'integrationId', 'state', 'publishDate', 'creationMethod',
  'from', 'to', 'includeUnknownOutcome', 'previousErrorCategory', 'errorCategory', 'errorRetryable',
  'releaseUrl', 'effect', 'phase', 'matchedCount', 'ruleIds', 'ruleNames',
]);

/** Timeline metadata: only known keys survive, values are cleaned. */
export function timelineMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (TIMELINE_METADATA_KEYS.has(k)) out[k] = cleanMetadata(v, 1);
  }
  return out;
}

/** Audit metadata is flat in practice; strings are cleaned and nesting is bounded. */
export function cleanMetadata(value: unknown, depth = 0): any {
  if (typeof value === 'string') return cleanDisplayName(value, METADATA_STRING_MAX) ?? '';
  if (Array.isArray(value)) {
    return depth >= METADATA_MAX_DEPTH ? [] : value.map((v) => cleanMetadata(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    if (depth >= METADATA_MAX_DEPTH) return {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = cleanDisplayName(k, 80);
      if (key !== null) out[key] = cleanMetadata(v, depth + 1);
    }
    return out;
  }
  return value;
}

const EFFECTS = ['ALLOW', 'REQUIRE_APPROVAL', 'BLOCK'] as const;
const PHASES = ['write', 'publish'] as const;

/** From the metadata of a `post.policy_evaluated` event. Null when it is not usable. */
export function parseRecordedPolicy(event: {
  createdAt: Date;
  metadata: Record<string, unknown>;
}): RecordedPolicy | null {
  const m = event.metadata ?? {};
  const effect = EFFECTS.find((e) => e === m.effect);
  const phase = PHASES.find((p) => p === m.phase);
  if (!effect || !phase) return null;
  const ruleNames =
    typeof m.ruleNames === 'string'
      ? m.ruleNames
          .split(' | ')
          .filter((n) => n.trim() !== '...')
          .flatMap((n) => {
            const cleaned = cleanDisplayName(n, RULE_NAME_MAX);
            return cleaned === null ? [] : [cleaned];
          })
      : [];
  const count = typeof m.matchedCount === 'number' && Number.isFinite(m.matchedCount) ? m.matchedCount : 0;
  return { effect, phase, at: event.createdAt, ruleNames, matchedCount: Math.max(0, Math.trunc(count)) };
}

export function toApprovalDetail(row: ApprovalRow, resolve: ActorResolver): ApprovalDetail {
  const decider = approvalDecidedByView(row);
  let decidedBy: ApprovalDetail['decidedBy'] = null;
  if (decider && decider.type === 'GUEST') {
    decidedBy = {
      type: 'GUEST',
      name: cleanDisplayName(decider.guestName, 80),
      email: cleanDisplayName(decider.guestEmail, EMAIL_MAX),
    };
  } else if (decider) {
    decidedBy = resolve(decider as ActorView);
  }
  return {
    id: row.id,
    status: row.status,
    note: cleanDisplayName(row.note, NOTE_MAX),
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt,
    requestedBy: resolve(actorViewFromColumns(row, 'requestedBy')),
    decidedBy,
  };
}

/** Descendants of one top-level post in creation order (chain or flat). */
export function threadTexts(rootId: string, children: ChildRow[]): string[] {
  const byParent = new Map<string, ChildRow[]>();
  for (const c of children) {
    const list = byParent.get(c.parentPostId) ?? [];
    list.push(c);
    byParent.set(c.parentPostId, list);
  }
  const found: ChildRow[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const c of byParent.get(id) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      found.push(c);
      queue.push(c.id);
    }
  }
  found.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  return found.map((c) => plainText(c.content));
}

export function toDestinationDetail(
  row: DetailRow,
  ctx: { children: ChildRow[]; approval: ApprovalRow | undefined; resolve: ActorResolver }
): DestinationDetail {
  return {
    postId: row.id,
    integration: {
      id: row.integration.id,
      name: cleanDisplayName(row.integration.name) ?? '',
      providerIdentifier: row.integration.providerIdentifier,
      picture: row.integration.picture,
    },
    state: row.state,
    bucket: bucketOfRow(row),
    errorCategory: row.errorCategory,
    errorRetryable: row.errorRetryable,
    errorMessage: cleanDisplayName(row.error, ERROR_MESSAGE_MAX),
    publishAttempts: row.publishAttempts,
    lastPublishAttemptAt: row.lastPublishAttemptAt,
    releaseURL: row.releaseURL,
    publishDate: row.publishDate,
    contentText: plainText(row.content),
    image: row.image,
    thread: threadTexts(row.id, ctx.children),
    firstComment: row.firstComment === null ? null : plainText(row.firstComment) || null,
    createdBy: ctx.resolve(actorViewFromColumns(row, 'createdBy')),
    lastModifiedBy: ctx.resolve(actorViewFromColumns(row, 'lastModifiedBy')),
    claimed: {
      agentName: cleanClaim(row.agentName),
      workflowId: cleanClaim(row.workflowId),
      runId: cleanClaim(row.runId),
      externalRef: cleanClaim(row.externalRef),
      source: cleanClaim(row.source),
    },
    approval: ctx.approval ? toApprovalDetail(ctx.approval, ctx.resolve) : null,
  };
}
