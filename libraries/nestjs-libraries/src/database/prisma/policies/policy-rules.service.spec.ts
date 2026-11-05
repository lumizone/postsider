import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PolicyRulesService } from './policy-rules.service';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  organizationId: 'org-1',
  name: 'Rule',
  enabled: true,
  priority: 100,
  appliesToActorTypes: [],
  appliesToApiKeyIds: [],
  appliesToIntegrationIds: [],
  appliesToProviders: [],
  condition: 'ALWAYS',
  conditionParams: {},
  effect: 'BLOCK',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  deletedAt: null,
  ...over,
});

const make = () => {
  const repo = {
    listForOrg: jest.fn().mockResolvedValue([]),
    listEnabled: jest.fn(),
    getById: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockImplementation(async (_o, data) => row(data)),
    update: jest.fn().mockImplementation(async (_o, _i, data) => row(data)),
    softDelete: jest.fn().mockResolvedValue(true),
    countEnabled: jest.fn().mockResolvedValue(0),
    countNonDeleted: jest.fn().mockResolvedValue(0),
  };
  const integrations = {
    getIntegrationsList: jest.fn().mockResolvedValue([{ id: 'int-1' }, { id: 'int-2' }]),
  };
  const orgRepo = { listApiKeys: jest.fn().mockResolvedValue([{ id: 'key-1' }]) };
  const flows = {
    getById: jest.fn().mockImplementation(async (_o: string, id: string) => (id === 'flow-1' ? { id } : null)),
  };
  const service = new PolicyRulesService(repo as any, integrations as any, orgRepo as any, flows as any);
  return { service, repo, integrations, orgRepo, flows };
};

const input = (over: Record<string, unknown> = {}) => ({
  name: 'Rule',
  condition: 'ALWAYS',
  effect: 'BLOCK',
  ...over,
});

const badRequest = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).getResponse() as Record<string, any>;
  }
  throw new Error('expected BadRequestException');
};

describe('PolicyRulesService.create', () => {
  it('names conditionParams.words when words are empty', async () => {
    const { service, repo } = make();
    const res = await badRequest(
      service.create('org-1', input({ condition: 'CONTAINS_WORDS', conditionParams: { words: [] } }) as any)
    );
    expect(res.field).toBe('conditionParams.words');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('stores {} for ALWAYS with omitted params and applies defaults', async () => {
    const { service, repo } = make();
    await service.create('org-1', input() as any);
    expect(repo.create).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        conditionParams: {},
        priority: 100,
        enabled: true,
        appliesToActorTypes: [],
        appliesToApiKeyIds: [],
        appliesToIntegrationIds: [],
        appliesToProviders: [],
      })
    );
  });

  it('stores normalized params returned by the validator', async () => {
    const { service, repo } = make();
    await service.create(
      'org-1',
      input({ condition: 'CONTAINS_WORDS', conditionParams: { words: ['  Foo '] } }) as any
    );
    expect(repo.create.mock.calls[0][1].conditionParams).toEqual({ words: ['Foo'] });
  });

  it('lowercases and trims provider filters', async () => {
    const { service, repo } = make();
    await service.create('org-1', input({ appliesToProviders: [' LinkedIn ', 'X'] }) as any);
    expect(repo.create.mock.calls[0][1].appliesToProviders).toEqual(['linkedin', 'x']);
  });

  it('rejects foreign integration ids naming the id', async () => {
    const { service } = make();
    const res = await badRequest(
      service.create('org-1', input({ appliesToIntegrationIds: ['foreign'] }) as any)
    );
    expect(res.field).toBe('appliesToIntegrationIds');
    expect(JSON.stringify(res)).toContain('foreign');
  });

  it('accepts own integration ids and api key ids', async () => {
    const { service, repo } = make();
    await service.create(
      'org-1',
      input({
        appliesToIntegrationIds: ['int-1'],
        appliesToActorTypes: ['API_KEY'],
        appliesToApiKeyIds: ['key-1'],
      }) as any
    );
    expect(repo.create).toHaveBeenCalled();
  });

  it('rejects foreign api key ids', async () => {
    const { service } = make();
    const res = await badRequest(
      service.create(
        'org-1',
        input({ appliesToActorTypes: ['API_KEY'], appliesToApiKeyIds: ['foreign'] }) as any
      )
    );
    expect(res.field).toBe('appliesToApiKeyIds');
    expect(JSON.stringify(res)).toContain('foreign');
  });

  it('rejects api key ids when actor types are set without API_KEY', async () => {
    const { service } = make();
    const res = await badRequest(
      service.create(
        'org-1',
        input({ appliesToActorTypes: ['USER'], appliesToApiKeyIds: ['key-1'] }) as any
      )
    );
    expect(res.field).toBe('appliesToApiKeyIds');
  });

  it('allows api key ids when actor types are empty', async () => {
    const { service, repo } = make();
    await service.create('org-1', input({ appliesToApiKeyIds: ['key-1'] }) as any);
    expect(repo.create).toHaveBeenCalled();
  });

  it('rejects an enabled rule at 50 enabled rules', async () => {
    const { service, repo } = make();
    repo.countEnabled.mockResolvedValue(50);
    const res = await badRequest(service.create('org-1', input() as any));
    expect(res.error).toBe('policy_limit_reached');
  });

  it('rejects any rule at 200 stored rules', async () => {
    const { service, repo } = make();
    repo.countNonDeleted.mockResolvedValue(200);
    const res = await badRequest(service.create('org-1', input({ enabled: false }) as any));
    expect(res.error).toBe('policy_limit_reached');
  });

  it('allows a disabled rule at 50 enabled rules', async () => {
    const { service, repo } = make();
    repo.countEnabled.mockResolvedValue(50);
    await service.create('org-1', input({ enabled: false }) as any);
    expect(repo.create).toHaveBeenCalled();
  });

  it('returns the public shape', async () => {
    const { service } = make();
    const res: any = await service.create('org-1', input() as any);
    expect(res).not.toHaveProperty('deletedAt');
    expect(res).not.toHaveProperty('organizationId');
    expect(res.id).toBe('r1');
  });
});

