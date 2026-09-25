import { PublicOrganizationController } from './public.organization.controller';

describe('PublicOrganizationController', () => {
  it('returns a stable, non-secret organization identity for connector auth tests', () => {
    const controller = new PublicOrganizationController();
    const organization = {
      id: 'org-1',
      name: 'PostSider Test',
      apiKey: 'sensitive-value',
      subscription: { subscriptionTier: 'STANDARD' },
    } as any;

    expect(controller.getOrganization(organization)).toEqual({
      id: 'org-1',
      name: 'PostSider Test',
      plan: 'STANDARD',
    });
  });

  it('reports FREE when billing has no subscription row', () => {
    const controller = new PublicOrganizationController();

    expect(
      controller.getOrganization({
        id: 'org-2',
        name: 'Self-hosted',
        subscription: null,
      } as any)
    ).toEqual({
      id: 'org-2',
      name: 'Self-hosted',
      plan: 'FREE',
    });
  });
});
