import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ApprovalFlowService } from './approval-flow.service';

const dbFlow = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  organizationId: 'org-1',
  name: 'Flow',
  isDefault: false,
  preventSelfApproval: true,
  requireDistinctApprovers: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  stages: [
    {
      id: 's2', flowId: 'f1', position: 2, name: 'B', minRole: 'SUPERADMIN',
      approverUserIds: [], allowAutomation: false, allowGuest: false,
    },
    {
      id: 's1', flowId: 'f1', position: 1, name: 'A', minRole: 'ADMIN',
      approverUserIds: ['u1'], allowAutomation: true, allowGuest: false,
    },
  ],
  ...over,
});

describe('ApprovalFlowService', () => {
  const repo = {
    listLive: jest.fn(),
    getLive: jest.fn(),
    countLive: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
    hasEnabledRuleReference: jest.fn(),
    getDefault: jest.fn(),
    findRuleFlowIds: jest.fn(),
  };
  const orgs = { getAllUsersOrgs: jest.fn() };
  let service: ApprovalFlowService;

  beforeEach(() => {
    jest.resetAllMocks();
    orgs.getAllUsersOrgs.mockResolvedValue({
      users: [
        { role: 'ADMIN', user: { id: 'u1' } },
        { role: 'USER', user: { id: 'u2' } },
      ],
    });
    repo.countLive.mockResolvedValue(0);
    repo.create.mockImplementation(async (_o, data) => dbFlow({ ...data, stages: data.stages }));
    service = new ApprovalFlowService(repo as any, orgs as any);
  });

  const stage = (over: Record<string, unknown> = {}) => ({ name: 'S', minRole: 'ADMIN' as const, ...over });

  describe('create', () => {
    it('assigns positions from array order and applies defaults', async () => {
      await service.create('org-1', {
        name: ' Flow ',
        stages: [stage({ name: 'one' }), stage({ name: 'two' }), stage({ name: 'three' })],
      } as any);
      const data = repo.create.mock.calls[0][1];
      expect(repo.create.mock.calls[0][0]).toBe('org-1');
      expect(data.stages.map((s: any) => [s.position, s.name])).toEqual([
        [1, 'one'], [2, 'two'], [3, 'three'],
      ]);
      expect(data.stages[0]).toEqual({
        position: 1, name: 'one', minRole: 'ADMIN', approverUserIds: [],
        allowAutomation: false, allowGuest: false,
      });
      expect(data).toMatchObject({
        name: 'Flow', isDefault: false, preventSelfApproval: true, requireDistinctApprovers: true,
      });
    });

    it('rejects an approver who is not a member of the organization', async () => {
      await expect(
        service.create('org-1', { name: 'F', stages: [stage({ approverUserIds: ['u1', 'stranger'] })] } as any)
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: expect.objectContaining({ error: 'approval_flow_invalid' }),
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('accepts members of the organization', async () => {
      await service.create('org-1', { name: 'F', stages: [stage({ approverUserIds: ['u1', 'u2'] })] } as any);
      expect(repo.create).toHaveBeenCalled();
    });

    it('rejects the 21st live flow', async () => {
      repo.countLive.mockResolvedValue(20);
      await expect(
        service.create('org-1', { name: 'F', stages: [stage()] } as any)
      ).rejects.toMatchObject({
        constructor: BadRequestException,
        response: expect.objectContaining({ error: 'approval_flow_limit_reached' }),
      });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('allows the 20th live flow', async () => {
      repo.countLive.mockResolvedValue(19);
      await service.create('org-1', { name: 'F', stages: [stage()] } as any);
      expect(repo.create).toHaveBeenCalled();
    });

    it('passes isDefault to the repository (which clears the old default in one transaction)', async () => {
      await service.create('org-1', { name: 'F', isDefault: true, stages: [stage()] } as any);
      expect(repo.create.mock.calls[0][1].isDefault).toBe(true);
    });

    it('returns stages ordered by position and never organizationId or deletedAt', async () => {
      const out: any = await service.create('org-1', { name: 'F', stages: [stage()] } as any);
      expect(out).not.toHaveProperty('organizationId');
      expect(out).not.toHaveProperty('deletedAt');
      expect(out.stages.map((s: any) => s.position)).toEqual([...out.stages.map((s: any) => s.position)].sort());
      for (const s of out.stages) {
        expect(s).not.toHaveProperty('flowId');
        expect(s).not.toHaveProperty('id');
      }
    });
  });

  describe('reads', () => {
    it('list sorts stages by position and strips internals', async () => {
      repo.listLive.mockResolvedValue([dbFlow()]);
      const [out]: any[] = await service.list('org-1');
      expect(repo.listLive).toHaveBeenCalledWith('org-1');
      expect(out.stages.map((s: any) => s.position)).toEqual([1, 2]);
      expect(out).not.toHaveProperty('organizationId');
      expect(out).not.toHaveProperty('deletedAt');
    });

    it('get answers 404 for a foreign or archived id', async () => {
      repo.getLive.mockResolvedValue(null);
      await expect(service.get('org-1', 'foreign')).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.getLive).toHaveBeenCalledWith('org-1', 'foreign');
    });
  });

  describe('update', () => {
    it('404 for a foreign id and does not write', async () => {
      repo.getLive.mockResolvedValue(null);
      await expect(service.update('org-1', 'x', { name: 'N' } as any)).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('replaces stages with renumbered positions and validates members', async () => {
      repo.getLive.mockResolvedValue(dbFlow());
      repo.update.mockResolvedValue(dbFlow());
      await service.update('org-1', 'f1', { stages: [stage({ name: 'x' }), stage({ name: 'y' })] } as any);
      const data = repo.update.mock.calls[0][2];
      expect(data.stages.map((s: any) => s.position)).toEqual([1, 2]);

      await expect(
        service.update('org-1', 'f1', { stages: [stage({ approverUserIds: ['nope'] })] } as any)
      ).rejects.toMatchObject({ response: expect.objectContaining({ error: 'approval_flow_invalid' }) });
    });

    it('sends only supplied fields and omits stages when absent', async () => {
      repo.getLive.mockResolvedValue(dbFlow());
      repo.update.mockResolvedValue(dbFlow());
      await service.update('org-1', 'f1', { isDefault: true } as any);
      const data = repo.update.mock.calls[0][2];
      expect(data).toEqual({ isDefault: true });
      expect('stages' in data).toBe(false);
    });

    it('404 when the repository reports the row vanished', async () => {
      repo.getLive.mockResolvedValue(dbFlow());
      repo.update.mockResolvedValue(null);
      await expect(service.update('org-1', 'f1', { name: 'N' } as any)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('archive', () => {
    it('is blocked with flow_in_use while an enabled rule references the flow', async () => {
      repo.getLive.mockResolvedValue(dbFlow());
      repo.hasEnabledRuleReference.mockResolvedValue(true);
      const err: any = await service.archive('org-1', 'f1').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.getResponse()).toEqual(expect.objectContaining({ error: 'flow_in_use' }));
      expect(repo.archive).not.toHaveBeenCalled();
    });

    it('archives when no enabled rule references it', async () => {
      repo.getLive.mockResolvedValue(dbFlow());
      repo.hasEnabledRuleReference.mockResolvedValue(false);
      repo.archive.mockResolvedValue(true);
      await expect(service.archive('org-1', 'f1')).resolves.toEqual({ id: 'f1', archived: true });
      expect(repo.hasEnabledRuleReference).toHaveBeenCalledWith('org-1', 'f1');
      expect(repo.archive).toHaveBeenCalledWith('org-1', 'f1');
    });

    it('404 for a foreign id', async () => {
      repo.getLive.mockResolvedValue(null);
      await expect(service.archive('org-1', 'x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404 when the archive write finds the row already gone (concurrent archive)', async () => {
      repo.getLive.mockResolvedValue(dbFlow());
      repo.hasEnabledRuleReference.mockResolvedValue(false);
      repo.archive.mockResolvedValue(false);
      await expect(service.archive('org-1', 'f1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resolveFlowForRules', () => {
    it('returns the flow of the first rule id (in the given order) that has a live flow', async () => {
      repo.findRuleFlowIds.mockResolvedValue([
        { id: 'r2', approvalFlowId: 'fB' },
        { id: 'r3', approvalFlowId: 'fC' },
      ]);
      repo.getLive.mockImplementation(async (_o, id) => dbFlow({ id }));
      const flow = await service.resolveFlowForRules('org-1', ['r1', 'r3', 'r2']);
      expect(repo.findRuleFlowIds).toHaveBeenCalledWith('org-1', ['r1', 'r3', 'r2']);
      expect(flow?.id).toBe('fC');
      expect(repo.getDefault).not.toHaveBeenCalled();
    });

    it('falls back to the default flow, then to null', async () => {
      repo.findRuleFlowIds.mockResolvedValue([]);
      repo.getDefault.mockResolvedValue(dbFlow({ id: 'def', isDefault: true }));
      expect((await service.resolveFlowForRules('org-1', ['r1']))?.id).toBe('def');
      repo.getDefault.mockResolvedValue(null);
      expect(await service.resolveFlowForRules('org-1', ['r1'])).toBeNull();
    });

    it('skips a rule whose flow is archived (live lookup returns null) and tries the next', async () => {
      repo.findRuleFlowIds.mockResolvedValue([
        { id: 'r1', approvalFlowId: 'gone' },
        { id: 'r2', approvalFlowId: 'fB' },
      ]);
      repo.getLive.mockImplementation(async (_o, id) => (id === 'gone' ? null : dbFlow({ id })));
      expect((await service.resolveFlowForRules('org-1', ['r1', 'r2']))?.id).toBe('fB');
    });

    it('uses the default for an empty rule list without querying rules', async () => {
      repo.getDefault.mockResolvedValue(null);
      expect(await service.resolveFlowForRules('org-1', [])).toBeNull();
      expect(repo.findRuleFlowIds).not.toHaveBeenCalled();
    });

    it('returned flow has stages sorted by position', async () => {
      repo.findRuleFlowIds.mockResolvedValue([{ id: 'r1', approvalFlowId: 'f1' }]);
      repo.getLive.mockResolvedValue(dbFlow());
      const flow = await service.resolveFlowForRules('org-1', ['r1']);
      expect(flow?.stages.map((s) => s.position)).toEqual([1, 2]);
    });
  });

  describe('getDefault and getById', () => {
    it('getDefault returns null when there is none', async () => {
      repo.getDefault.mockResolvedValue(null);
      expect(await service.getDefault('org-1')).toBeNull();
    });
    it('getById scopes by org and returns null for foreign ids', async () => {
      repo.getLive.mockResolvedValue(null);
      expect(await service.getById('org-1', 'x')).toBeNull();
      expect(repo.getLive).toHaveBeenCalledWith('org-1', 'x');
    });
  });

  describe('snapshot', () => {
    it('captures flow id, stage count, ordered stage definitions and rules', () => {
      const snap = service.snapshot(dbFlow({ preventSelfApproval: false }) as any);
      expect(snap.flowId).toBe('f1');
      expect(snap.stageCount).toBe(2);
      expect(snap.stages.map((s) => s.position)).toEqual([1, 2]);
      expect(snap.stages[0]).toEqual({
        position: 1, name: 'A', minRole: 'ADMIN', approverUserIds: ['u1'],
        allowAutomation: true, allowGuest: false,
      });
      expect(snap.rules).toEqual({ preventSelfApproval: false, requireDistinctApprovers: true });
    });
  });
});
