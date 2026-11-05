import type { ActorView, PostActor } from '../../../actor/post-actor';

export type StageDef = {
  position: number;
  name: string;
  minRole: 'ADMIN' | 'SUPERADMIN';
  approverUserIds: string[];
  allowAutomation: boolean;
  allowGuest: boolean;
};

export type FlowRules = {
  preventSelfApproval: boolean;
  requireDistinctApprovers: boolean;
};

/** The single stage used when an organization has no approval flow. */
export const IMPLICIT_STAGE: StageDef = {
  position: 1,
  name: 'Approval',
  minRole: 'ADMIN',
  approverUserIds: [],
  allowAutomation: true,
  allowGuest: true,
};

export const IMPLICIT_RULES: FlowRules = {
  preventSelfApproval: false,
  requireDistinctApprovers: false,
};

export type Decider =
  | {
      kind: 'member';
      userId: string;
      role: 'USER' | 'ADMIN' | 'SUPERADMIN';
      disabled?: boolean;
    }
  | {
      kind: 'automation';
      actor: Extract<PostActor, { type: 'API_KEY' | 'OAUTH_CLIENT' }>;
    }
  | { kind: 'guest' };

export type Origin = {
  createdBy: ActorView | null;
  requestedBy: ActorView | null;
  earlierDeciders: ActorView[];
};

export type StageVerdict =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'role'
        | 'not_listed'
        | 'disabled'
        | 'automation_not_allowed'
        | 'guest_not_allowed'
        | 'self_approval'
        | 'not_distinct';
    };

/**
 * Two actors are the same when their type and the matching id are equal.
 * A legacy key (no apiKeyId) equals another legacy key. Null equals nothing.
 */
export function sameActor(
  a: ActorView | null | undefined,
  b: ActorView | null | undefined
): boolean {
  if (!a || !b || a.type !== b.type) return false;
  switch (a.type) {
    case 'USER':
      return !!a.userId && a.userId === b.userId;
    case 'API_KEY':
      return (a.apiKeyId ?? null) === (b.apiKeyId ?? null);
    case 'OAUTH_CLIENT':
      return (a.oauthClientId ?? null) === (b.oauthClientId ?? null);
    case 'SYSTEM':
      return true;
    default:
      return false;
  }
}

function automationView(
  actor: Extract<PostActor, { type: 'API_KEY' | 'OAUTH_CLIENT' }>
): ActorView {
  if (actor.type === 'API_KEY') {
    return actor.apiKeyId
      ? { type: 'API_KEY', apiKeyId: actor.apiKeyId }
      : { type: 'API_KEY' };
  }
  const view: ActorView = { type: 'OAUTH_CLIENT' };
  if (actor.oauthClientId) view.oauthClientId = actor.oauthClientId;
  if (actor.userId) view.userId = actor.userId;
  return view;
}

function roleSatisfies(
  role: 'USER' | 'ADMIN' | 'SUPERADMIN',
  minRole: StageDef['minRole']
): boolean {
  if (role === 'SUPERADMIN') return true;
  return role === 'ADMIN' && minRole === 'ADMIN';
}

export function canDecideStage(
  stage: StageDef,
  rules: FlowRules,
  decider: Decider,
  origin: Origin
): StageVerdict {
  if (decider.kind === 'guest') {
    return stage.allowGuest
      ? { ok: true }
      : { ok: false, reason: 'guest_not_allowed' };
  }

  if (decider.kind === 'automation') {
    if (!stage.allowAutomation) {
      return { ok: false, reason: 'automation_not_allowed' };
    }
    const view = automationView(decider.actor);
    if (
      sameActor(view, origin.createdBy) ||
      sameActor(view, origin.requestedBy)
    ) {
      return { ok: false, reason: 'self_approval' };
    }
    if (
      rules.requireDistinctApprovers &&
      origin.earlierDeciders.some((e) => sameActor(view, e))
    ) {
      return { ok: false, reason: 'not_distinct' };
    }
    return { ok: true };
  }

  if (decider.disabled) return { ok: false, reason: 'disabled' };
  if (!roleSatisfies(decider.role, stage.minRole)) {
    return { ok: false, reason: 'role' };
  }
  if (
    decider.role !== 'SUPERADMIN' &&
    stage.approverUserIds.length > 0 &&
    !stage.approverUserIds.includes(decider.userId)
  ) {
    return { ok: false, reason: 'not_listed' };
  }
  if (
    rules.preventSelfApproval &&
    (origin.createdBy?.userId === decider.userId ||
      origin.requestedBy?.userId === decider.userId)
  ) {
    return { ok: false, reason: 'self_approval' };
  }
  if (
    rules.requireDistinctApprovers &&
    origin.earlierDeciders.some(
      (e) => e.type === 'USER' && e.userId === decider.userId
    )
  ) {
    return { ok: false, reason: 'not_distinct' };
  }
  return { ok: true };
}

/** Humans who could decide the stage, for notifications. */
export function eligibleMemberIds(
  stage: StageDef,
  members: Array<{ userId: string; role: string; disabled?: boolean }>
): string[] {
  return members
    .filter((m) => {
      if (m.disabled) return false;
      if (m.role === 'SUPERADMIN') return true;
      if (m.role !== 'ADMIN' || stage.minRole !== 'ADMIN') return false;
      return (
        stage.approverUserIds.length === 0 ||
        stage.approverUserIds.includes(m.userId)
      );
    })
    .map((m) => m.userId);
}

export function nextStage(
  current: number,
  total: number
): { final: boolean; next: number } {
  return current >= total
    ? { final: true, next: current }
    : { final: false, next: current + 1 };
}
