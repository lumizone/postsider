import { ApprovalFlowRepository } from './approval-flow.repository';

describe('ApprovalFlowRepository', () => {
  const tx = {
    approvalFlow: { create: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
    approvalFlowStage: { deleteMany: jest.fn(), createMany: jest.fn() },
  };
  const flowModel = {
    findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn(), updateMany: jest.fn(),
  };
  const ruleModel = { findMany: jest.fn(), count: jest.fn() };
  const transaction = { model: { $transaction: jest.fn(async (cb: any) => cb(tx)) } };
  let repo: ApprovalFlowRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    transaction.model.$transaction.mockImplementation(async (cb: any) => cb(tx));
    repo = new ApprovalFlowRepository(
      { model: { approvalFlow: flowModel } } as any,
      { model: { policyRule: ruleModel } } as any,
      transaction as any
    );
  });

  const stages = [
    { position: 1, name: 'A', minRole: 'ADMIN', approverUserIds: [], allowAutomation: false, allowGuest: false },
  ];

  it('reads are scoped by organization and exclude archived rows', async () => {
    flowModel.findMany.mockResolvedValue([]);
    await repo.listLive('org-1');
    expect(flowModel.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', deletedAt: null });
    flowModel.findFirst.mockResolvedValue(null);
    await repo.getLive('org-1', 'f1');
    expect(flowModel.findFirst.mock.calls[0][0].where).toEqual({ id: 'f1', organizationId: 'org-1', deletedAt: null });
    await repo.getDefault('org-1');
    expect(flowModel.findFirst.mock.calls[1][0].where).toEqual({
      organizationId: 'org-1', deletedAt: null, isDefault: true,
    });
    flowModel.count.mockResolvedValue(3);
    expect(await repo.countLive('org-1')).toBe(3);
    expect(flowModel.count.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', deletedAt: null });
  });

  it('create with isDefault clears the previous default inside the same transaction', async () => {
    tx.approvalFlow.create.mockResolvedValue({ id: 'new' });
    await repo.create('org-1', {
      name: 'F', isDefault: true, preventSelfApproval: true, requireDistinctApprovers: true, stages,
    });
    expect(transaction.model.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.approvalFlow.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', deletedAt: null, isDefault: true },
      data: { isDefault: false },
    });
    expect(tx.approvalFlow.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      tx.approvalFlow.create.mock.invocationCallOrder[0]
    );
    const createArg = tx.approvalFlow.create.mock.calls[0][0];
    expect(createArg.data.organizationId).toBe('org-1');
    expect(createArg.data.stages.create).toEqual(stages);
  });

  it('create without isDefault does not touch other flows', async () => {
    tx.approvalFlow.create.mockResolvedValue({ id: 'new' });
    await repo.create('org-1', {
      name: 'F', isDefault: false, preventSelfApproval: true, requireDistinctApprovers: true, stages,
    });
    expect(tx.approvalFlow.updateMany).not.toHaveBeenCalled();
  });

  it('update replaces stages in one transaction, scoped by org, and clears the default only when asked', async () => {
    tx.approvalFlow.updateMany.mockResolvedValue({ count: 1 });
    tx.approvalFlow.findFirst.mockResolvedValue({ id: 'f1', stages: [] });
    const out = await repo.update('org-1', 'f1', { name: 'N', isDefault: true, stages });
    expect(out).toEqual({ id: 'f1', stages: [] });
    const calls = tx.approvalFlow.updateMany.mock.calls.map((c) => c[0]);
    expect(calls[0]).toEqual({
      where: { organizationId: 'org-1', deletedAt: null, isDefault: true, id: { not: 'f1' } },
      data: { isDefault: false },
    });
    expect(calls[1].where).toEqual({ id: 'f1', organizationId: 'org-1', deletedAt: null });
    expect(calls[1].data).toEqual({ name: 'N', isDefault: true, updatedAt: expect.any(Date) });
    expect(tx.approvalFlowStage.deleteMany).toHaveBeenCalledWith({ where: { flowId: 'f1' } });
    expect(tx.approvalFlowStage.createMany).toHaveBeenCalledWith({
      data: stages.map((s) => ({ ...s, flowId: 'f1' })),
    });
  });

  it('update returns null and rolls back nothing visible when the row is not live in this org', async () => {
    tx.approvalFlow.updateMany.mockResolvedValue({ count: 0 });
    const out = await repo.update('org-1', 'foreign', { name: 'N', stages });
    expect(out).toBeNull();
    expect(tx.approvalFlowStage.deleteMany).not.toHaveBeenCalled();
    expect(tx.approvalFlowStage.createMany).not.toHaveBeenCalled();
  });

  it('update without stages leaves stages alone', async () => {
    tx.approvalFlow.updateMany.mockResolvedValue({ count: 1 });
    tx.approvalFlow.findFirst.mockResolvedValue({ id: 'f1' });
    await repo.update('org-1', 'f1', { name: 'N' });
    expect(tx.approvalFlowStage.deleteMany).not.toHaveBeenCalled();
  });

  it('archive is a soft delete scoped by org that also drops the default flag', async () => {
    flowModel.updateMany.mockResolvedValue({ count: 1 });
    expect(await repo.archive('org-1', 'f1')).toBe(true);
    const arg = flowModel.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'f1', organizationId: 'org-1', deletedAt: null });
    expect(arg.data.isDefault).toBe(false);
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
    flowModel.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.archive('org-1', 'x')).toBe(false);
  });

  it('hasEnabledRuleReference counts only enabled, non-deleted rules of the org', async () => {
    ruleModel.count.mockResolvedValue(1);
    expect(await repo.hasEnabledRuleReference('org-1', 'f1')).toBe(true);
    expect(ruleModel.count.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1', approvalFlowId: 'f1', enabled: true, deletedAt: null,
    });
    ruleModel.count.mockResolvedValue(0);
    expect(await repo.hasEnabledRuleReference('org-1', 'f1')).toBe(false);
  });

  it('findRuleFlowIds only returns rules of the org whose flow is live', async () => {
    ruleModel.findMany.mockResolvedValue([{ id: 'r1', approvalFlowId: 'f1' }]);
    const out = await repo.findRuleFlowIds('org-1', ['r1', 'r2']);
    expect(out).toEqual([{ id: 'r1', approvalFlowId: 'f1' }]);
    expect(ruleModel.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['r1', 'r2'] },
      organizationId: 'org-1',
      deletedAt: null,
      approvalFlowId: { not: null },
      approvalFlow: { is: { organizationId: 'org-1', deletedAt: null } },
    });
  });
});
