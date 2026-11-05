"use client";

import { api } from "@/lib/api";

// Types mirror the JSON the backend sends (dates are ISO strings on the wire).
// Source of truth: libraries/nestjs-libraries/src/database/prisma/agent-activity/*.view.ts

import type { RowBucketName } from "./agent-activity-model";

export type { RowBucketName };

export interface AgentSummary {
  timezone: string;
  dayStart: string;
  dayEnd: string;
  actionsToday: number;
  waitingForReview: number;
  policyBlocked: number;
  failed: { total: number; retryable: number; unknownOutcome: number; other: number };
  publishedToday: number;
}

export interface ActorDisplay {
  type: "USER" | "API_KEY" | "OAUTH_CLIENT" | "SYSTEM";
  id: string | null;
  name: string | null;
  state: "ok" | "revoked" | "unknown" | "legacy";
  authorizedBy: string | null;
}

export interface AgentDestination {
  postId: string;
  integrationId: string;
  integrationName: string;
  providerIdentifier: string;
  picture: string | null;
  state: string;
  bucket: RowBucketName;
  errorCategory: string | null;
  errorRetryable: boolean | null;
  publishAttempts: number;
  releaseURL: string | null;
  publishDate: string;
}

export interface ClaimedProvenance {
  agentName: string | null;
  workflowId: string | null;
  runId: string | null;
  externalRef: string | null;
  source: string | null;
}

export interface AgentGroup {
  group: string;
  updatedAt: string;
  bucket: RowBucketName;
  contentPreview: string;
  destinations: AgentDestination[];
  createdBy: ActorDisplay | null;
  lastModifiedBy: ActorDisplay | null;
  claimed: ClaimedProvenance;
  pendingApprovalIds: string[];
  canRetry: boolean;
}

export interface AgentListResponse {
  groups: AgentGroup[];
  nextCursor: string | null;
}

export interface GuestDisplay {
  type: "GUEST";
  name: string | null;
  email: string | null;
}

export interface ApprovalDetail {
  id: string;
  status: string;
  note: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  requestedBy: ActorDisplay | null;
  decidedBy: ActorDisplay | GuestDisplay | null;
}

export interface DestinationDetail {
  postId: string;
  integration: { id: string; name: string; providerIdentifier: string; picture: string | null };
  state: string;
  bucket: RowBucketName;
  errorCategory: string | null;
  errorRetryable: boolean | null;
  errorMessage: string | null;
  publishAttempts: number;
  lastPublishAttemptAt: string | null;
  releaseURL: string | null;
  publishDate: string;
  contentText: string;
  image: string | null;
  thread: string[];
  firstComment: string | null;
  createdBy: ActorDisplay | null;
  lastModifiedBy: ActorDisplay | null;
  claimed: ClaimedProvenance;
  approval: ApprovalDetail | null;
}

export interface TimelineItem {
  id: string;
  type: string;
  createdAt: string;
  postId: string;
  actor: ActorDisplay | { type: "GUEST" };
  metadata: Record<string, unknown>;
}

export type PolicyEffect = "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK";

export interface RecordedPolicy {
  effect: PolicyEffect;
  phase: "write" | "publish";
  at: string;
  ruleNames: string[];
  matchedCount: number;
}

export interface AgentGroupDetail {
  group: string;
  updatedAt: string;
  destinations: DestinationDetail[];
  policy: {
    recorded: RecordedPolicy | null;
    current: {
      effect: PolicyEffect;
      matched: Array<{ ruleId: string; name: string; effect: string; condition: string }>;
    } | null;
  };
  timeline: TimelineItem[];
}

export interface BulkItemResult {
  approvalId: string;
  postId: string | null;
  status: "done" | "skipped" | "failed";
  reason?: "already_resolved" | "not_found" | "error";
  message?: string;
}

export interface BulkResult {
  results: BulkItemResult[];
  summary: { done: number; skipped: number; failed: number };
}

export interface RetryItemResult {
  postId: string;
  integrationId: string;
  previousState: string;
  action: "requeued" | "skipped" | "approval_requested";
  reason?:
    | "not_in_error_state"
    | "unknown_outcome_requires_confirmation"
    | "already_published"
    | "rearm_failed"
    | "not_evaluated";
}

export interface RetryResult {
  group: string;
  results: RetryItemResult[];
  policy: { effect: PolicyEffect; matched: unknown[] } | null;
}

/** `value` goes into the query, `label` is the cleaned text to display. */
export interface FilterOption {
  value: string;
  label: string;
}

export interface AgentActorOption {
  /** `API_KEY:<id>` or `OAUTH_CLIENT:<id>`, sent as the `actor` query value */
  key: string;
  type: "API_KEY" | "OAUTH_CLIENT";
  id: string | null;
  name: string | null;
  state: "ok" | "revoked" | "unknown" | "legacy";
}

export interface AgentFilterOptions {
  actors: AgentActorOption[];
  agentNames: FilterOption[];
  sources: FilterOption[];
}

export const getAgentSummary = (timezone?: string) =>
  api.get<AgentSummary>("/agent-activity/summary", timezone ? { timezone } : undefined);

export const listAgentActivity = (query: Record<string, string>) =>
  api.get<AgentListResponse>("/agent-activity", query);

export const getAgentFilters = () => api.get<AgentFilterOptions>("/agent-activity/filters");

/** A 404 means the group changed (for example a new group id after an edit). */
export const getAgentGroup = (group: string) =>
  api.get<AgentGroupDetail>(`/agent-activity/groups/${encodeURIComponent(group)}`);

export const bulkResolveApprovals = (body: {
  action: "approve" | "reject";
  approvalIds: string[];
  note?: string;
  /** approval id -> stage position the admin saw (optional; a moved approval is skipped). */
  stages?: Record<string, number>;
}) => api.post<BulkResult>("/agent-activity/approvals/bulk", body);

export const retryAgentGroup = (group: string, includeUnknownOutcome: boolean) =>
  api.post<RetryResult>(`/agent-activity/groups/${encodeURIComponent(group)}/retry-failed`, {
    includeUnknownOutcome,
  });
