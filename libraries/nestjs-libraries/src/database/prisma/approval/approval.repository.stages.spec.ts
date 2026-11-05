import { ApprovalRepository } from './approval.repository';
import { hashGuestToken } from './guest-token';

function make() {
  const stage = { updateMany: jest.fn().mockResolvedValue({ count: 1 }), deleteMany: jest.fn(), createMany: jest.fn() };
  const approval = {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn(),
    findFirst: jest.fn(),
  };
  const tokens = { deleteMany: jest.fn() };
  const flow = { findFirst: jest.fn() };
  const client = { postApproval: approval, postApprovalStage: stage, approvalActionToken: tokens, approvalFlow: flow };
  const tx = { model: { $transaction: jest.fn(async (fn: any) => fn(client)) } };
  const repo = new ApprovalRepository({ model: client } as any, {} as any, tx as any);
  return { repo, stage, approval, tokens, flow, tx };
}

const base = {
  orgId: 'org-1',
  approvalId: 'a1',
  position: 1,
  hasStageRow: true,
  decision: 'APPROVED' as const,
  final: false,
  note: null,
  via: 'DASHBOARD',
  actor: { type: 'USER', userId: 'u1' } as const,
};

describe('ApprovalRepository.decideStageTx', () => {
  it('claims the stage row first (PENDING only, same organization) and then advances the approval', async () => {
    const { repo, stage, approval, tx } = make();
    await expect(repo.decideStageTx(base)).resolves.toBe(true);
    expect(tx.model.$transaction).toHaveBeenCalledTimes(1);
    expect(stage.updateMany.mock.calls[0][0]).toMatchObject({
      where: { approvalId: 'a1', position: 1, status: 'PENDING', approval: { organizationId: 'org-1' } },
      data: { status: 'APPROVED', decidedByType: 'USER', decidedByUserId: 'u1', decidedVia: 'DASHBOARD' },
    });
    expect(approval.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'a1', organizationId: 'org-1', status: 'PENDING', currentStage: 1 },
      data: { currentStage: 2 },
    });
  });

  it('a final approval writes the decider, the via and resolvedAt on the approval', async () => {
    const { repo, approval } = make();
    await repo.decideStageTx({ ...base, final: true, actor: { type: 'API_KEY', apiKeyId: 'k1' }, via: 'API' });
    const { where, data } = approval.updateMany.mock.calls[0][0];
    expect(where).toMatchObject({ status: 'PENDING', currentStage: 1 });
    expect(data).toMatchObject({
      status: 'APPROVED',
      approverId: null,
      decidedByType: 'API_KEY',
      decidedByApiKeyId: 'k1',
      decidedByOAuthClientId: null,
      decidedVia: 'API',
      resolvedAt: expect.any(Date),
    });
    expect(data).not.toHaveProperty('currentStage');
  });

  it('a member decision stores approverId', async () => {
    const { repo, approval } = make();
    await repo.decideStageTx({ ...base, final: true, decision: 'REJECTED', note: 'no' });
    expect(approval.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'REJECTED',
      approverId: 'u1',
      decidedByType: 'USER',
      note: 'no',
    });
  });

  it('the implicit stage has no stage row to claim; the approval row is the lock', async () => {
    const { repo, stage, approval } = make();
    await expect(repo.decideStageTx({ ...base, hasStageRow: false, final: true })).resolves.toBe(true);
    expect(stage.updateMany).not.toHaveBeenCalled();
    expect(approval.updateMany).toHaveBeenCalledTimes(1);
  });

  it('a stage row that is no longer PENDING loses the race and never touches the approval', async () => {
    const { repo, stage, approval } = make();
    stage.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.decideStageTx(base)).resolves.toBe(false);
    expect(approval.updateMany).not.toHaveBeenCalled();
  });

  it('an approval that moved on loses the race (the transaction rolls back by throwing)', async () => {
    const { repo, approval, tx } = make();
    approval.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.decideStageTx(base)).resolves.toBe(false);
    expect(tx.model.$transaction).toHaveBeenCalledTimes(1);
  });

  it('other database errors propagate', async () => {
    const { repo, stage } = make();
    const boom = new Error('db down');
    stage.updateMany.mockRejectedValue(boom);
    await expect(repo.decideStageTx(base)).rejects.toBe(boom);
  });

  it('a guest decision matches the token hash and expiry and consumes the token', async () => {
    const { repo, stage, approval } = make();
    await repo.decideStageTx({
      ...base,
      final: true,
      actor: null,
      via: 'GUEST',
      guest: { name: 'Ann', email: 'a@x.test' },
      guestToken: 'plain-token',
    });
    const { where, data } = approval.updateMany.mock.calls[0][0];
    expect(where.guestTokenHash).toBe(hashGuestToken('plain-token'));
    expect(where.guestTokenExpiresAt).toEqual({ gt: expect.any(Date) });
    expect(JSON.stringify(where)).not.toContain('plain-token');
    expect(data).toMatchObject({
      guestName: 'Ann',
      guestEmail: 'a@x.test',
      decidedByType: null,
      approverId: null,
      guestToken: null,
      guestTokenHash: null,
      guestTokenExpiresAt: null,
    });
    expect(stage.updateMany.mock.calls[0][0].data).toMatchObject({ decidedByType: null, decidedVia: 'GUEST' });
  });

  it('a non final guest decision still consumes the token', async () => {
    const { repo, approval } = make();
    await repo.decideStageTx({ ...base, actor: null, via: 'GUEST', guestToken: 't' });
    expect(approval.updateMany.mock.calls[0][0].data).toEqual({
      currentStage: 2,
      guestToken: null,
      guestTokenHash: null,
      guestTokenExpiresAt: null,
    });
  });

  it('truncates the stage note to 500 characters', async () => {
    const { repo, stage } = make();
    await repo.decideStageTx({ ...base, note: 'x'.repeat(600) });
    expect(stage.updateMany.mock.calls[0][0].data.note).toHaveLength(500);
  });

  it('refuses to run without a transaction provider', async () => {
    const repo = new ApprovalRepository({ model: {} } as any, {} as any);
    await expect(repo.decideStageTx(base)).rejects.toThrow('PrismaTransaction');
  });
});

