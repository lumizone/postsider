jest.mock(
  '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class SubscriptionService {} })
);
jest.mock('@postsider/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class PostsService {},
}));
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class IntegrationService {} })
);
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/webhooks/webhooks.service',
  () => ({ WebhooksService: class WebhooksService {} })
);

import { PermissionsService } from './permissions.service';
import {
  AuthorizationActions,
  Sections,
} from './permission.exception.class';

describe('PermissionsService team member entitlement', () => {
  const originalPolarAccessToken = process.env.POLAR_ACCESS_TOKEN;

  beforeAll(() => {
    process.env.POLAR_ACCESS_TOKEN = 'test-token';
  });

  afterAll(() => {
    if (originalPolarAccessToken === undefined) {
      delete process.env.POLAR_ACCESS_TOKEN;
    } else {
      process.env.POLAR_ACCESS_TOKEN = originalPolarAccessToken;
    }
  });

  it.each(['FREE', 'STANDARD'])('denies team members on %s', async (tier) => {
    const service = new PermissionsService(
      {
        getSubscriptionByOrganizationId: jest.fn().mockResolvedValue({
          subscriptionTier: tier,
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any
    );

    const ability = await service.check(
      'org-1',
      new Date(),
      'ADMIN',
      [[AuthorizationActions.Create, Sections.TEAM_MEMBERS]]
    );

    expect(ability.can(AuthorizationActions.Create, Sections.TEAM_MEMBERS)).toBe(false);
  });

  it.each(['TEAM', 'PRO', 'ULTIMATE', 'SAMURAI'])(
    'grants unlimited team members on %s',
    async (tier) => {
      const service = new PermissionsService(
        {
          getSubscriptionByOrganizationId: jest.fn().mockResolvedValue({
            subscriptionTier: tier,
          }),
        } as any,
        {} as any,
        {} as any,
        {} as any
      );

      const ability = await service.check(
        'org-1',
        new Date(),
        'ADMIN',
        [[AuthorizationActions.Create, Sections.TEAM_MEMBERS]]
      );

      expect(ability.can(AuthorizationActions.Create, Sections.TEAM_MEMBERS)).toBe(true);
    }
  );
});
