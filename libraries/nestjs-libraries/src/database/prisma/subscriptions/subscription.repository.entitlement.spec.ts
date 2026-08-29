import { SubscriptionRepository } from './subscription.repository';

describe('SubscriptionRepository channel entitlement', () => {
  it('persists a downgraded entitlement and disables excess channels under one org lock', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      subscription: {
        upsert: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
      },
      integration: {
        count: jest.fn().mockResolvedValue(3),
        findMany: jest.fn().mockResolvedValue([{ id: 'channel-1' }, { id: 'channel-2' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      organization: { update: jest.fn().mockResolvedValue(undefined) },
      usedCodes: { create: jest.fn().mockResolvedValue(undefined) },
    };
    const organization = {
      model: {
        organization: {
          findFirst: jest.fn().mockResolvedValue({ id: 'org-1' }),
        },
      },
    };
    const repository = new SubscriptionRepository(
      {} as any,
      organization as any,
      {} as any,
      {} as any,
      {} as any,
      { $transaction: jest.fn((callback) => callback(tx)) } as any
    );

    await repository.createOrUpdateSubscription(
      false,
      'subscription-1',
      'customer-1',
      1,
      'STANDARD',
      'MONTHLY',
      null
    );

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ totalChannels: 1 }),
      })
    );
    expect(tx.integration.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['channel-1', 'channel-2'] } },
      data: { disabled: true, revision: { increment: 1 } },
    });
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.subscription.upsert.mock.invocationCallOrder[0]
    );
    expect(tx.subscription.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      tx.integration.updateMany.mock.invocationCallOrder[0]
    );
  });

  it.each(['TEAM', 'PRO', 'ULTIMATE'])(
    'atomically revokes %s seats with the locked FREE entitlement and channel disable',
    async (subscriptionTier) => {
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(undefined),
        subscription: {
          findFirst: jest.fn().mockResolvedValue({ subscriptionTier }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        integration: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
        userOrganization: {
          updateMany: jest.fn().mockResolvedValue({ count: 2 }),
        },
      };
      const repository = new SubscriptionRepository(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { $transaction: jest.fn((callback) => callback(tx)) } as any
      );

      await repository.deleteSubscriptionByOrgId('org-1');

      expect(tx.subscription.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', isLifetime: false },
      });
      expect(tx.integration.updateMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', deletedAt: null, disabled: false },
        data: { disabled: true, revision: { increment: 1 } },
      });
      expect(tx.userOrganization.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: 'org-1',
          role: { not: 'SUPERADMIN' },
        },
        data: { disabled: true },
      });
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.subscription.deleteMany.mock.invocationCallOrder[0]
      );
      expect(tx.subscription.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.integration.updateMany.mock.invocationCallOrder[0]
      );
      expect(tx.integration.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.userOrganization.updateMany.mock.invocationCallOrder[0]
      );
    }
  );

  it('keeps non-owner memberships enabled when STANDARD is cancelled', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      subscription: {
        findFirst: jest.fn().mockResolvedValue({ subscriptionTier: 'STANDARD' }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      integration: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      userOrganization: { updateMany: jest.fn() },
    };
    const repository = new SubscriptionRepository(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { $transaction: jest.fn((callback) => callback(tx)) } as any
    );

    await repository.deleteSubscriptionByOrgId('org-1');

    expect(tx.userOrganization.updateMany).not.toHaveBeenCalled();
  });

  it('does not revoke access when a terminal event targets a replaced subscription', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      subscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      integration: { updateMany: jest.fn() },
      userOrganization: { updateMany: jest.fn() },
    };
    const repository = new SubscriptionRepository(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { $transaction: jest.fn((callback) => callback(tx)) } as any
    );

    await expect(
      repository.deleteSubscriptionByOrgIdIfCurrent('org-1', 'old-subscription')
    ).resolves.toEqual({ count: 0 });

    expect(tx.subscription.deleteMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        isLifetime: false,
        identifier: 'old-subscription',
        deletedAt: null,
      },
    });
    expect(tx.integration.updateMany).not.toHaveBeenCalled();
    expect(tx.userOrganization.updateMany).not.toHaveBeenCalled();
  });
});