describe('ApprovalRepository.revertFinal', () => {
  it('restores the approval and then the last stage row', async () => {
    const { repo, stage, approval } = make();
    await expect(repo.revertFinal('org-1', 'a1', 2, true)).resolves.toBe(1);
    expect(approval.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'a1', organizationId: 'org-1', status: 'APPROVED' },
      data: { status: 'PENDING', approverId: null, decidedByType: null, decidedVia: null, resolvedAt: null },
    });
    expect(stage.updateMany.mock.calls[0][0]).toMatchObject({
      where: { approvalId: 'a1', position: 2, status: 'APPROVED', approval: { organizationId: 'org-1' } },
      data: { status: 'PENDING', decidedByType: null, decidedByUserId: null, decidedVia: null, decidedAt: null, note: null },
    });
  });

  it('puts a guest link back through its hash', async () => {
    const { repo, approval } = make();
    const expiresAt = new Date('2026-11-12T00:00:00Z');
    await repo.revertFinal('org-1', 'a1', 1, false, { tokenHash: 'h', expiresAt });
    expect(approval.updateMany.mock.calls[0][0].data).toMatchObject({
      guestToken: null,
      guestTokenHash: 'h',
      guestTokenExpiresAt: expiresAt,
    });
  });

  it('leaves the stage row alone when the approval was not APPROVED, and for the implicit stage', async () => {
    const a = make();
    a.approval.updateMany.mockResolvedValue({ count: 0 });
    await expect(a.repo.revertFinal('org-1', 'a1', 1, true)).resolves.toBe(0);
    expect(a.stage.updateMany).not.toHaveBeenCalled();
    const b = make();
    await b.repo.revertFinal('org-1', 'a1', 1, false);
    expect(b.stage.updateMany).not.toHaveBeenCalled();
  });
});

