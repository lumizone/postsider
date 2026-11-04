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
  const service = new PolicyRulesService(repo as any, integrations as any, orgRepo as any);
  return { service, repo, integrations, orgRepo };
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

  it('revalidates existing params when only the name changes', async () => {
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
