import {
  STAGE_REASON_KEYS,
  canDecideStageClient,
  stageProgressLabel,
  stageSegments,
  stagesAfterRejection,
  type StageInfo,
} from './approval-stage-model';

const admin = { userId: 'me', role: 'ADMIN' };
const superadmin = { userId: 'me', role: 'SUPERADMIN' };
const plainUser = { userId: 'me', role: 'USER' };
const stage = (over: Partial<StageInfo> = {}): StageInfo => ({ position: 1, total: 2, name: 'Legal', ...over });

describe('canDecideStageClient', () => {
  it('lets an admin decide the implicit stage (no stage info)', () => {
    expect(canDecideStageClient(null, admin, {})).toEqual({ allowed: true });
    expect(canDecideStageClient(undefined, admin, undefined)).toEqual({ allowed: true });
  });

  it('never lets the USER role decide', () => {
    expect(canDecideStageClient(null, plainUser, {})).toEqual({ allowed: false, reasonKey: 'approval.stageReasonRole' });
    expect(canDecideStageClient(stage({ minRole: 'ADMIN' }), plainUser, {}).allowed).toBe(false);
  });

  it('refuses a missing or unknown role', () => {
    expect(canDecideStageClient(null, { userId: 'me', role: undefined }, {}).allowed).toBe(false);
    expect(canDecideStageClient(null, { userId: 'me', role: 'OWNER' }, {}).allowed).toBe(false);
    expect(canDecideStageClient(null, null, {}).allowed).toBe(false);
  });

  it('minRole SUPERADMIN needs a superadmin', () => {
    const s = stage({ minRole: 'SUPERADMIN' });
    expect(canDecideStageClient(s, admin, {})).toEqual({ allowed: false, reasonKey: 'approval.stageReasonSuperadmin' });
    expect(canDecideStageClient(s, superadmin, {})).toEqual({ allowed: true });
  });

  it('minRole ADMIN accepts admin and superadmin', () => {
    const s = stage({ minRole: 'ADMIN' });
    expect(canDecideStageClient(s, admin, {}).allowed).toBe(true);
    expect(canDecideStageClient(s, superadmin, {}).allowed).toBe(true);
  });

  it('a listed stage excludes an unlisted admin but not a listed one', () => {
    const s = stage({ approverUserIds: ['other'] });
    expect(canDecideStageClient(s, admin, {})).toEqual({ allowed: false, reasonKey: 'approval.stageReasonNotListed' });
    expect(canDecideStageClient(stage({ approverUserIds: ['me', 'other'] }), admin, {}).allowed).toBe(true);
  });

  it('a superadmin bypasses the approver list', () => {
    expect(canDecideStageClient(stage({ approverUserIds: ['other'] }), superadmin, {}).allowed).toBe(true);
  });

  it('an empty approver list means anyone with the role', () => {
    expect(canDecideStageClient(stage({ approverUserIds: [] }), admin, {}).allowed).toBe(true);
  });

  it('blocks the creator or requester only when the flow forbids it', () => {
    const forbid = { preventSelfApproval: true, creatorUserId: 'me' };
    expect(canDecideStageClient(stage(), admin, forbid)).toEqual({ allowed: false, reasonKey: 'approval.stageReasonSelf' });
    expect(canDecideStageClient(stage(), admin, { preventSelfApproval: true, requesterUserId: 'me' }).allowed).toBe(false);
    expect(canDecideStageClient(stage(), admin, { preventSelfApproval: false, creatorUserId: 'me' }).allowed).toBe(true);
    expect(canDecideStageClient(stage(), admin, { creatorUserId: 'me' }).allowed).toBe(true);
    expect(canDecideStageClient(stage(), admin, { preventSelfApproval: true, creatorUserId: 'someone' }).allowed).toBe(true);
  });

  it('self approval is also blocked for a superadmin', () => {
    expect(canDecideStageClient(stage(), superadmin, { preventSelfApproval: true, creatorUserId: 'me' }).allowed).toBe(false);
  });

  it('blocks a second stage for the same person when distinct approvers are required', () => {
    const info = { requireDistinctApprovers: true, earlierDeciderUserIds: ['me'] };
    expect(canDecideStageClient(stage({ position: 2 }), admin, info)).toEqual({ allowed: false, reasonKey: 'approval.stageReasonDistinct' });
    expect(canDecideStageClient(stage({ position: 2 }), admin, { earlierDeciderUserIds: ['me'] }).allowed).toBe(true);
    expect(canDecideStageClient(stage({ position: 2 }), admin, { requireDistinctApprovers: true, earlierDeciderUserIds: ['x'] }).allowed).toBe(true);
  });

  it('the role is checked before the other reasons', () => {
    const r = canDecideStageClient(stage({ approverUserIds: ['x'] }), plainUser, { preventSelfApproval: true, creatorUserId: 'me' });
    expect(r.reasonKey).toBe('approval.stageReasonRole');
  });

  it('only returns reason keys that exist in the i18n list', () => {
    const cases = [
      canDecideStageClient(null, plainUser, {}),
      canDecideStageClient(stage({ minRole: 'SUPERADMIN' }), admin, {}),
      canDecideStageClient(stage({ approverUserIds: ['x'] }), admin, {}),
      canDecideStageClient(stage(), admin, { preventSelfApproval: true, creatorUserId: 'me' }),
      canDecideStageClient(stage(), admin, { requireDistinctApprovers: true, earlierDeciderUserIds: ['me'] }),
    ];
    for (const c of cases) {
      expect(c.allowed).toBe(false);
      expect(STAGE_REASON_KEYS).toContain(c.reasonKey);
    }
  });
});

