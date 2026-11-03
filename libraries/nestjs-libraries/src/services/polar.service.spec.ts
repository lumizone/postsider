import { PolarService } from './polar.service';

describe('PolarService subscription cancellation', () => {
  const subscriptions = {
    deleteSubscription: jest.fn(),
    deleteSubscriptionByOrganizationId: jest.fn(),
    deleteSubscriptionByOrganizationIdIfCurrent: jest.fn(),
    getSubscriptionByIdentifier: jest.fn(),
    getSubscription: jest.fn(),
    modifySubscriptionByOrg: jest.fn(),
  };

  const service = new PolarService(
    subscriptions as any,
    {} as any,
    {} as any,
    {} as any
  );

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptions.getSubscriptionByIdentifier.mockResolvedValue(null);
    subscriptions.deleteSubscriptionByOrganizationIdIfCurrent.mockResolvedValue(
      {
        count: 1,
      }
    );
    subscriptions.getSubscription.mockResolvedValue(null);
  });

  it('cancels only the current subscription identifier', async () => {
    await expect(
      (service as any).onSubscriptionCanceled({
        id: 'subscription-1',
        customer: { id: 'customer-1', externalCustomerId: 'org-1' },
      })
    ).resolves.toEqual({ ok: true });

    expect(
      subscriptions.deleteSubscriptionByOrganizationIdIfCurrent
    ).toHaveBeenCalledWith('org-1', 'subscription-1');
    expect(subscriptions.deleteSubscription).not.toHaveBeenCalled();
  });

  it('rejects an out-of-order cancellation after the subscription was replaced', async () => {
    subscriptions.deleteSubscriptionByOrganizationIdIfCurrent.mockResolvedValue(
      {
        count: 0,
      }
    );

    await expect(
      (service as any).onSubscriptionCanceled({
        id: 'old-subscription',
        metadata: { orgId: 'org-1' },
      })
    ).resolves.toEqual({ ok: true, stale: true });

    expect(
      subscriptions.deleteSubscriptionByOrganizationIdIfCurrent
    ).toHaveBeenCalledWith('org-1', 'old-subscription');
    expect(subscriptions.deleteSubscription).not.toHaveBeenCalled();
  });

  it('rejects a terminal event whose identifier is no longer known', async () => {
    await expect(
      (service as any).onSubscriptionCanceled({ id: 'old-subscription' })
    ).resolves.toEqual({ ok: true, stale: true });

    expect(
      subscriptions.deleteSubscriptionByOrganizationIdIfCurrent
    ).not.toHaveBeenCalled();
  });

  it('resolves an identifier-only cancellation to its current organization', async () => {
    subscriptions.getSubscriptionByIdentifier.mockResolvedValue({
      organizationId: 'org-1',
    });

    await expect(
      (service as any).onSubscriptionCanceled({ id: 'subscription-1' })
    ).resolves.toEqual({ ok: true });

    expect(
      subscriptions.deleteSubscriptionByOrganizationIdIfCurrent
    ).toHaveBeenCalledWith('org-1', 'subscription-1');
    expect(subscriptions.modifySubscriptionByOrg).not.toHaveBeenCalled();
  });

  it('uses the revoked identifier for a direct cancellation CAS', async () => {
    const revoke = jest.fn().mockResolvedValue(undefined);
    (service as any)._polar = { subscriptions: { revoke } };
    subscriptions.getSubscription.mockResolvedValue({
      identifier: 'subscription-1',
      organizationId: 'org-1',
    });

    await expect(service.cancelSubscription('org-1')).resolves.toEqual({
      cancelled: true,
    });

    expect(revoke).toHaveBeenCalledWith({ id: 'subscription-1' });
    expect(
      subscriptions.deleteSubscriptionByOrganizationIdIfCurrent
    ).toHaveBeenCalledWith('org-1', 'subscription-1');
    expect(subscriptions.deleteSubscription).not.toHaveBeenCalled();
  });
});

