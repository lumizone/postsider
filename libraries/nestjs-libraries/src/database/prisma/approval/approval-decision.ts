import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  actorViewFromColumns,
  type ActorView,
  type PostActor,
} from '@postsider/nestjs-libraries/actor/post-actor';
import type {
  FlowRules,
  Origin,
  StageDef,
  StageVerdict,
} from './approval-stage.rules';

// Pure helpers of the approval decision engine. No Nest providers, no Prisma:
// the service wires them to the repository.

export type DecisionVia = 'DASHBOARD' | 'API' | 'EMAIL_LINK' | 'GUEST' | 'BULK';

/** Who decides. `actor` is null for a guest (a guest is not a member). */
export type Decider = {
  actor: PostActor | null;
  userId?: string;
  role?: string;
  via: DecisionVia;
  guest?: { name: string; email: string } | null;
};

export type DecideOpts = {
  note?: string | null;
  /** Reject the call (as a lost race) when the approval is no longer at this stage. */
  expectStage?: number;
  /** Plaintext guest link token, consumed in the decision transaction. */
  guestToken?: string;
};

export type DecisionResult = {
  approvalId: string;
  postId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  changed: boolean;
  stage: { position: number; total: number };
  final: boolean;
};

/** Stage snapshot row as stored (only the fields the engine reads). */
export type StageRow = {
  position: number;
  name: string;
  minRole: string;
  approverUserIds: string[];
  allowAutomation: boolean;
  allowGuest: boolean;
  status: string;
  decidedByType?: string | null;
  decidedByUserId?: string | null;
  decidedByApiKeyId?: string | null;
  decidedByOAuthClientId?: string | null;
};

/** Used when a flow based approval cannot load its flow: fail closed. */
export const STRICT_RULES: FlowRules = {
  preventSelfApproval: true,
  requireDistinctApprovers: true,
};

export function stageDefFromRow(row: StageRow): StageDef {
  return {
    position: row.position,
    name: row.name,
    minRole: row.minRole === 'SUPERADMIN' ? 'SUPERADMIN' : 'ADMIN',
    approverUserIds: [...(row.approverUserIds ?? [])],
    allowAutomation: row.allowAutomation,
    allowGuest: row.allowGuest,
  };
}

/**
 * Where the approval came from, for the self-approval and distinct approver
 * rules. A legacy approval without requester actor columns falls back to the
 * stored requester user.
 */
export function originOf(
  approval: Record<string, any>,
  post: Record<string, any> | null,
  rows: StageRow[],
  position: number
): Origin {
  const requestedBy: ActorView | null =
    actorViewFromColumns(approval, 'requestedBy') ??
    (typeof approval.requestedById === 'string'
      ? { type: 'USER', userId: approval.requestedById }
      : null);
  const earlierDeciders = rows
    .filter((r) => r.position < position && r.status === 'APPROVED')
    .map((r) => actorViewFromColumns(r as Record<string, any>, 'decidedBy'))
    .filter((v): v is ActorView => v !== null);
  return {
    createdBy: actorViewFromColumns(post, 'createdBy'),
    requestedBy,
    earlierDeciders,
  };
}

/** Maps a failed stage verdict to the HTTP error callers see. */
export function verdictError(
  verdict: Extract<StageVerdict, { ok: false }>
): ForbiddenException {
  if (verdict.reason === 'self_approval' || verdict.reason === 'not_distinct') {
    return new ForbiddenException({
      error: 'self_approval_blocked',
      reason: verdict.reason,
      msg:
        verdict.reason === 'self_approval'
          ? 'You cannot decide an approval for content you created or requested.'
          : 'A different approver is required for this stage.',
    });
  }
  return new ForbiddenException({
    error: 'not_allowed_for_stage',
    reason: verdict.reason,
    msg: 'You are not allowed to decide this approval stage.',
  });
}

export function resultOf(
  approval: Record<string, any>,
  changed: boolean
): DecisionResult {
  const rows: unknown[] = Array.isArray(approval.stages) ? approval.stages : [];
  const status = approval.status as DecisionResult['status'];
  return {
    approvalId: approval.id,
    postId: approval.postId,
    status,
    changed,
    stage: {
      position: approval.currentStage ?? 1,
      total: rows.length > 0 ? rows.length : 1,
    },
    final: status !== 'PENDING',
  };
}

export function alreadyResolved(
  approval: Record<string, any>,
  wanted: 'APPROVED' | 'REJECTED'
): DecisionResult {
  if (approval.status === wanted) return resultOf(approval, false);
  throw new ConflictException({
    error: 'approval_already_resolved',
    status: approval.status,
  });
}
