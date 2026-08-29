import { SubscriptionService } from './subscription.service';

describe('SubscriptionService team member lifecycle', () => {
  function createService(subscriptionTier: string) {
    const repository = {
      getSubscriptionByOrgId: jest.fn().mockResolvedValue({ subscriptionTier }),
    };
    const integrations = {
      disableIntegrations: jest.fn().mockResolvedValue(undefined),
    };
    const organizations = {
      disableOrEnableNonSuperAdminUsers: jest.fn().mockResolvedValue(undefined),
    };

    return {
      service: new SubscriptionService(
        repository as any,
        integrations as any,
        organizations as any
      ),
      organizations,
    };
  }

  it('disables non-owner users when a team plan is downgraded to STANDARD', async () => {
    const { service, organizations } = createService('TEAM');

    await service.modifySubscriptionByOrg('org-1', 5, 'STANDARD');

    expect(organizations.disableOrEnableNonSuperAdminUsers).toHaveBeenCalledWith(
      'org-1',
      true
    );
  });

  it('re-enables non-owner users when team entitlement is reactivated', async () => {
    const { service, organizations } = createService('STANDARD');

    await service.modifySubscriptionByOrg('org-1', 10, 'TEAM');

    expect(organizations.disableOrEnableNonSuperAdminUsers).toHaveBeenCalledWith(
      'org-1',
      false
    );
  });

  it('re-enables non-owner users when a team plan is re-subscribed to the same team tier', async () => {
    const repository = {
      getSubscriptionByOrgId: jest
        .fn()
        .mockResolvedValue({ subscriptionTier: 'TEAM' }),
      getOrganizationByCustomerId: jest
        .fn()
        .mockResolvedValue({ id: 'org-1' }),
      createOrUpdateSubscription: jest.fn().mockResolvedValue({ id: 'sub-1' }),
    };
    const organizations = {
      disableOrEnableNonSuperAdminUsers: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SubscriptionService(
      repository as any,
      {} as any,
      organizations as any
    );

    await service.createOrUpdateSubscription(
      false,
      'polar-sub-2',
      'customer-1',
      10,
      'TEAM',
      'MONTHLY',
      null,
      undefined,
      'org-1'
    );

    expect(
      organizations.disableOrEnableNonSuperAdminUsers
    ).toHaveBeenCalledWith('org-1', false);
  });

  it('does not re-enable seats when the upserted tier has no team entitlement', async () => {
    const repository = {
      getSubscriptionByOrgId: jest
        .fn()
        .mockResolvedValue({ subscriptionTier: 'FREE' }),
      getOrganizationByCustomerId: jest
        .fn()
        .mockResolvedValue({ id: 'org-1' }),
      createOrUpdateSubscription: jest.fn().mockResolvedValue({ id: 'sub-2' }),
    };
    const organizations = {
      disableOrEnableNonSuperAdminUsers: jest.fn().mockResolvedValue(undefined),
    };
    const service = new SubscriptionService(
      repository as any,
      {} as any,
      organizations as any
    );

    await service.createOrUpdateSubscription(
      false,
      'polar-sub-3',
      'customer-1',
      5,
      'STANDARD',
      'MONTHLY',
      null,
      undefined,
      'org-1'
    );

    expect(
      organizations.disableOrEnableNonSuperAdminUsers
    ).not.toHaveBeenCalled();
  });
});
