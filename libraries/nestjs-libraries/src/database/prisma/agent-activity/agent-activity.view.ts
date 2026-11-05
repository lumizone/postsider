// Pure mapping from post rows to the group summary. No Nest, Prisma or React imports.
import { stripHtmlValidation } from '@postsider/helpers/utils/strip.html.validation';
import { actorViewFromColumns } from '@postsider/nestjs-libraries/actor/post-actor';
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
  const text = stripHtmlValidation('none', content ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(text).slice(0, PREVIEW_MAX).join('').trim();
}

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
      agentName: first.agentName ?? null,
      workflowId: first.workflowId ?? null,
      runId: first.runId ?? null,
      externalRef: first.externalRef ?? null,
      source: first.source ?? null,
    },
    pendingApprovalIds: pendingIds,
    canRetry,
  };
}