describe('ApprovalRepository flow snapshot at request time', () => {
  const actor = { type: 'USER', userId: 'u1' } as const;
  const snapshot = {
    flowId: 'f1',
    stages: [
      { position: 1, name: 'A', minRole: 'ADMIN' as const, approverUserIds: ['x'], allowAutomation: false, allowGuest: false },
      { position: 2, name: 'B', minRole: 'SUPERADMIN' as const, approverUserIds: [], allowAutomation: true, allowGuest: true },
    ],
  };

  it('a first request creates the approval together with its stage rows', async () => {
    const { repo, approval } = make();
    approval.updateMany.mockResolvedValue({ count: 0 });
    approval.create.mockResolvedValue({ id: 'a1' });
    await repo.openRequest('org-1', 'p1', 'u1', actor, snapshot);
    const data = approval.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ flowId: 'f1', stageCount: 2, currentStage: 1 });
    expect(data.stages.create).toEqual([
      { position: 1, name: 'A', minRole: 'ADMIN', approverUserIds: ['x'], allowAutomation: false, allowGuest: false },
      { position: 2, name: 'B', minRole: 'SUPERADMIN', approverUserIds: [], allowAutomation: true, allowGuest: true },
    ]);
  });

  it('without a snapshot the approval is the implicit single stage', async () => {
    const { repo, approval } = make();
    approval.updateMany.mockResolvedValue({ count: 0 });
    approval.create.mockResolvedValue({ id: 'a1' });
    await repo.openRequest('org-1', 'p1', 'u1', actor);
    const data = approval.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ flowId: null, stageCount: 1, currentStage: 1 });
    expect(data).not.toHaveProperty('stages');
  });

  it('a reopen resets progress, deletes the old stage rows and tokens, then snapshots the new flow', async () => {
    const { repo, approval, stage, tokens } = make();
    approval.updateMany.mockResolvedValue({ count: 1 });
    approval.findFirst.mockResolvedValue({ id: 'a1', status: 'PENDING' });
    const out = await repo.openRequest('org-1', 'p1', 'u1', actor, snapshot);
    expect(out.created).toBe(true);
    expect(approval.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'PENDING',
      flowId: 'f1',
      stageCount: 2,
      currentStage: 1,
      decidedVia: null,
      decidedByApiKeyId: null,
      decidedByOAuthClientId: null,
    });
    expect(stage.deleteMany).toHaveBeenCalledWith({ where: { approvalId: 'a1', approval: { organizationId: 'org-1' } } });
    expect(tokens.deleteMany).toHaveBeenCalledWith({ where: { approvalId: 'a1', organizationId: 'org-1' } });
    expect(stage.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(stage.createMany.mock.calls[0][0].data[0]).toMatchObject({ approvalId: 'a1', position: 1, name: 'A' });
    expect(stage.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(stage.createMany.mock.invocationCallOrder[0]);
  });

  it('a reopen runs entirely inside one transaction and a mid-way failure propagates (rolled back by the db)', async () => {
    const { repo, approval, stage, tx } = make();
    approval.updateMany.mockResolvedValue({ count: 1 });
    approval.findFirst.mockResolvedValue({ id: 'a1' });
    await repo.openRequest('org-1', 'p1', 'u1', actor, snapshot);
    expect(tx.model.$transaction).toHaveBeenCalledTimes(1);
    // the base client (outside the tx) is never used for the reopen writes
    tx.model.$transaction.mockClear();
    stage.createMany.mockRejectedValueOnce(new Error('boom'));
    await expect(repo.openRequest('org-1', 'p1', 'u1', actor, snapshot)).rejects.toThrow('boom');
    expect(tx.model.$transaction).toHaveBeenCalledTimes(1);
  });

  it('a reopen on the implicit stage still drops the old rows but creates none', async () => {
    const { repo, approval, stage } = make();
    approval.updateMany.mockResolvedValue({ count: 1 });
    approval.findFirst.mockResolvedValue({ id: 'a1' });
    await repo.openRequest('org-1', 'p1', 'u1', actor);
    expect(stage.deleteMany).toHaveBeenCalled();
    expect(stage.createMany).not.toHaveBeenCalled();
  });

  it('a repeated request on a live approval writes nothing', async () => {
    const { repo, approval, stage, tokens } = make();
    approval.updateMany.mockResolvedValue({ count: 0 });
    approval.create.mockRejectedValue({ code: 'P2002' });
    approval.findFirst.mockResolvedValue({ id: 'a1', status: 'PENDING' });
    const out = await repo.openRequest('org-1', 'p1', 'u1', actor, snapshot);
    expect(out.created).toBe(false);
    expect(stage.deleteMany).not.toHaveBeenCalled();
    expect(tokens.deleteMany).not.toHaveBeenCalled();
  });
});

describe('ApprovalRepository reads', () => {
  it('getFlowRules is scoped by organization and returns only the two flags', async () => {
    const { repo, flow } = make();
    flow.findFirst.mockResolvedValue({ preventSelfApproval: true, requireDistinctApprovers: false });
    await expect(repo.getFlowRules('org-1', 'f1')).resolves.toEqual({
      preventSelfApproval: true,
      requireDistinctApprovers: false,
    });
    expect(flow.findFirst.mock.calls[0][0].where).toEqual({ id: 'f1', organizationId: 'org-1' });
    flow.findFirst.mockResolvedValue(null);
    await expect(repo.getFlowRules('org-1', 'gone')).resolves.toBeNull();
  });

  it('getById loads the stage rows in order', async () => {
    const { repo, approval } = make();
    approval.findFirst.mockResolvedValue({ id: 'a1' });
    await repo.getById('org-1', 'a1');
    expect(approval.findFirst.mock.calls[0][0].where).toEqual({ id: 'a1', organizationId: 'org-1' });
    expect(approval.findFirst.mock.calls[0][0].include.stages).toEqual({ orderBy: { position: 'asc' } });
  });
});
