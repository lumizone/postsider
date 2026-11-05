import {
  FLOW_LIMITS,
  FLOW_VALIDATION_KEYS,
  emptyFlow,
  flowToDraft,
  moveStage,
  toRequestBody,
  validateFlow,
  type FlowDraft,
  type StageDraft,
} from './approval-flows-model';

const stage = (over: Partial<StageDraft> = {}): StageDraft => ({
  name: 'Review',
  minRole: 'ADMIN',
  approverUserIds: [],
  allowAutomation: false,
  allowGuest: false,
  ...over,
});

const flow = (over: Partial<FlowDraft> = {}): FlowDraft => ({
  ...emptyFlow(),
  name: 'Client sign-off',
  ...over,
});

const fields = (d: FlowDraft) => validateFlow(d).map((e) => e.field);

describe('emptyFlow', () => {
  it('starts with one stage and the safe flags on', () => {
    const f = emptyFlow();
    expect(f.name).toBe('');
    expect(f.isDefault).toBe(false);
    expect(f.preventSelfApproval).toBe(true);
    expect(f.requireDistinctApprovers).toBe(true);
    expect(f.stages).toHaveLength(1);
    expect(f.stages[0].minRole).toBe('ADMIN');
    expect(f.stages[0].allowAutomation).toBe(false);
    expect(f.stages[0].allowGuest).toBe(false);
  });

  it('returns a fresh object every time', () => {
    expect(emptyFlow()).not.toBe(emptyFlow());
    expect(emptyFlow().stages).not.toBe(emptyFlow().stages);
  });
});

describe('validateFlow: flow name', () => {
  it('accepts a valid flow', () => {
    expect(validateFlow(flow({ stages: [stage()] }))).toEqual([]);
  });

  it('rejects an empty or blank name', () => {
    expect(fields(flow({ name: '' }))).toContain('name');
    expect(fields(flow({ name: '   ' }))).toContain('name');
  });

  it('accepts 120 characters and rejects 121', () => {
    expect(fields(flow({ name: 'a'.repeat(120) }))).not.toContain('name');
    const errs = validateFlow(flow({ name: 'a'.repeat(121) }));
    expect(errs.find((e) => e.field === 'name')?.key).toBe('approvalFlows.validation.nameTooLong');
  });

  it('measures the trimmed name', () => {
    expect(fields(flow({ name: ' ' + 'a'.repeat(120) + ' ' }))).not.toContain('name');
  });
});

describe('validateFlow: stage count', () => {
  const n = (count: number) => Array.from({ length: count }, (_, i) => stage({ name: `S${i}` }));

  it('rejects 0 stages', () => {
    const errs = validateFlow(flow({ stages: [] }));
    expect(errs.find((e) => e.field === 'stages')?.key).toBe('approvalFlows.validation.stagesMin');
  });

  it('accepts 1 and 5 stages', () => {
    expect(fields(flow({ stages: n(1) }))).not.toContain('stages');
    expect(fields(flow({ stages: n(5) }))).not.toContain('stages');
  });

  it('rejects 6 stages', () => {
    const errs = validateFlow(flow({ stages: n(6) }));
    expect(errs.find((e) => e.field === 'stages')?.key).toBe('approvalFlows.validation.stagesMax');
  });

  it('exposes the server limits', () => {
    expect(FLOW_LIMITS).toMatchObject({ nameMax: 120, stageNameMax: 80, stagesMin: 1, stagesMax: 5, approversMax: 20 });
  });
});

describe('validateFlow: stages', () => {
  it('rejects an empty stage name and names the stage index in the field', () => {
    const errs = validateFlow(flow({ stages: [stage(), stage({ name: '  ' })] }));
    expect(errs).toEqual([{ field: 'stages.1.name', key: 'approvalFlows.validation.stageNameRequired' }]);
  });

  it('accepts a stage name of 80 characters and rejects 81', () => {
    expect(fields(flow({ stages: [stage({ name: 'a'.repeat(80) })] }))).toEqual([]);
    const errs = validateFlow(flow({ stages: [stage({ name: 'a'.repeat(81) })] }));
    expect(errs).toEqual([{ field: 'stages.0.name', key: 'approvalFlows.validation.stageNameTooLong' }]);
  });

  it('rejects an unknown minimum role', () => {
    const bad = stage({ minRole: 'USER' as unknown as StageDraft['minRole'] });
    expect(fields(flow({ stages: [bad] }))).toEqual(['stages.0.minRole']);
  });

  it('accepts SUPERADMIN as the minimum role', () => {
    expect(fields(flow({ stages: [stage({ minRole: 'SUPERADMIN' })] }))).toEqual([]);
  });

  it('accepts 20 distinct approvers and rejects 21', () => {
    const ids = (c: number) => Array.from({ length: c }, (_, i) => `u${i}`);
    expect(fields(flow({ stages: [stage({ approverUserIds: ids(20) })] }))).toEqual([]);
    const errs = validateFlow(flow({ stages: [stage({ approverUserIds: ids(21) })] }));
    expect(errs).toEqual([{ field: 'stages.0.approverUserIds', key: 'approvalFlows.validation.approversTooMany' }]);
  });

  it('rejects duplicate approvers', () => {
    const errs = validateFlow(flow({ stages: [stage({ approverUserIds: ['a', 'b', 'a'] })] }));
    expect(errs).toEqual([{ field: 'stages.0.approverUserIds', key: 'approvalFlows.validation.approversDuplicate' }]);
  });

  it('reports the first problem of one field only once', () => {
    const many = Array.from({ length: 25 }, () => 'same');
    const errs = validateFlow(flow({ stages: [stage({ approverUserIds: many })] }));
    expect(errs.filter((e) => e.field === 'stages.0.approverUserIds')).toHaveLength(1);
  });

  it('only returns keys that are listed for the i18n parity check', () => {
    const errs = validateFlow({
      ...emptyFlow(),
      name: '',
      stages: [stage({ name: '' }), stage({ name: 'a'.repeat(81) }), stage({ approverUserIds: ['x', 'x'] })],
    });
    for (const e of errs) expect(FLOW_VALIDATION_KEYS).toContain(e.key);
  });
});

