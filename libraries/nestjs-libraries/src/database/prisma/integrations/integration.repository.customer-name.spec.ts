import { IntegrationRepository } from './integration.repository';

describe('IntegrationRepository.updateOnCustomerName', () => {
  const make = (existing: unknown) => {
    const findFirst = jest.fn().mockResolvedValue(existing);
    const create = jest.fn().mockResolvedValue({ id: 'new-customer' });
    const update = jest.fn().mockResolvedValue({ id: 'i1' });
    const self = {
      _customers: { model: { customer: { findFirst, create } } },
      _integration: { model: { integration: { update } } },
    };
    const run = (name: string) =>
      (IntegrationRepository.prototype.updateOnCustomerName as any).call(self, 'org', 'i1', name);
    return { findFirst, create, update, run };
  };

  it('never matches an archived customer by name (deletedAt: null in the lookup)', async () => {
    const { findFirst, run } = make(null);
    await run('Acme');
    expect(findFirst).toHaveBeenCalledWith({
      where: { orgId: 'org', name: 'Acme', deletedAt: null },
    });
  });

  it('creates a live customer when only an archived one carries the name, and connects it', async () => {
    const { create, update, run } = make(null);
    await run('Acme');
    expect(create).toHaveBeenCalledWith({ data: { name: 'Acme', orgId: 'org' } });
    expect(update.mock.calls[0][0].data).toEqual({ customer: { connect: { id: 'new-customer' } } });
  });

  it('reuses a live customer with that name', async () => {
    const { create, update, run } = make({ id: 'live-1' });
    await run('Acme');
    expect(create).not.toHaveBeenCalled();
    expect(update.mock.calls[0][0].data).toEqual({ customer: { connect: { id: 'live-1' } } });
  });
});