describe('stageProgressLabel', () => {
  const t = (key: string, vars?: Record<string, string | number>) =>
    `${key}|${Object.entries(vars ?? {}).map(([k, v]) => `${k}=${v}`).join(',')}`;

  it('formats stage 2 of 3 with the name', () => {
    expect(stageProgressLabel({ position: 2, total: 3, name: 'Owner' }, t)).toBe('approval.stageOf|position=2,total=3,name=Owner');
  });

  it('is empty for a single implicit stage and for missing info', () => {
    expect(stageProgressLabel({ position: 1, total: 1, name: 'Approval' }, t)).toBe('');
    expect(stageProgressLabel(null, t)).toBe('');
    expect(stageProgressLabel(undefined, t)).toBe('');
  });

  it('keeps the stage name as plain text (no markup handling)', () => {
    expect(stageProgressLabel({ position: 1, total: 2, name: '<b>x</b>' }, t)).toContain('name=<b>x</b>');
  });
});

describe('stagesAfterRejection', () => {
  const mk = (statuses: string[]) => statuses.map((status, i) => ({ position: i + 1, name: `S${i + 1}`, status }));

  it('marks pending stages after a rejected one as not reached', () => {
    expect(stagesAfterRejection(mk(['APPROVED', 'REJECTED', 'PENDING', 'PENDING'])).map((s) => s.status)).toEqual([
      'APPROVED',
      'REJECTED',
      'NOT_REACHED',
      'NOT_REACHED',
    ]);
  });

  it('leaves a list without rejection untouched', () => {
    expect(stagesAfterRejection(mk(['APPROVED', 'PENDING'])).map((s) => s.status)).toEqual(['APPROVED', 'PENDING']);
  });

  it('keeps the server NOT_REACHED value and does not mutate', () => {
    const input = mk(['REJECTED', 'NOT_REACHED', 'PENDING']);
    const out = stagesAfterRejection(input);
    expect(out.map((s) => s.status)).toEqual(['REJECTED', 'NOT_REACHED', 'NOT_REACHED']);
    expect(input[2].status).toBe('PENDING');
  });

  it('does not touch stages before the rejection even when pending', () => {
    expect(stagesAfterRejection(mk(['PENDING', 'REJECTED'])).map((s) => s.status)).toEqual(['PENDING', 'REJECTED']);
  });

  it('handles an empty or missing list', () => {
    expect(stagesAfterRejection([])).toEqual([]);
    expect(stagesAfterRejection(undefined)).toEqual([]);
  });
});

describe('stageSegments', () => {
  it('maps statuses to shapes and puts the current stage first in line', () => {
    const segs = stageSegments(
      [
        { position: 1, name: 'A', status: 'APPROVED' },
        { position: 2, name: 'B', status: 'PENDING' },
        { position: 3, name: 'C', status: 'PENDING' },
      ],
      2
    );
    expect(segs.map((s) => s.shape)).toEqual(['filled', 'half', 'outlined']);
  });

  it('uses a cross shape for rejected and dashed for not reached', () => {
    const segs = stageSegments(
      [
        { position: 1, name: 'A', status: 'REJECTED' },
        { position: 2, name: 'B', status: 'PENDING' },
      ],
      1
    );
    expect(segs.map((s) => s.shape)).toEqual(['cross', 'dashed']);
  });

  it('is empty for a single stage', () => {
    expect(stageSegments([{ position: 1, name: 'A', status: 'PENDING' }], 1)).toEqual([]);
  });
});
