import {
  IMPLICIT_RULES,
  IMPLICIT_STAGE,
  canDecideStage,
  eligibleMemberIds,
  nextStage,
  sameActor,
  type Decider,
  type FlowRules,
  type Origin,
  type StageDef,
} from './approval-stage.rules';

const stage = (o: Partial<StageDef> = {}): StageDef => ({
  position: 1,
  name: 'S',
  minRole: 'ADMIN',
  approverUserIds: [],
  allowAutomation: false,
  allowGuest: false,
  ...o,
});
const rules = (o: Partial<FlowRules> = {}): FlowRules => ({
  preventSelfApproval: false,
  requireDistinctApprovers: false,
  ...o,
});
const origin = (o: Partial<Origin> = {}): Origin => ({
  createdBy: null,
  requestedBy: null,
  earlierDeciders: [],
  ...o,
});
const member = (userId: string, role: 'USER' | 'ADMIN' | 'SUPERADMIN' = 'ADMIN', disabled?: boolean): Decider => ({
  kind: 'member',
  userId,
  role,
  disabled,
});

describe('implicit defaults', () => {
  it('matches the contract', () => {
    expect(IMPLICIT_STAGE).toEqual({
      position: 1,
      name: 'Approval',
      minRole: 'ADMIN',
      approverUserIds: [],
      allowAutomation: true,
      allowGuest: true,
    });
    expect(IMPLICIT_RULES).toEqual({ preventSelfApproval: false, requireDistinctApprovers: false });
  });
});

