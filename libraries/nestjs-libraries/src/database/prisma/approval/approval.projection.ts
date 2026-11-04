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
