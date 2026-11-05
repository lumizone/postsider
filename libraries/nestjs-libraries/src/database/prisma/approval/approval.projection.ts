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
    if (
      row.decidedByType === 'API_KEY' &&
      typeof row.decidedByApiKeyId === 'string'
    ) {
      view.apiKeyId = row.decidedByApiKeyId;
    }
    if (
      row.decidedByType === 'OAUTH_CLIENT' &&
      typeof row.decidedByOAuthClientId === 'string'
    ) {
      view.oauthClientId = row.decidedByOAuthClientId;
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

export type StageSummary = { position: number; total: number; name: string };

export type StageStatusView = {
  position: number;
  name: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'NOT_REACHED';
  decidedBy: ApprovalDeciderView | null;
  decidedAt: Date | null;
};

const IMPLICIT_STAGE_NAME = 'Approval';

function stageDecidedBy(row: Record<string, any>): ApprovalDeciderView | null {
  if (row.status === 'PENDING') return null;
  const view = actorViewFromColumns(row, 'decidedBy');
  if (view) return view;
  if (row.decidedVia === 'GUEST') {
    return { type: 'GUEST', guestName: null, guestEmail: null };
  }
  return null;
}

/**
 * Progress of an approval, from its snapshot rows. An approval without rows is
 * the single implicit stage. Stages that follow a rejected one were never
 * reached: that label exists in this view only (the column has no such value).
 * Explicit field picks: no approver lists, no ids beyond the actor view.
 */
export function toStageView(approval: Record<string, any>): {
  stage: StageSummary;
  stages: StageStatusView[];
} {
  const rows: Array<Record<string, any>> = Array.isArray(approval.stages)
    ? [...approval.stages].sort((a, b) => a.position - b.position)
    : [];
  if (rows.length === 0) {
    const decided = approval.status !== 'PENDING';
    return {
      stage: { position: 1, total: 1, name: IMPLICIT_STAGE_NAME },
      stages: [
        {
          position: 1,
          name: IMPLICIT_STAGE_NAME,
          status: approval.status,
          decidedBy: decided ? approvalDecidedByView(approval) : null,
          decidedAt: decided ? (approval.resolvedAt ?? null) : null,
        },
      ],
    };
  }
  const rejectedAt = rows.find((r) => r.status === 'REJECTED')?.position;
  const stages = rows.map((r): StageStatusView => ({
    position: r.position,
    name: r.name,
    status:
      r.status === 'PENDING' && rejectedAt !== undefined && r.position > rejectedAt
        ? 'NOT_REACHED'
        : r.status,
    decidedBy: stageDecidedBy(r),
    decidedAt: r.decidedAt ?? null,
  }));
  const current =
    rows.find((r) => r.position === approval.currentStage) ??
    rows.find((r) => r.status === 'PENDING') ??
    rows[rows.length - 1];
  return {
    stage: { position: current.position, total: rows.length, name: current.name },
    stages,
  };
}

/** Removes the raw snapshot rows and adds the stage view. */
export function withStageView<T extends Record<string, any>>(
  approval: T
): Omit<T, 'stages'> & ReturnType<typeof toStageView> {
  const { stages: _raw, ...rest } = approval;
  return { ...rest, ...toStageView(approval) } as Omit<T, 'stages'> &
    ReturnType<typeof toStageView>;
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

const STAGE_KEYS = ['position', 'total', 'name', 'status', 'decidedBy', 'decidedAt'];

function pickStageRow(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of STAGE_KEYS) {
    if (row && row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

function pickStage(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object'
    ? pickStageRow(value as Record<string, any>)
    : null;
}

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
    stage: pickStage(row.stage),
    stages: Array.isArray(row.stages) ? row.stages.map(pickStageRow) : [],
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
