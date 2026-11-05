// Pure helpers for the public approver link page (/approve/<token>).
// No React, no network, no token handling.

export type ApproverErrorKind =
  | 'invalid'
  | 'not_allowed'
  | 'self'
  | 'resolved'
  | 'rate_limited'
  | 'network';

export type Intent = 'approve' | 'reject';

function errorCode(body: unknown): string | null {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const code = (body as Record<string, unknown>).error;
    if (typeof code === 'string') return code;
  }
  return null;
}

/**
 * Maps an API failure to one UI state. Every dead link (unknown, used,
 * expired, revoked, bad challenge) arrives as the same 404 and is shown with
 * the same neutral message.
 */
export function errorKind(status: number, body: unknown): ApproverErrorKind {
  if (!Number.isFinite(status) || status <= 0 || status >= 500) return 'network';
  if (status === 429) return 'rate_limited';
  if (status === 409) return 'resolved';
  if (status === 403) {
    return errorCode(body) === 'self_approval_blocked' ? 'self' : 'not_allowed';
  }
  return 'invalid';
}

/** Reads `?intent=approve|reject`. Anything else is null. */
export function intentFromQuery(search: string): Intent | null {
  if (typeof search !== 'string' || !search) return null;
  try {
    const value = new URLSearchParams(search).get('intent');
    return value === 'approve' || value === 'reject' ? value : null;
  } catch {
    return null;
  }
}

export interface SubmitState {
  ready: boolean;
  submitting: boolean;
  selfApprovalBlocked: boolean;
  done: boolean;
}

/** Reject is allowed with or without a note, so the note is not an input here. */
export function canSubmit(state: SubmitState): boolean {
  return state.ready && !state.submitting && !state.selfApprovalBlocked && !state.done;
}

/**
 * A challenge older than 15 minutes fails as link_invalid. After an earlier
 * successful GET the page re-fetches once and retries; never more than once.
 */
export function shouldRetryAfterRefresh(kind: ApproverErrorKind, alreadyRefreshed: boolean): boolean {
  return kind === 'invalid' && !alreadyRefreshed;
}

type Translate = (key: any, vars?: Record<string, string | number>) => string;

export function stageLabel(
  stage: { position: number; total: number; name: string },
  t: Translate,
): string {
  const position = Math.max(1, Math.floor(Number(stage.position) || 1));
  const total = Math.max(position, Math.floor(Number(stage.total) || 1));
  const name = stage.name && stage.name.trim() ? stage.name : String(position);
  return t('approverLink.stage', { position, total, name });
}
