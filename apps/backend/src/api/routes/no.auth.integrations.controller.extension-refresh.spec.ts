jest.mock('@postsider/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('@postsider/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class IntegrationService {} })
);
jest.mock(
  '@postsider/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class RefreshIntegrationService {} })
);
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class OrganizationService {} })
);
jest.mock('@postsider/backend/services/auth/permissions/permissions.service', () => ({
  PermissionsService: class PermissionsService {},
}));
jest.mock('@postsider/backend/services/auth/permissions/permissions.ability', () => ({
  CheckPolicies: () => () => undefined,
}));
jest.mock('@postsider/helpers/auth/auth.service', () => ({
  AuthService: { verifyJWT: jest.fn(), encryptSecret: jest.fn() },
}));
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/integrations/integration.repository',
  () => ({ ChannelCapacityExceededError: class ChannelCapacityExceededError {} })
);

import { AuthService } from '@postsider/helpers/auth/auth.service';
import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

describe('NoAuthIntegrationsController extension refresh', () => {
  it('uses the authenticated revision CAS before flagging an account mismatch', async () => {
    const integrationService = {
      getIntegrationById: jest.fn().mockResolvedValue({
        id: 'channel-1',
        organizationId: 'org-1',
        internalId: 'account-1',
        revision: 7,
        disabled: false,
        deletedAt: null,
      }),
      refreshFailedIfCurrent: jest.fn().mockResolvedValue(false),
      refreshNeeded: jest.fn(),
    };
    const controller = new NoAuthIntegrationsController(
      {
        getSocialIntegration: jest.fn().mockReturnValue({
          isChromeExtension: true,
          authenticate: jest.fn().mockResolvedValue({ id: 'account-2' }),
        }),
      } as any,
      integrationService as any,
      {} as any,
      {} as any,
      {} as any
    );
    (AuthService.verifyJWT as jest.Mock).mockReturnValue({
      integrationId: 'channel-1',
      organizationId: 'org-1',
      internalId: 'account-1',
      provider: 'extension-provider',
    });

    await expect(
      controller.extensionRefreshCookies({ jwt: 'extension-jwt', cookies: 'cookies' })
    ).resolves.toEqual({ success: false, reason: 'account_mismatch' });

    expect(integrationService.refreshFailedIfCurrent).toHaveBeenCalledWith(
      'org-1',
      'channel-1',
      7
    );
    expect(integrationService.refreshNeeded).not.toHaveBeenCalled();
  });
});
