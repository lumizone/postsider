import {
  canSubmit,
  errorKind,
  intentFromQuery,
  shouldRetryAfterRefresh,
  stageLabel,
} from './approver-link-model';

describe('errorKind', () => {
  it.each([
    [404, { error: 'link_invalid' }, 'invalid'],
    [404, null, 'invalid'],
    [400, { error: 'invalid_request' }, 'invalid'],
    [403, { error: 'link_not_allowed' }, 'not_allowed'],
    [403, { error: 'self_approval_blocked' }, 'self'],
    [403, null, 'not_allowed'],
    [409, { error: 'approval_already_resolved', status: 'APPROVED' }, 'resolved'],
    [409, { error: 'approval_stage_invalid' }, 'resolved'],
    [429, undefined, 'rate_limited'],
    [0, undefined, 'network'],
    [500, { error: 'x' }, 'network'],
    [502, 'Bad gateway', 'network'],
  ])('maps %s %j to %s', (status, body, kind) => {
    expect(errorKind(status as number, body)).toBe(kind);
  });

  it('does not trust body shapes it does not know', () => {
    expect(errorKind(403, 'self_approval_blocked')).toBe('not_allowed');
    expect(errorKind(403, { error: { x: 1 } })).toBe('not_allowed');
  });
});

describe('intentFromQuery', () => {
  it.each([
    ['?intent=approve', 'approve'],
    ['intent=reject', 'reject'],
    ['?a=1&intent=approve&b=2', 'approve'],
    ['?intent=APPROVE', null],
    ['?intent=approve%20', null],
    ['?intent=delete', null],
    ['?intent=', null],
    ['', null],
    ['?%E0%A4%A', null],
  ])('parses %j', (search, expected) => {
    expect(intentFromQuery(search)).toBe(expected);
  });

  it('ignores non strings', () => {
    expect(intentFromQuery(undefined as unknown as string)).toBeNull();
  });
});

describe('canSubmit', () => {
  const base = { ready: true, submitting: false, selfApprovalBlocked: false, done: false };
  it('allows a ready idle form', () => expect(canSubmit(base)).toBe(true));
  it('blocks while not ready', () => expect(canSubmit({ ...base, ready: false })).toBe(false));
  it('blocks while submitting', () => expect(canSubmit({ ...base, submitting: true })).toBe(false));
  it('blocks self approval', () =>
    expect(canSubmit({ ...base, selfApprovalBlocked: true })).toBe(false));
  it('blocks after a decision', () => expect(canSubmit({ ...base, done: true })).toBe(false));
});

describe('shouldRetryAfterRefresh', () => {
  it('retries once on invalid when not refreshed yet', () => {
    expect(shouldRetryAfterRefresh('invalid', false)).toBe(true);
  });
  it('never retries twice', () => {
    expect(shouldRetryAfterRefresh('invalid', true)).toBe(false);
  });
  it('does not retry other errors', () => {
    for (const k of ['not_allowed', 'self', 'resolved', 'rate_limited', 'network'] as const) {
      expect(shouldRetryAfterRefresh(k, false)).toBe(false);
    }
  });
});

describe('stageLabel', () => {
  const t = (key: string, vars?: Record<string, string | number>) =>
    `${key}|${vars?.position}|${vars?.total}|${vars?.name}`;
  it('passes position, total and name', () => {
    expect(stageLabel({ position: 2, total: 3, name: 'Legal' }, t)).toBe(
      'approverLink.stage|2|3|Legal',
    );
  });
  it('falls back to a plain number for a missing name', () => {
    expect(stageLabel({ position: 1, total: 1, name: '' }, t)).toBe(
      'approverLink.stage|1|1|1',
    );
  });
  it('clamps nonsense numbers', () => {
    expect(stageLabel({ position: 0, total: 0, name: 'A' }, t)).toBe(
      'approverLink.stage|1|1|A',
    );
  });
});
