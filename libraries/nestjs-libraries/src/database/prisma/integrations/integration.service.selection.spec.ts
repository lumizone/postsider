import { HttpStatus } from '@nestjs/common';

jest.mock(
  '@postsider/nestjs-libraries/integrations/integration.manager',
  () => ({ IntegrationManager: class IntegrationManager {} })
);

import { IntegrationService } from './integration.service';

describe('IntegrationService two-step OAuth selection', () => {
  const stagedIntegration = {
    id: 'staged-channel',
    revision: 5,
    inBetweenSteps: true,
    token: 'oauth-access-token',
    providerIdentifier: 'linkedin-page',
  } as any;

  const createService = (completed: boolean) => {
    const repository = {
      getIntegrationById: jest.fn().mockResolvedValue(stagedIntegration),
      completeProviderPageIfCurrent: jest.fn().mockResolvedValue(completed),
    };
    const manager = {
      getSocialIntegration: jest.fn().mockReturnValue({
        fetchPageInformation: jest.fn().mockResolvedValue({
          id: 'selected-page',
          name: 'Selected page',
          picture: 'https://example.test/picture.jpg',
          access_token: 'selected-access-token',
          username: 'selected-page',
        }),
      }),
    };

    return { service: new IntegrationService(repository as any, manager as any, {} as any, {} as any, {} as any), repository };
  };

  it('persists the selected page only for the observed staged revision', async () => {
    const { service, repository } = createService(true);

    await expect(
      service.saveProviderPage('org-1', 'staged-channel', { page: 'selected-page' })
    ).resolves.toEqual({ success: true });

    expect(repository.completeProviderPageIfCurrent).toHaveBeenCalledWith(
      'org-1',
      'staged-channel',
      5,
      expect.objectContaining({
        internalId: 'selected-page',
        inBetweenSteps: false,
        token: 'selected-access-token',
      })
    );
  });

  it('rejects a second selection after the staged lifecycle has changed', async () => {
    const { service } = createService(false);

    await expect(
      service.saveProviderPage('org-1', 'staged-channel', { page: 'selected-page' })
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });

  it('uses revision CAS rather than reconnect upsert in the legacy refresh sweep', async () => {
    const integration = {
      id: 'channel-1',
      organizationId: 'org-1',
      revision: 7,
      rootInternalId: 'channel-1',
      refreshToken: 'old-refresh-token',
      providerIdentifier: 'youtube',
    } as any;
    const repository = {
      needsToBeRefreshed: jest.fn().mockResolvedValue([integration]),
      refreshSucceededIfCurrent: jest.fn().mockResolvedValue(false),
      createOrUpdateIntegration: jest.fn(),
    };
    const manager = {
      getSocialIntegration: jest.fn().mockReturnValue({ oneTimeToken: false }),
    };
    const service = new IntegrationService(
      repository as any,
      manager as any,
      {} as any,
      {} as any,
      {} as any
    );
    (service as any).refreshToken = jest.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 3600,
    });

    await service.refreshTokens();

    expect(repository.refreshSucceededIfCurrent).toHaveBeenCalledWith(
      'org-1',
      'channel-1',
      7,
      {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresIn: 3600,
      }
    );
    expect(repository.createOrUpdateIntegration).not.toHaveBeenCalled();
  });
});
