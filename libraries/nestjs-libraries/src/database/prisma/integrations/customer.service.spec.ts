import { CustomerService } from './customer.service';
import { IntegrationRepository } from './integration.repository';

const live = (id: string, name: string) => ({ id, name, createdAt: new Date('2026-01-01') });

describe('CustomerService', () => {
  const build = (over: Record<string, any> = {}) => {
    const repo = {
      listCustomersWithCounts: jest.fn().mockResolvedValue([]),
      countLiveCustomers: jest.fn().mockResolvedValue(0),
      findLiveCustomerByName: jest.fn().mockResolvedValue(null),
      findCustomerById: jest.fn().mockResolvedValue(null),
      createCustomer: jest.fn().mockImplementation(async (_o: string, name: string) => live('c-new', name)),
      renameCustomer: jest.fn().mockResolvedValue(true),
      archiveCustomer: jest.fn().mockResolvedValue({ detachedChannels: 0 }),
      ...over,
    };
    return { repo, service: new CustomerService(repo as any) };
  };

  it('lists through the repository, scoped by organization', async () => {
    const { repo, service } = build();
    repo.listCustomersWithCounts.mockResolvedValue([{ ...live('c1', 'A'), channelCount: 2 }]);
    await expect(service.list('org-1')).resolves.toEqual([{ ...live('c1', 'A'), channelCount: 2 }]);
    expect(repo.listCustomersWithCounts).toHaveBeenCalledWith('org-1');
  });

  describe('create', () => {
    it('creates a new customer with created:true', async () => {
      const { repo, service } = build();
      const res = await service.create('org-1', 'Acme');
      expect(res).toEqual({ customer: live('c-new', 'Acme'), created: true });
      expect(repo.createCustomer).toHaveBeenCalledWith('org-1', 'Acme');
    });

    it('returns the same customer with created:false when called twice', async () => {
      const { repo, service } = build();
      const first = await service.create('org-1', 'Acme');
      repo.findLiveCustomerByName.mockResolvedValue(first.customer);
      const second = await service.create('org-1', 'Acme');
      expect(second.created).toBe(false);
      expect(second.customer.id).toBe(first.customer.id);
      expect(repo.createCustomer).toHaveBeenCalledTimes(1);
    });

    it('rejects the 201st customer with customer_limit_reached', async () => {
      const { repo, service } = build();
      repo.countLiveCustomers.mockResolvedValue(200);
      await expect(service.create('org-1', 'One more')).rejects.toMatchObject({
        status: 400,
        response: { error: 'customer_limit_reached' },
      });
      expect(repo.createCustomer).not.toHaveBeenCalled();
    });

    it('still returns an existing customer when the org is at the limit', async () => {
      const { repo, service } = build();
      repo.countLiveCustomers.mockResolvedValue(200);
      repo.findLiveCustomerByName.mockResolvedValue(live('c9', 'Acme'));
      await expect(service.create('org-1', 'Acme')).resolves.toEqual({
        customer: live('c9', 'Acme'),
        created: false,
      });
    });
  });

  describe('rename', () => {
    it('renames a live customer', async () => {
      const { repo, service } = build();
      repo.findCustomerById.mockResolvedValue(live('c1', 'Old'));
      await expect(service.rename('org-1', 'c1', 'New')).resolves.toMatchObject({ id: 'c1', name: 'New' });
      expect(repo.renameCustomer).toHaveBeenCalledWith('org-1', 'c1', 'New');
    });

    it('409 customer_name_taken when another live customer has the name', async () => {
      const { repo, service } = build();
      repo.findCustomerById.mockResolvedValue(live('c1', 'Old'));
      repo.findLiveCustomerByName.mockResolvedValue(live('c2', 'New'));
      await expect(service.rename('org-1', 'c1', 'New')).rejects.toMatchObject({
        status: 409,
        response: { error: 'customer_name_taken' },
      });
      expect(repo.renameCustomer).not.toHaveBeenCalled();
    });

    it('allows renaming to the name the customer already has', async () => {
      const { repo, service } = build();
      repo.findCustomerById.mockResolvedValue(live('c1', 'Same'));
      repo.findLiveCustomerByName.mockResolvedValue(live('c1', 'Same'));
      await expect(service.rename('org-1', 'c1', 'Same')).resolves.toMatchObject({ id: 'c1' });
    });

    it('404 for a foreign, unknown or archived customer', async () => {
      const { repo, service } = build();
      await expect(service.rename('org-1', 'foreign', 'X')).rejects.toMatchObject({ status: 404 });
      expect(repo.findCustomerById).toHaveBeenCalledWith('org-1', 'foreign');
      expect(repo.renameCustomer).not.toHaveBeenCalled();
    });

    it('404 when the row disappears between the check and the write', async () => {
      const { repo, service } = build();
      repo.findCustomerById.mockResolvedValue(live('c1', 'Old'));
      repo.renameCustomer.mockResolvedValue(false);
      await expect(service.rename('org-1', 'c1', 'New')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('archive', () => {
    it('reports detached channels', async () => {
      const { repo, service } = build();
      repo.archiveCustomer.mockResolvedValue({ detachedChannels: 3 });
      await expect(service.archive('org-1', 'c1')).resolves.toEqual({
        id: 'c1',
        archived: true,
        detachedChannels: 3,
      });
      expect(repo.archiveCustomer).toHaveBeenCalledWith('org-1', 'c1');
    });

    it('404 for a foreign id or a second archive', async () => {
      const { repo, service } = build();
      repo.archiveCustomer.mockResolvedValue(null);
      await expect(service.archive('org-1', 'foreign')).rejects.toMatchObject({ status: 404 });
      await expect(service.archive('org-1', 'c1')).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('get', () => {
    it('404 for unknown ids', async () => {
      const { service } = build();
      await expect(service.get('org-1', 'nope')).rejects.toMatchObject({ status: 404 });
    });
  });
});

describe('IntegrationRepository customer methods', () => {
  const build = () => {
    const customerModel = {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const integrationModel = {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    };
    const postModel = { update: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() };
    const tx = { customer: customerModel, integration: integrationModel, post: postModel };
    const transaction = { model: { $transaction: jest.fn(async (fn: any) => fn(tx)) } };
    const repo = new (IntegrationRepository as any)(
      { model: { integration: integrationModel } },
      { model: { post: postModel } },
      {},
      {},
      { model: { customer: customerModel } },
      {},
      transaction
    ) as IntegrationRepository;
    return { repo, customerModel, integrationModel, postModel, transaction };
  };

  it('archive soft deletes and only nulls customerId on integrations, in one transaction', async () => {
    const { repo, customerModel, integrationModel, postModel, transaction } = build();
    const res = await repo.archiveCustomer('org-1', 'c1');
    expect(res).toEqual({ detachedChannels: 2 });
    expect(transaction.model.$transaction).toHaveBeenCalledTimes(1);
    expect(customerModel.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', orgId: 'org-1', deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    expect(integrationModel.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', customerId: 'c1' },
      data: { customerId: null },
    });
    expect(integrationModel.update).not.toHaveBeenCalled();
    expect(integrationModel.delete).not.toHaveBeenCalled();
    expect(integrationModel.deleteMany).not.toHaveBeenCalled();
    for (const fn of Object.values(postModel)) expect(fn).not.toHaveBeenCalled();
  });

  it('archive returns null and detaches nothing when the customer is not live in the org', async () => {
    const { repo, customerModel, integrationModel } = build();
    customerModel.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.archiveCustomer('org-1', 'c1')).resolves.toBeNull();
    expect(integrationModel.updateMany).not.toHaveBeenCalled();
  });

  it('lookups and listing are scoped by org and live rows', async () => {
    const { repo, customerModel } = build();
    await repo.findCustomerById('org-1', 'c1');
    expect(customerModel.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', orgId: 'org-1', deletedAt: null },
    });
    await repo.findLiveCustomerByName('org-1', 'Acme');
    expect(customerModel.findFirst).toHaveBeenCalledWith({
      where: { orgId: 'org-1', name: 'Acme', deletedAt: null },
    });
    await repo.countLiveCustomers('org-1');
    expect(customerModel.count).toHaveBeenCalledWith({ where: { orgId: 'org-1', deletedAt: null } });
    await repo.listCustomersWithCounts('org-1');
    expect(customerModel.findMany.mock.calls[0][0].where).toEqual({ orgId: 'org-1', deletedAt: null });
  });

  it('rename updates only a live row of the org and reports whether it matched', async () => {
    const { repo, customerModel } = build();
    await expect(repo.renameCustomer('org-1', 'c1', 'New')).resolves.toBe(true);
    expect(customerModel.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', orgId: 'org-1', deletedAt: null },
      data: { name: 'New' },
    });
    customerModel.updateMany.mockResolvedValue({ count: 0 });
    await expect(repo.renameCustomer('org-1', 'c1', 'New')).resolves.toBe(false);
  });
});