describe('PolicyRulesService.update', () => {
  it('404s for a foreign or deleted id', async () => {
    const { service, repo } = make();
    await expect(service.update('org-1', 'x', { name: 'n' } as any)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('rejects a condition change whose old params do not fit', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row());
    const res = await badRequest(service.update('org-1', 'r1', { condition: 'OUTSIDE_WINDOW' } as any));
    expect(String(res.field)).toContain('conditionParams');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('writes only the changed field when just the name changes', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(
      row({ condition: 'CONTAINS_WORDS', conditionParams: { words: ['a'] } })
    );
    await service.update('org-1', 'r1', { name: 'new' } as any);
    expect(repo.update).toHaveBeenCalledWith('org-1', 'r1', { name: 'new' });
  });

  it('rejects re-enabling a rule when 50 are enabled', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ enabled: false }));
    repo.countEnabled.mockResolvedValue(50);
    const res = await badRequest(service.update('org-1', 'r1', { enabled: true } as any));
    expect(res.error).toBe('policy_limit_reached');
  });

  it('does not count an already enabled rule against the cap', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ enabled: true }));
    repo.countEnabled.mockResolvedValue(50);
    await service.update('org-1', 'r1', { name: 'n', enabled: true } as any);
    expect(repo.update).toHaveBeenCalled();
  });

  it('validates new filters against the effective actor types', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ appliesToActorTypes: ['USER'] }));
    const res = await badRequest(service.update('org-1', 'r1', { appliesToApiKeyIds: ['key-1'] } as any));
    expect(res.field).toBe('appliesToApiKeyIds');
  });

  it('404s if the row vanishes between read and write', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row());
    repo.update.mockResolvedValue(null);
    await expect(service.update('org-1', 'r1', { name: 'n' } as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('PolicyRulesService.update edge cases', () => {
  it('lets a rule naming a deleted channel and key be disabled', async () => {
    const { service, repo, integrations, orgRepo } = make();
    repo.getById.mockResolvedValue(
      row({ appliesToIntegrationIds: ['gone'], appliesToApiKeyIds: ['revoked'] })
    );
    await service.update('org-1', 'r1', { enabled: false } as any);
    expect(repo.update).toHaveBeenCalledWith('org-1', 'r1', { enabled: false });
    expect(integrations.getIntegrationsList).not.toHaveBeenCalled();
    expect(orgRepo.listApiKeys).not.toHaveBeenCalled();
  });

  it('still verifies newly added ids only', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ appliesToIntegrationIds: ['gone'] }));
    const res = await badRequest(
      service.update('org-1', 'r1', { appliesToIntegrationIds: ['gone', 'foreign'] } as any)
    );
    expect(JSON.stringify(res)).toContain('foreign');
    expect(JSON.stringify(res)).not.toContain('gone');
  });

  it('rejects explicit null fields with 400 before writing', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row());
    for (const key of ['name', 'enabled', 'priority', 'effect', 'condition', 'appliesToActorTypes']) {
      const res = await badRequest(service.update('org-1', 'r1', { [key]: null } as any));
      expect(res.field).toBe(key);
    }
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('resets params to {} when the condition changes to a param-less one', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(
      row({ condition: 'CONTAINS_WORDS', conditionParams: { words: ['a'] } })
    );
    await service.update('org-1', 'r1', { condition: 'ALWAYS' } as any);
    expect(repo.update).toHaveBeenCalledWith('org-1', 'r1', { condition: 'ALWAYS', conditionParams: {} });
  });

  it('validates conditionParams-only updates against the existing condition', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(
      row({ condition: 'CONTAINS_WORDS', conditionParams: { words: ['a'] } })
    );
    const res = await badRequest(
      service.update('org-1', 'r1', { conditionParams: { words: [] } } as any)
    );
    expect(res.field).toBe('conditionParams.words');
    await service.update('org-1', 'r1', { conditionParams: { words: [' b '] } } as any);
    expect(repo.update).toHaveBeenCalledWith('org-1', 'r1', {
      condition: 'CONTAINS_WORDS',
      conditionParams: { words: ['b'] },
    });
  });

  it('drops providers that are empty after trimming', async () => {
    const { service, repo } = make();
    await service.create('org-1', input({ appliesToProviders: ['  ', 'X'] }) as any);
    expect(repo.create.mock.calls[0][1].appliesToProviders).toEqual(['x']);
  });
});

