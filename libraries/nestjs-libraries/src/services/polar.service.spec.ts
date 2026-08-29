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
    subscriptions.deleteSubscriptionByOrganizationIdIfCurrent.mockResolvedValue({
      count: 1,
    });
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
    subscriptions.deleteSubscriptionByOrganizationIdIfCurrent.mockResolvedValue({
      count: 0,
    });

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
