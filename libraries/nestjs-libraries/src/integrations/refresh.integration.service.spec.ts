jest.mock(
  '@postsider/nestjs-libraries/integrations/integration.manager',
  () => ({ IntegrationManager: class IntegrationManager {} })
);
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class IntegrationService {} })
);

import { RefreshIntegrationService } from './refresh.integration.service';

describe('RefreshIntegrationService lifecycle CAS', () => {
  const integration = {
    id: 'channel-1',
    organizationId: 'org-1',
    revision: 7,
    providerIdentifier: 'youtube',
    refreshToken: 'old-refresh-token',
    rootInternalId: 'channel-1',
    internalId: 'channel-1',
  } as any;

  const createService = (providerRefresh: jest.Mock, oneTimeToken = false) => {
    const start = jest.fn().mockResolvedValue(undefined);
    const describe = jest.fn().mockRejectedValue(new Error('not found'));
    const terminate = jest.fn().mockResolvedValue(undefined);
    const getHandle = jest.fn().mockReturnValue({ describe, terminate });
    const integrationService = {
      refreshSucceededIfCurrent: jest.fn().mockResolvedValue(true),
      refreshFailedIfCurrent: jest.fn().mockResolvedValue(true),
      refreshLinkedTokensIfCurrent: jest.fn().mockResolvedValue(undefined),
      getLinkedTokenSiblingsForRefresh: jest.fn().mockResolvedValue([]),
      setBetweenRefreshStepsIfCurrent: jest.fn().mockResolvedValue(true),
      informAboutRefreshError: jest.fn().mockResolvedValue(undefined),
      getAllForRefreshArming: jest.fn().mockResolvedValue([]),
    };
    const manager = {
      getSocialIntegration: jest.fn().mockReturnValue({
        refreshToken: providerRefresh,
        oneTimeToken,
      }),
    };

    return {
      service: new RefreshIntegrationService(
        manager as any,
        integrationService as any,
        {
          client: { getRawClient: () => ({ workflow: { start, getHandle } }) },
        } as any
      ),
      integrationService,
      start,
      describe,
      terminate,
    };
  };

  it('persists a refreshed token through the current-revision CAS', async () => {
    const refreshed = {
      id: 'provider-id',
      name: 'Channel',
      username: 'channel',
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 3600,
    };
    const { service, integrationService } = createService(
      jest.fn().mockResolvedValue(refreshed)
    );

    await expect(service.refresh(integration)).resolves.toEqual(refreshed);

    expect(integrationService.refreshSucceededIfCurrent).toHaveBeenCalledWith(
      'org-1',
      'channel-1',
      7,
      refreshed
    );
    expect(integrationService.refreshFailedIfCurrent).not.toHaveBeenCalled();
  });

  it('only notifies when this revision wins the failure CAS', async () => {
    const { service, integrationService } = createService(
      jest.fn().mockResolvedValue(false)
    );

    await expect(
      service.refreshWithLifecycle(integration, 'expired')
    ).resolves.toEqual({ status: 'failed' });

    expect(integrationService.refreshFailedIfCurrent).toHaveBeenCalledWith(
      'org-1',
      'channel-1',
      7
    );
    expect(integrationService.informAboutRefreshError).toHaveBeenCalledWith(
      'org-1',
      integration,
      'expired'
    );
  });

  it('reports a stale lifecycle instead of a refresh failure when its CAS loses', async () => {
    const { service, integrationService } = createService(
      jest.fn().mockResolvedValue(false)
    );
    integrationService.refreshFailedIfCurrent.mockResolvedValue(false);

    await expect(service.refreshWithLifecycle(integration, 'expired')).resolves.toEqual({
      status: 'stale',
    });

    expect(integrationService.informAboutRefreshError).not.toHaveBeenCalled();
  });

  it('reports a stale lifecycle when refreshed credentials lose the final CAS', async () => {
    const refreshed = {
      id: 'provider-id',
      name: 'Channel',
      username: 'channel',
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 3600,
    };
    const { service, integrationService } = createService(
      jest.fn().mockResolvedValue(refreshed)
    );
    integrationService.refreshSucceededIfCurrent.mockResolvedValue(false);

    await expect(service.refreshWithLifecycle(integration)).resolves.toEqual({
      status: 'stale',
    });
  });

  it('synchronizes current linked channels for one-time provider credentials', async () => {
    const refreshed = {
      id: 'provider-id',
      name: 'Channel',
      username: 'channel',
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresIn: 3600,
    };
    const { service, integrationService } = createService(
      jest.fn().mockResolvedValue(refreshed),
      true
    );

    await expect(service.refresh(integration)).resolves.toEqual(refreshed);

    expect(
      integrationService.refreshLinkedTokensIfCurrent
    ).toHaveBeenCalledWith(
      'org-1',
      'channel-1',
      'channel-1',
      'old-refresh-token',
      [],
      refreshed
    );
  });

  it('does not mark or notify a channel when a stale exception CAS loses', async () => {
    const { service, integrationService } = createService(
      jest.fn().mockResolvedValue(false)
    );
    integrationService.setBetweenRefreshStepsIfCurrent.mockResolvedValue(false);

    await expect(service.setBetweenSteps(integration, 'provider error')).resolves.toBe(
      false
    );

    expect(integrationService.setBetweenRefreshStepsIfCurrent).toHaveBeenCalledWith(
      'org-1',
      'channel-1',
      7
    );
    expect(integrationService.informAboutRefreshError).not.toHaveBeenCalled();
  });

  it('keeps a running refresh workflow alive during bootstrap re-arm', async () => {
    const { service, integrationService, start } = createService(
      jest.fn().mockResolvedValue(false)
    );
    integrationService.getAllForRefreshArming.mockResolvedValue([
      {
        id: 'channel-1',
        organizationId: 'org-1',
        refreshToken: 'refresh-token',
      },
    ]);

    await service.reArmAllRefreshWorkflows();

    expect(start).toHaveBeenCalledWith('refreshTokenWorkflowV3', {
      workflowId: 'refresh_channel-1',
      args: [{ integrationId: 'channel-1', organizationId: 'org-1' }],
      taskQueue: 'main',
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    });
  });

  it.each(['refreshTokenWorkflow', 'refreshTokenWorkflowV2', 'refreshTokenWorkflowV3'])(
    'leaves a running %s workflow untouched during bootstrap',
    async (type) => {
      const { service, integrationService, start, describe, terminate } =
        createService(jest.fn().mockResolvedValue(false));
      describe.mockResolvedValue({
        status: { name: 'RUNNING' },
        type,
      });
      integrationService.getAllForRefreshArming.mockResolvedValue([
        {
          id: 'channel-1',
          organizationId: 'org-1',
          refreshToken: 'refresh-token',
        },
      ]);

      await service.reArmAllRefreshWorkflows();

      expect(terminate).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    }
  );

  it.each(['refreshTokenWorkflow', 'refreshTokenWorkflowV2'])(
    'does not terminate a running %s workflow when starting refresh after reconnect',
    async (type) => {
      const { service, start, describe, terminate } = createService(
        jest.fn().mockResolvedValue(false)
      );
      describe.mockResolvedValue({ status: { name: 'RUNNING' }, type });

      await expect(
        service.startRefreshWorkflow('org-1', 'channel-1', true)
      ).resolves.toBe(true);

      expect(terminate).not.toHaveBeenCalled();
      expect(start).not.toHaveBeenCalled();
    }
  );

  it('re-arms a closed V2 workflow as V3 without terminating it', async () => {
    const { service, integrationService, start, describe, terminate } =
      createService(jest.fn().mockResolvedValue(false));
    describe.mockResolvedValue({
      status: { name: 'COMPLETED' },
      type: 'refreshTokenWorkflowV2',
    });
    integrationService.getAllForRefreshArming.mockResolvedValue([
      {
        id: 'channel-1',
        organizationId: 'org-1',
        refreshToken: 'refresh-token',
      },
    ]);

    await service.reArmAllRefreshWorkflows();

    expect(terminate).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith('refreshTokenWorkflowV3', {
      workflowId: 'refresh_channel-1',
      args: [{ integrationId: 'channel-1', organizationId: 'org-1' }],
      taskQueue: 'main',
      workflowIdConflictPolicy: 'USE_EXISTING',
      workflowIdReusePolicy: 'ALLOW_DUPLICATE',
    });
  });
});
