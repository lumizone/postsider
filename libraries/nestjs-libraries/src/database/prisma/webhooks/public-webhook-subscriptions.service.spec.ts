import { PublicWebhookSubscriptionsService } from './public-webhook-subscriptions.service';

function serviceWithModel(model: Record<string, jest.Mock>) {
  return new PublicWebhookSubscriptionsService({
    publicWebhookSubscription: model,
  } as any);
}

describe('PublicWebhookSubscriptionsService', () => {
  const previousSigningKey = process.env.WEBHOOK_SIGNING_KEY;

  beforeEach(() => {
    process.env.WEBHOOK_SIGNING_KEY = 'test-only-signing-key';
  });

  afterAll(() => {
    if (previousSigningKey === undefined)
      delete process.env.WEBHOOK_SIGNING_KEY;
    else process.env.WEBHOOK_SIGNING_KEY = previousSigningKey;
  });

  it('creates a tenant-owned subscription and reveals its derived secret once', async () => {
    const create = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'hook-1',
      name: data.name,
      url: data.url,
      events: data.events,
      active: true,
      consecutiveFailures: 0,
      lastDeliveryAt: null,
      lastFailureAt: null,
      disabledAt: null,
      createdAt: new Date('2026-09-25T00:00:00.000Z'),
      updatedAt: new Date('2026-09-25T00:00:00.000Z'),
    }));
    const service = serviceWithModel({ create });

    const result = await service.create('org-1', {
      name: ' Zapier ',
      url: 'https://hooks.example.com/postsider',
      events: ['post.published'],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-1',
          name: 'Zapier',
          events: ['post.published'],
          secretVersion: expect.any(String),
        }),
      })
    );
    expect(result.secret).toMatch(/^pwhsec_/);
    expect(create.mock.calls[0][0].data).not.toHaveProperty('secret');
  });

  it('does not expose secretVersion when listing subscriptions', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = serviceWithModel({ findMany });

    await service.list('org-1');

    const select = findMany.mock.calls[0][0].select;
    expect(select.secretVersion).toBeUndefined();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } })
    );
  });

  it('prevents one organization from updating another organization subscription', async () => {
    const update = jest.fn();
    const service = serviceWithModel({
      findFirst: jest.fn().mockResolvedValue(null),
      update,
    });

    await expect(
      service.update('org-attacker', 'hook-victim', { active: false })
    ).rejects.toMatchObject({ status: 404 });
    expect(update).not.toHaveBeenCalled();
  });

  it('rotates a secret without storing the derived signing secret', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'hook-1' });
    const service = serviceWithModel({
      findFirst: jest.fn().mockResolvedValue({ id: 'hook-1' }),
      update,
    });

    const result = await service.rotateSecret('org-1', 'hook-1');

    expect(result.secret).toMatch(/^pwhsec_/);
    expect(update.mock.calls[0][0].data).toEqual({
      secretVersion: expect.any(String),
    });
  });
});
