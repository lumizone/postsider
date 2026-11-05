// Pure list model for the Agent Control Center. No React, no API imports.
import type { AgentBucket } from "./agent-activity-filters";

export type RowBucketName =
  | "unknown_outcome"
  | "blocked"
  | "retryable"
  | "failed_other"
  | "review"
  | "held"
  | "scheduled"
  | "draft"
  | "published";

/** Minimal group shape used by the selection helpers. */
export type SelectableGroup = { group: string; pendingApprovalIds: string[] };

export const MAX_BULK_APPROVALS = 50;

export const FILTER_BUCKETS: AgentBucket[] = [
  "attention", "review", "blocked", "failed", "published", "scheduled", "draft", "all",
];

export const BUCKET_WEIGHT: Record<RowBucketName, "filled" | "outline" | "dotted" | "struck" | "plain"> = {
  unknown_outcome: "filled",
  blocked: "filled",
  retryable: "outline",
  failed_other: "outline",
  review: "dotted",
  held: "struck",
  scheduled: "plain",
  draft: "plain",
  published: "plain",
};

export const TILE_BUCKET = { review: "review", blocked: "blocked", failed: "failed" } as const;

/** Append `next`, dropping groups already present (first occurrence wins). */
export function mergeGroupPages<T extends { group: string }>(prev: T[], next: T[]): T[] {
  const seen = new Set(prev.map((g) => g.group));
  const out = prev.slice();
  for (const g of next) {
    if (seen.has(g.group)) continue;
    seen.add(g.group);
    out.push(g);
  }
  return out;
}

export function toggleGroup(sel: Set<string>, group: string): Set<string> {
  const next = new Set(sel);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  return next;
}

/** Distinct pending approval ids of the selected groups, at most 50. */
export function selectedApprovalIds(groups: SelectableGroup[], sel: Set<string>): string[] {
  const ids = new Set<string>();
  for (const g of groups) {
    if (!sel.has(g.group)) continue;
    for (const id of g.pendingApprovalIds) {
      ids.add(id);
      if (ids.size >= MAX_BULK_APPROVALS) return Array.from(ids);
    }
  }
  return Array.from(ids);
}

/** Drop selected groups that are gone or no longer have a pending approval. */
export function pruneSelection(sel: Set<string>, groups: SelectableGroup[]): Set<string> {
  const keep = new Set(groups.filter((g) => g.pendingApprovalIds.length > 0).map((g) => g.group));
  const next = new Set<string>();
  sel.forEach((g) => {
    if (keep.has(g)) next.add(g);
  });
  return next;
}

export const bucketLabelKey = (b: string): string => `agentActivity.bucket.${b}`;
