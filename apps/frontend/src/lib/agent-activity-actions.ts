// Pure rules for the Agent Control Center actions. No React, no API imports.
import type { RowBucketName } from './agent-activity-model';

export const EDITABLE_STATES = ['DRAFT', 'QUEUE', 'APPROVAL', 'ERROR', 'HELD'];

/** Roles that may approve, reject and retry (the server enforces the same). */
export function canResolve(role: string | null | undefined): boolean {
  return role === 'ADMIN' || role === 'SUPERADMIN';
}

export interface GroupActionInput {
  role: string | null | undefined;
  canRetry: boolean;
  buckets: RowBucketName[];
  pendingCount: number;
}

export interface GroupActionVisibility {
  approve: boolean;
  reject: boolean;
  /** "Retry failed": never re-arms an unknown outcome. */
  retry: boolean;
  /** "Retry anyway": always goes through the confirm dialog. */
  retryAnyway: boolean;
}

export function groupActionVisibility(input: GroupActionInput): GroupActionVisibility {
  if (!canResolve(input.role)) {
    return { approve: false, reject: false, retry: false, retryAnyway: false };
  }
  const pending = input.pendingCount > 0;
  const retryable = input.buckets.some((b) => b === 'retryable' || b === 'failed_other');
  const unknown = input.buckets.includes('unknown_outcome');
  return {
    approve: pending,
    reject: pending,
    retry: input.canRetry && retryable,
    retryAnyway: input.canRetry && unknown,
  };
}

export interface DestinationLinkInput {
  role: string | null | undefined;
  state: string;
  hasReleaseUrl: boolean;
}

export interface DestinationLinkVisibility {
  openEditor: boolean;
  openCalendar: boolean;
  viewOnPlatform: boolean;
}

export function destinationLinkVisibility(input: DestinationLinkInput): DestinationLinkVisibility {
  return {
    // The calendar hides editing from the USER role, so the link would do nothing.
    openEditor: input.role !== 'USER' && EDITABLE_STATES.includes(input.state),
    openCalendar: true,
    viewOnPlatform: input.state === 'PUBLISHED' && input.hasReleaseUrl,
  };
}

/** Only an explicit "retry anyway" with the box ticked asks the server to re-arm unknown outcomes. */
export function retryFlag(kind: 'plain' | 'anyway', confirmed: boolean): boolean {
  return kind === 'anyway' && confirmed === true;
}

export function pendingApprovalIdsOf(
  destinations: Array<{ approval: { id: string; status: string } | null }>,
): string[] {
  const ids = new Set<string>();
  for (const d of destinations) {
    if (d.approval && d.approval.status === 'PENDING') ids.add(d.approval.id);
  }
  return Array.from(ids);
}

/** Local calendar date (YYYY-MM-DD) of an ISO instant, or null when invalid. */
export function calendarDateParam(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function summarizeRetry(results: Array<{ action: string }>): {
  requeued: number;
  skipped: number;
  approval: number;
} {
  const out = { requeued: 0, skipped: 0, approval: 0 };
  for (const r of results) {
    if (r.action === 'requeued') out.requeued += 1;
    else if (r.action === 'approval_requested') out.approval += 1;
    else out.skipped += 1;
  }
  return out;
}

export function summarizeBulk(summary: { done: number; skipped: number; failed: number }) {
  return { ...summary, hasFailures: summary.failed > 0 };
}