describe('PolicyRulesService get/remove/list', () => {
  it('get 404s when missing', async () => {
    const { service } = make();
    await expect(service.get('org-1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('get returns the public shape', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row());
    const res: any = await service.get('org-1', 'r1');
    expect(res).not.toHaveProperty('organizationId');
  });

  it('remove soft deletes and reports', async () => {
    const { service, repo } = make();
    await expect(service.remove('org-1', 'r1')).resolves.toEqual({ id: 'r1', deleted: true });
    expect(repo.softDelete).toHaveBeenCalledWith('org-1', 'r1');
  });

  it('remove 404s when nothing was deleted', async () => {
    const { service, repo } = make();
    repo.softDelete.mockResolvedValue(false);
    await expect(service.remove('org-1', 'r1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('list maps to public rules', async () => {
    const { service, repo } = make();
    repo.listForOrg.mockResolvedValue([row()]);
    const res: any[] = await service.list('org-1');
    expect(res).toHaveLength(1);
    expect(res[0]).not.toHaveProperty('deletedAt');
  });
});

describe('PolicyRulesService.toRuleInputs', () => {
  it('maps rows untouched and keeps createdAt', () => {
    const { service } = make();
    const params = { words: ['a'] };
    const created = new Date('2026-03-03T00:00:00Z');
    const [r] = service.toRuleInputs([
      row({ condition: 'CONTAINS_WORDS', conditionParams: params, createdAt: created }),
    ] as any);
    expect(r.conditionParams).toBe(params);
    expect(r.createdAt).toBe(created);
    expect(r).toEqual(
      expect.objectContaining({ id: 'r1', name: 'Rule', enabled: true, priority: 100, effect: 'BLOCK' })
    );
    expect(r).not.toHaveProperty('organizationId');
  });
});

describe('PolicyRulesService approval flow link', () => {
  const approvalInput = (over: Record<string, unknown> = {}) =>
    input({ effect: 'REQUIRE_APPROVAL', ...over });

  it('stores a live flow id on a REQUIRE_APPROVAL rule, checked against the org', async () => {
    const { service, repo, flows } = make();
    const res: any = await service.create('org-1', approvalInput({ approvalFlowId: 'flow-1' }) as any);
    expect(flows.getById).toHaveBeenCalledWith('org-1', 'flow-1');
    expect(repo.create.mock.calls[0][1].approvalFlowId).toBe('flow-1');
    expect(res.approvalFlowId).toBe('flow-1');
  });

  it('rejects a flow id on a BLOCK rule', async () => {
    const { service, repo } = make();
    const res = await badRequest(service.create('org-1', input({ approvalFlowId: 'flow-1' }) as any));
    expect(res.error).toBe('approval_flow_invalid');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown, foreign or archived flow (getById finds no live flow)', async () => {
    const { service, repo } = make();
    const res = await badRequest(service.create('org-1', approvalInput({ approvalFlowId: 'gone' }) as any));
    expect(res.error).toBe('approval_flow_invalid');
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('create without a flow id or with null stores no flow and does not look one up', async () => {
    const { service, repo, flows } = make();
    await service.create('org-1', approvalInput() as any);
    await service.create('org-1', approvalInput({ approvalFlowId: null }) as any);
    expect(flows.getById).not.toHaveBeenCalled();
    expect(repo.create.mock.calls[0][1].approvalFlowId).toBeUndefined();
    expect(repo.create.mock.calls[1][1].approvalFlowId).toBeUndefined();
  });

  it('fails closed when flows are not wired and a flow id is given', async () => {
    const { repo, integrations, orgRepo } = make();
    const noFlows = new PolicyRulesService(repo as any, integrations as any, orgRepo as any);
    const res = await badRequest(noFlows.create('org-1', approvalInput({ approvalFlowId: 'flow-1' }) as any));
    expect(res.error).toBe('approval_flow_invalid');
  });

  it('update sets a live flow on a REQUIRE_APPROVAL rule', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ effect: 'REQUIRE_APPROVAL' }));
    await service.update('org-1', 'r1', { approvalFlowId: 'flow-1' } as any);
    expect(repo.update.mock.calls[0][2]).toEqual({ approvalFlowId: 'flow-1' });
  });

  it('update rejects a flow on a rule whose effective effect is BLOCK', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ effect: 'BLOCK' }));
    const res = await badRequest(service.update('org-1', 'r1', { approvalFlowId: 'flow-1' } as any));
    expect(res.error).toBe('approval_flow_invalid');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('update rejects a flow id together with effect BLOCK in the same request', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ effect: 'REQUIRE_APPROVAL' }));
    const res = await badRequest(service.update('org-1', 'r1', { effect: 'BLOCK', approvalFlowId: 'flow-1' } as any));
    expect(res.error).toBe('approval_flow_invalid');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('update rejects an unknown flow', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ effect: 'REQUIRE_APPROVAL' }));
    const res = await badRequest(service.update('org-1', 'r1', { approvalFlowId: 'gone' } as any));
    expect(res.error).toBe('approval_flow_invalid');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('switching a linked rule to BLOCK clears the flow id', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ effect: 'REQUIRE_APPROVAL', approvalFlowId: 'flow-1' }));
    await service.update('org-1', 'r1', { effect: 'BLOCK' } as any);
    expect(repo.update.mock.calls[0][2]).toEqual({ effect: 'BLOCK', approvalFlowId: null });
  });

  it('switching an unlinked rule to BLOCK does not write approvalFlowId', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ effect: 'REQUIRE_APPROVAL', approvalFlowId: null }));
    await service.update('org-1', 'r1', { effect: 'BLOCK' } as any);
    expect(repo.update.mock.calls[0][2]).toEqual({ effect: 'BLOCK' });
  });

  it('null clears the flow id and is the only field allowed to be null', async () => {
    const { service, repo, flows } = make();
    repo.getById.mockResolvedValue(row({ effect: 'REQUIRE_APPROVAL', approvalFlowId: 'flow-1' }));
    await service.update('org-1', 'r1', { approvalFlowId: null } as any);
    expect(repo.update.mock.calls[0][2]).toEqual({ approvalFlowId: null });
    expect(flows.getById).not.toHaveBeenCalled();
    const res = await badRequest(service.update('org-1', 'r1', { name: null } as any));
    expect(res.field).toBe('name');
  });

  it('clearing with null works on a BLOCK rule too', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ effect: 'BLOCK', approvalFlowId: null }));
    await service.update('org-1', 'r1', { approvalFlowId: null } as any);
    expect(repo.update.mock.calls[0][2]).toEqual({ approvalFlowId: null });
  });

  it('re-enabling a rule whose flow was archived meanwhile is refused', async () => {
    const { service, repo } = make();
    repo.getById.mockResolvedValue(row({ effect: 'REQUIRE_APPROVAL', enabled: false, approvalFlowId: 'archived' }));
    const res = await badRequest(service.update('org-1', 'r1', { enabled: true } as any));
    expect(res.error).toBe('approval_flow_invalid');
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('editing an unrelated field of a rule with a stale flow does not need the flow', async () => {
    const { service, repo, flows } = make();
    repo.getById.mockResolvedValue(row({ effect: 'REQUIRE_APPROVAL', enabled: false, approvalFlowId: 'archived' }));
    await service.update('org-1', 'r1', { name: 'new' } as any);
    expect(flows.getById).not.toHaveBeenCalled();
  });
});