describe('canDecideStage: members', () => {
  it('refuses USER role', () => {
    expect(canDecideStage(stage(), rules(), member('u1', 'USER'), origin())).toEqual({ ok: false, reason: 'role' });
  });
  it('refuses a disabled member', () => {
    expect(canDecideStage(stage(), rules(), member('u1', 'ADMIN', true), origin())).toEqual({ ok: false, reason: 'disabled' });
  });
  it('allows ADMIN when the list is empty', () => {
    expect(canDecideStage(stage(), rules(), member('u1'), origin())).toEqual({ ok: true });
  });
  it('refuses an ADMIN not on the list', () => {
    const s = stage({ approverUserIds: ['u2'] });
    expect(canDecideStage(s, rules(), member('u1'), origin())).toEqual({ ok: false, reason: 'not_listed' });
    expect(canDecideStage(s, rules(), member('u2'), origin())).toEqual({ ok: true });
  });
  it('SUPERADMIN satisfies ADMIN and bypasses the list', () => {
    const s = stage({ approverUserIds: ['u2'] });
    expect(canDecideStage(s, rules(), member('root', 'SUPERADMIN'), origin())).toEqual({ ok: true });
  });
  it('minRole SUPERADMIN refuses ADMIN', () => {
    expect(canDecideStage(stage({ minRole: 'SUPERADMIN' }), rules(), member('u1'), origin())).toEqual({ ok: false, reason: 'role' });
    expect(canDecideStage(stage({ minRole: 'SUPERADMIN' }), rules(), member('root', 'SUPERADMIN'), origin())).toEqual({ ok: true });
  });
  it('blocks self approval only when the flag is on', () => {
    const o = origin({ createdBy: { type: 'USER', userId: 'u1' } });
    expect(canDecideStage(stage(), rules(), member('u1'), o)).toEqual({ ok: true });
    expect(canDecideStage(stage(), rules({ preventSelfApproval: true }), member('u1'), o)).toEqual({ ok: false, reason: 'self_approval' });
    expect(canDecideStage(stage(), rules({ preventSelfApproval: true }), member('u2'), o)).toEqual({ ok: true });
  });
  it('self approval also covers requestedBy', () => {
    const o = origin({ requestedBy: { type: 'USER', userId: 'u1' } });
    expect(canDecideStage(stage(), rules({ preventSelfApproval: true }), member('u1'), o)).toEqual({ ok: false, reason: 'self_approval' });
  });
  it('an OAuth actor userId counts as self', () => {
    const o = origin({ createdBy: { type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u1' } as never });
    expect(canDecideStage(stage(), rules({ preventSelfApproval: true }), member('u1'), o)).toEqual({ ok: false, reason: 'self_approval' });
  });
  it('SUPERADMIN is still blocked by self approval', () => {
    const o = origin({ createdBy: { type: 'USER', userId: 'root' } });
    expect(canDecideStage(stage(), rules({ preventSelfApproval: true }), member('root', 'SUPERADMIN'), o)).toEqual({ ok: false, reason: 'self_approval' });
  });
  it('requireDistinctApprovers refuses an earlier decider', () => {
    const o = origin({ earlierDeciders: [{ type: 'USER', userId: 'u1' }] });
    expect(canDecideStage(stage(), rules({ requireDistinctApprovers: true }), member('u1'), o)).toEqual({ ok: false, reason: 'not_distinct' });
    expect(canDecideStage(stage(), rules({ requireDistinctApprovers: true }), member('u2'), o)).toEqual({ ok: true });
    expect(canDecideStage(stage(), rules(), member('u1'), o)).toEqual({ ok: true });
  });
  it('SUPERADMIN is still blocked by distinct approvers', () => {
    const o = origin({ earlierDeciders: [{ type: 'USER', userId: 'root' }] });
    expect(canDecideStage(stage(), rules({ requireDistinctApprovers: true }), member('root', 'SUPERADMIN'), o)).toEqual({ ok: false, reason: 'not_distinct' });
  });
});

describe('canDecideStage: automation', () => {
  const key = (apiKeyId: string | null): Decider => ({ kind: 'automation', actor: { type: 'API_KEY', apiKeyId } });
  it('needs allowAutomation', () => {
    expect(canDecideStage(stage(), rules(), key('k1'), origin())).toEqual({ ok: false, reason: 'automation_not_allowed' });
    expect(canDecideStage(stage({ allowAutomation: true }), rules(), key('k1'), origin())).toEqual({ ok: true });
  });
  it('is refused when it created the post even with allowAutomation', () => {
    const s = stage({ allowAutomation: true });
    const o = origin({ createdBy: { type: 'API_KEY', apiKeyId: 'k1' } });
    expect(canDecideStage(s, rules(), key('k1'), o)).toEqual({ ok: false, reason: 'self_approval' });
    expect(canDecideStage(s, rules(), key('k2'), o)).toEqual({ ok: true });
  });
  it('is refused when it requested the approval', () => {
    const s = stage({ allowAutomation: true });
    const o = origin({ requestedBy: { type: 'API_KEY', apiKeyId: 'k1' } });
    expect(canDecideStage(s, rules(), key('k1'), o)).toEqual({ ok: false, reason: 'self_approval' });
  });
  it('a legacy key equals another legacy key', () => {
    const s = stage({ allowAutomation: true });
    const o = origin({ createdBy: { type: 'API_KEY' } });
    expect(canDecideStage(s, rules(), key(null), o)).toEqual({ ok: false, reason: 'self_approval' });
    expect(canDecideStage(s, rules(), key('k1'), o)).toEqual({ ok: true });
  });
  it('honours requireDistinctApprovers', () => {
    const s = stage({ allowAutomation: true });
    const o = origin({ earlierDeciders: [{ type: 'API_KEY', apiKeyId: 'k1' }] });
    expect(canDecideStage(s, rules({ requireDistinctApprovers: true }), key('k1'), o)).toEqual({ ok: false, reason: 'not_distinct' });
  });
  it('an OAuth client matches by oauthClientId', () => {
    const s = stage({ allowAutomation: true });
    const o = origin({ createdBy: { type: 'OAUTH_CLIENT', oauthClientId: 'c1' } });
    const d: Decider = { kind: 'automation', actor: { type: 'OAUTH_CLIENT', oauthClientId: 'c1' } };
    expect(canDecideStage(s, rules(), d, o)).toEqual({ ok: false, reason: 'self_approval' });
  });
});

describe('canDecideStage: guests', () => {
  it('needs allowGuest', () => {
    expect(canDecideStage(stage(), rules(), { kind: 'guest' }, origin())).toEqual({ ok: false, reason: 'guest_not_allowed' });
    expect(canDecideStage(stage({ allowGuest: true }), rules(), { kind: 'guest' }, origin())).toEqual({ ok: true });
  });
  it('skips self and distinct checks', () => {
    const o = origin({
      createdBy: { type: 'USER', userId: 'u1' },
      earlierDeciders: [{ type: 'USER', userId: 'u1' }],
    });
    const r = rules({ preventSelfApproval: true, requireDistinctApprovers: true });
    expect(canDecideStage(stage({ allowGuest: true }), r, { kind: 'guest' }, o)).toEqual({ ok: true });
  });
});

describe('sameActor', () => {
  it('null equals nothing', () => {
    expect(sameActor(null, null)).toBe(false);
    expect(sameActor(undefined, { type: 'SYSTEM' })).toBe(false);
    expect(sameActor({ type: 'SYSTEM' }, null)).toBe(false);
  });
  it('compares type and matching id', () => {
    expect(sameActor({ type: 'USER', userId: 'a' }, { type: 'USER', userId: 'a' })).toBe(true);
    expect(sameActor({ type: 'USER', userId: 'a' }, { type: 'USER', userId: 'b' })).toBe(false);
    expect(sameActor({ type: 'USER', userId: 'a' }, { type: 'API_KEY', apiKeyId: 'a' })).toBe(false);
    expect(sameActor({ type: 'API_KEY', apiKeyId: 'a' }, { type: 'API_KEY', apiKeyId: 'a' })).toBe(true);
    expect(sameActor({ type: 'API_KEY', apiKeyId: 'a' }, { type: 'API_KEY' })).toBe(false);
    expect(sameActor({ type: 'API_KEY' }, { type: 'API_KEY' })).toBe(true);
  });
  it('ignores the userId of an OAuth actor when comparing clients', () => {
    expect(
      sameActor(
        { type: 'OAUTH_CLIENT', oauthClientId: 'c', userId: 'a' },
        { type: 'OAUTH_CLIENT', oauthClientId: 'c', userId: 'b' }
      )
    ).toBe(true);
    expect(sameActor({ type: 'OAUTH_CLIENT', oauthClientId: 'c' }, { type: 'OAUTH_CLIENT', oauthClientId: 'd' })).toBe(false);
  });
  it('a USER view without userId equals nothing', () => {
    expect(sameActor({ type: 'USER' }, { type: 'USER' })).toBe(false);
  });
});

describe('eligibleMemberIds', () => {
  const members = [
    { userId: 'a', role: 'ADMIN' },
    { userId: 'b', role: 'USER' },
    { userId: 'c', role: 'ADMIN', disabled: true },
    { userId: 'd', role: 'ADMIN' },
    { userId: 'root', role: 'SUPERADMIN' },
  ];
  it('drops USER and disabled', () => {
    expect(eligibleMemberIds(stage(), members)).toEqual(['a', 'd', 'root']);
  });
  it('applies the list but SUPERADMIN ignores it', () => {
    expect(eligibleMemberIds(stage({ approverUserIds: ['d'] }), members)).toEqual(['d', 'root']);
  });
  it('respects minRole SUPERADMIN', () => {
    expect(eligibleMemberIds(stage({ minRole: 'SUPERADMIN' }), members)).toEqual(['root']);
  });
});

describe('nextStage', () => {
  it('is final on the last stage', () => {
    expect(nextStage(2, 2)).toEqual({ final: true, next: 2 });
    expect(nextStage(1, 1)).toEqual({ final: true, next: 1 });
  });
  it('advances otherwise', () => {
    expect(nextStage(1, 3)).toEqual({ final: false, next: 2 });
  });
});