describe('PolarService webhook entitlement statuses', () => {
  const createService = () =>
    new PolarService({} as any, {} as any, {} as any, {} as any);

  it.each(['trialing', 'active', 'past_due'])(
    'upserts entitlements for explicit %s status',
    async (status) => {
      const service = createService();
      const upsert = jest
        .spyOn(service as any, 'onSubscriptionUpserted')
        .mockResolvedValue({ ok: true });
      const cancel = jest
        .spyOn(service as any, 'onSubscriptionCanceled')
        .mockResolvedValue({ ok: true });

      await expect(
        (service as any).dispatchWebhook({
          type: 'subscription.updated',
          data: { id: 'subscription-1', status },
        })
      ).resolves.toEqual({ ok: true });

      expect(upsert).toHaveBeenCalledTimes(1);
      expect(cancel).not.toHaveBeenCalled();
    }
  );

  it.each(['canceled', 'paused', 'unpaid', 'revoked'])(
    'removes entitlements for terminal %s status',
    async (status) => {
      const service = createService();
      const upsert = jest
        .spyOn(service as any, 'onSubscriptionUpserted')
        .mockResolvedValue({ ok: true });
      const cancel = jest
        .spyOn(service as any, 'onSubscriptionCanceled')
        .mockResolvedValue({ ok: true });

      await expect(
        (service as any).dispatchWebhook({
          type: 'subscription.updated',
          data: { id: 'subscription-1', status },
        })
      ).resolves.toEqual({ ok: true });

      expect(cancel).toHaveBeenCalledTimes(1);
      expect(upsert).not.toHaveBeenCalled();
    }
  );

  it.each(['incomplete', 'incomplete_expired', 'unexpected', undefined])(
    'does not grant entitlements for non-entitling status %s',
    async (status) => {
      const service = createService();
      const upsert = jest
        .spyOn(service as any, 'onSubscriptionUpserted')
        .mockResolvedValue({ ok: true });
      const cancel = jest
        .spyOn(service as any, 'onSubscriptionCanceled')
        .mockResolvedValue({ ok: true });

      await expect(
        (service as any).dispatchWebhook({
          type: 'subscription.updated',
          data: { id: 'subscription-1', status },
        })
      ).resolves.toEqual({ ok: true, ignored: true });

      expect(upsert).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
    }
  );
});


describe('PolarService first paid conversion', () => {
  const originalProduct = process.env.POLAR_PRODUCT_TEAM_MONTHLY;
  const productId = 'polar-stage5-team-monthly';

  beforeEach(() => {
    process.env.POLAR_PRODUCT_TEAM_MONTHLY = productId;
  });

  afterEach(() => {
    if (originalProduct === undefined) delete process.env.POLAR_PRODUCT_TEAM_MONTHLY;
    else process.env.POLAR_PRODUCT_TEAM_MONTHLY = originalProduct;
  });

  function serviceWithFunnel() {
    const funnel = {
      recordFirstPaidOrder: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PolarService(
      {} as any, {} as any, {} as any, {} as any, funnel as any
    );
    return { service, funnel };
  }

  const order = {
    paid: true,
    total_amount: 3500,
    currency: 'usd',
    product_id: productId,
    subscription_id: 'polar_subscription_1',
    customer: { external_id: 'org-from-verified-polar-customer' },
  };

  it('uses verified order.paid, not subscription.active, as the paid milestone', async () => {
    const { service, funnel } = serviceWithFunnel();
    await expect((service as any).dispatchWebhook({
      type: 'order.paid', data: order,
    })).resolves.toEqual({ ok: true });
    expect(funnel.recordFirstPaidOrder).toHaveBeenCalledWith(
      'org-from-verified-polar-customer', 'TEAM', 3500, 'USD'
    );
  });

  it.each([
    ['unpaid', { paid: false }],
    ['free', { total_amount: 0 }],
    ['no subscription', { subscription_id: null }],
    ['unknown product', { product_id: 'other-product' }],
    ['unknown customer', { customer: null }],
    ['bad amount', { total_amount: '3500' }],
  ])('does not attribute a %s order', async (_, change) => {
    const { service, funnel } = serviceWithFunnel();
    await expect((service as any).dispatchWebhook({
      type: 'order.paid', data: { ...order, ...change },
    })).resolves.toEqual({ ok: true, ignored: true });
    expect(funnel.recordFirstPaidOrder).not.toHaveBeenCalled();
  });
});