describe('moveStage', () => {
  const list = [stage({ name: 'A' }), stage({ name: 'B' }), stage({ name: 'C' })];
  const names = (l: StageDraft[]) => l.map((s) => s.name).join('');

  it('moves a stage down and up', () => {
    expect(names(moveStage(list, 0, 1))).toBe('BAC');
    expect(names(moveStage(list, 2, 1))).toBe('ACB');
  });

  it('does not mutate the input', () => {
    moveStage(list, 0, 2);
    expect(names(list)).toBe('ABC');
  });

  it('ignores out of range moves and returns a copy', () => {
    for (const [from, to] of [[0, -1], [2, 3], [-1, 0], [3, 0], [1, 1]] as const) {
      const out = moveStage(list, from, to);
      expect(names(out)).toBe('ABC');
      expect(out).not.toBe(list);
    }
  });

  it('ignores non integer indexes', () => {
    expect(names(moveStage(list, 0.5, 1))).toBe('ABC');
    expect(names(moveStage(list, NaN, 1))).toBe('ABC');
  });
});

describe('toRequestBody', () => {
  it('trims names and sends exactly the server fields, in order', () => {
    const body = toRequestBody(
      flow({
        name: '  Client sign-off ',
        isDefault: true,
        stages: [
          stage({ name: ' Legal ', minRole: 'SUPERADMIN', approverUserIds: ['u1', 'u2'], allowAutomation: true }),
          stage({ name: 'Owner', allowGuest: true }),
        ],
      })
    );
    expect(body).toEqual({
      name: 'Client sign-off',
      isDefault: true,
      preventSelfApproval: true,
      requireDistinctApprovers: true,
      stages: [
        { name: 'Legal', minRole: 'SUPERADMIN', approverUserIds: ['u1', 'u2'], allowAutomation: true, allowGuest: false },
        { name: 'Owner', minRole: 'ADMIN', approverUserIds: [], allowAutomation: false, allowGuest: true },
      ],
    });
  });

  it('never carries ids or positions', () => {
    const body = toRequestBody(flowToDraft({
      id: 'f1',
      name: 'X',
      isDefault: false,
      preventSelfApproval: false,
      requireDistinctApprovers: false,
      createdAt: 'x',
      updatedAt: 'y',
      stages: [{ position: 1, name: 'S', minRole: 'ADMIN', approverUserIds: ['a'], allowAutomation: false, allowGuest: false }],
    }));
    expect(JSON.stringify(body)).not.toMatch(/"id"|position|createdAt/);
    expect(body.preventSelfApproval).toBe(false);
  });

  it('copies approver arrays', () => {
    const draft = flow({ stages: [stage({ approverUserIds: ['a'] })] });
    const body = toRequestBody(draft);
    body.stages[0].approverUserIds!.push('z');
    expect(draft.stages[0].approverUserIds).toEqual(['a']);
  });
});

describe('flowToDraft', () => {
  it('orders stages by position and keeps the raw name for the edit input', () => {
    const d = flowToDraft({
      id: 'f',
      name: 'Raw <b>name</b>',
      isDefault: true,
      preventSelfApproval: true,
      requireDistinctApprovers: false,
      createdAt: '',
      updatedAt: '',
      stages: [
        { position: 2, name: 'Second', minRole: 'ADMIN', approverUserIds: [], allowAutomation: false, allowGuest: false },
        { position: 1, name: 'First', minRole: 'SUPERADMIN', approverUserIds: ['u'], allowAutomation: true, allowGuest: false },
      ],
    });
    expect(d.name).toBe('Raw <b>name</b>');
    expect(d.stages.map((s) => s.name)).toEqual(['First', 'Second']);
    expect(d.requireDistinctApprovers).toBe(false);
  });
});
