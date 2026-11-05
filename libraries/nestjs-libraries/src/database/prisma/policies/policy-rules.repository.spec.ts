import { PolicyRulesRepository } from './policy-rules.repository';

const make = () => {
  const model = {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: 'r1' }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    count: jest.fn().mockResolvedValue(3),
  };
  const repo = new PolicyRulesRepository({ model: { policyRule: model } } as any);
  return { repo, model };
};

describe('PolicyRulesRepository', () => {
  it('listForOrg scopes by org, hides deleted and orders by priority then createdAt', async () => {
    const { repo, model } = make();
    await repo.listForOrg('org-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', deletedAt: null },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('listEnabled filters enabled and non-deleted', async () => {
    const { repo, model } = make();
    await repo.listEnabled('org-1');
    expect(model.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', enabled: true, deletedAt: null },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  });

  it('getById includes the organization and ignores deleted rows', async () => {
    const { repo, model } = make();
    await repo.getById('org-1', 'r1');
    expect(model.findFirst).toHaveBeenCalledWith({
      where: { id: 'r1', organizationId: 'org-1', deletedAt: null },
    });
  });

  it('create stamps the organization id', async () => {
    const { repo, model } = make();
    await repo.create('org-1', { name: 'n' } as any);
    expect(model.create).toHaveBeenCalledWith({
      data: { name: 'n', organizationId: 'org-1' },
    });
  });

  it('update uses updateMany with the organization in where, then re-reads', async () => {
    const { repo, model } = make();
    model.findFirst.mockResolvedValue({ id: 'r1' });
    const row = await repo.update('org-1', 'r1', { name: 'x' } as any);
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', organizationId: 'org-1', deletedAt: null },
      data: { name: 'x' },
    });
    expect(model.findFirst).toHaveBeenCalledWith({
      where: { id: 'r1', organizationId: 'org-1', deletedAt: null },
    });
    expect(row).toEqual({ id: 'r1' });
  });

  it('update returns null and skips the re-read when nothing matched', async () => {
    const { repo, model } = make();
    model.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.update('org-1', 'r1', {} as any)).resolves.toBeNull();
    expect(model.findFirst).not.toHaveBeenCalled();
  });

  it('softDelete sets deletedAt and disables, scoped to the org', async () => {
    const { repo, model } = make();
    await expect(repo.softDelete('org-1', 'r1')).resolves.toBe(true);
    const arg = model.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'r1', organizationId: 'org-1', deletedAt: null });
    expect(arg.data.enabled).toBe(false);
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
    model.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.softDelete('org-1', 'gone')).resolves.toBe(false);
  });

  it('counts are scoped to the org', async () => {
    const { repo, model } = make();
    await expect(repo.countEnabled('org-1')).resolves.toBe(3);
    expect(model.count).toHaveBeenLastCalledWith({
      where: { organizationId: 'org-1', enabled: true, deletedAt: null },
    });
    await repo.countNonDeleted('org-1');
    expect(model.count).toHaveBeenLastCalledWith({
      where: { organizationId: 'org-1', deletedAt: null },
    });
  });
});
