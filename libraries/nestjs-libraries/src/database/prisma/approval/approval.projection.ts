import {
  ActorView,
  actorViewFromColumns,
} from '@postsider/nestjs-libraries/actor/post-actor';

export type ApprovalDeciderView =
  | ActorView
  | { type: 'GUEST'; guestName: string | null; guestEmail: string | null };

/**
 * Explicit public projection of an approval row. Never includes the guest
 * token, its expiry or the internal requester id (routing only).
 */
export function toPublicApproval(row: Record<string, any>, created?: boolean) {
  return {
    id: row.id as string,
    postId: row.postId as string,
    status: row.status as string,
    note: (row.note ?? null) as string | null,
    requestedAt: row.requestedAt as Date,
    resolvedAt: (row.resolvedAt ?? null) as Date | null,
    requestedBy: actorViewFromColumns(row, 'requestedBy'),
    ...(created === undefined ? {} : { created }),
  };
}

export function approvalDecidedByView(
  row: Record<string, any>
): ApprovalDeciderView | null {
  if (typeof row.decidedByType === 'string') {
    const view: ActorView = { type: row.decidedByType as ActorView['type'] };
    if (row.decidedByType === 'USER' && typeof row.approverId === 'string') {
      view.userId = row.approverId;
    }
    return view;
  }
  if (row.guestName || row.guestEmail) {
    return {
      type: 'GUEST',
      guestName: row.guestName ?? null,
      guestEmail: row.guestEmail ?? null,
    };
  }
  return null;
}

export type DashboardApproval = {
  id: string;
  postId: string;
  status: string;
  note: string | null;
  requestedAt: Date;
  resolvedAt: Date | null;
  requestedBy?: { name: string | null; email: string };
  post?: Record<string, any>;
  stage: Record<string, any> | null;
  stages: Array<Record<string, any>>;
  hasGuestLink: boolean;
  guestLinkExpiresAt?: Date | null;
  created?: boolean;
};

/**
 * Explicit projection of an approval row for the dashboard routes. Picks known
 * fields only: no token, no token hash, no requester or approver ids. Admins
 * learn whether an unexpired guest link exists (and when it expires); members
 * never do.
 */
export function toDashboardApproval(
  row: Record<string, any>,
  opts: { isAdmin: boolean }
): DashboardApproval {
  const expiresAt: Date | null = row.guestTokenExpiresAt ?? null;
  const live =
    opts.isAdmin &&
    typeof row.guestTokenHash === 'string' &&
    row.guestTokenHash.length > 0 &&
    expiresAt !== null &&
    new Date(expiresAt).getTime() > Date.now();
  const out: DashboardApproval = {
    id: row.id as string,
    postId: row.postId as string,
    status: row.status as string,
    note: (row.note ?? null) as string | null,
    requestedAt: row.requestedAt as Date,
    resolvedAt: (row.resolvedAt ?? null) as Date | null,
    stage: row.stage ?? null,
    stages: Array.isArray(row.stages) ? row.stages : [],
    hasGuestLink: live,
  };
  if (row.requestedBy && typeof row.requestedBy === 'object') {
    out.requestedBy = {
      name: row.requestedBy.name ?? null,
      email: row.requestedBy.email as string,
    };
  }
  if (row.post && typeof row.post === 'object') {
    out.post = row.post;
  }
  if (opts.isAdmin) {
    out.guestLinkExpiresAt = live ? expiresAt : null;
  }
  if (typeof row.created === 'boolean') {
    out.created = row.created;
  }
  return out;
}
