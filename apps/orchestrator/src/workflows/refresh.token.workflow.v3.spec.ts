const mockGetIntegrationsSafeById = jest.fn();
const mockRefreshTokenById = jest.fn();
const mockSleep = jest.fn();
const mockContinueAsNew = jest.fn();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest
    .fn()
    .mockReturnValueOnce({
      getIntegrationsSafeById: mockGetIntegrationsSafeById,
    })
    .mockReturnValueOnce({ refreshTokenById: mockRefreshTokenById }),
  sleep: mockSleep,
  continueAsNew: mockContinueAsNew,
}));

import { refreshTokenWorkflowV3 } from './refresh.token.workflow.v3';

describe('refreshTokenWorkflowV3', () => {
  const activeIntegration = {
    revision: 7,
    disabled: false,
    deletedAt: null,
    inBetweenSteps: false,
    refreshNeeded: false,
    tokenExpiration: new Date(0),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes the observed revision to the refresh activity', async () => {
    mockGetIntegrationsSafeById
      .mockResolvedValueOnce(activeIntegration)
      .mockResolvedValueOnce(activeIntegration);
    mockRefreshTokenById.mockResolvedValue(false);

    await expect(
      refreshTokenWorkflowV3({ organizationId: 'org-1', integrationId: 'id-1' })
    ).resolves.toBe(false);

    expect(mockRefreshTokenById).toHaveBeenCalledWith('org-1', 'id-1', 7);
  });

  it('exits before scheduling a refresh for a disabled integration', async () => {
    mockGetIntegrationsSafeById.mockResolvedValue({
      ...activeIntegration,
      disabled: true,
    });

    await expect(
      refreshTokenWorkflowV3({ organizationId: 'org-1', integrationId: 'id-1' })
    ).resolves.toBe(false);

    expect(mockRefreshTokenById).not.toHaveBeenCalled();
  });

  it('continues as new after a successful refresh to bound only V3 history', async () => {
    mockGetIntegrationsSafeById
      .mockResolvedValueOnce(activeIntegration)
      .mockResolvedValueOnce(activeIntegration);
    mockRefreshTokenById.mockResolvedValue(true);
    mockContinueAsNew.mockResolvedValue('continued');

    await expect(
      refreshTokenWorkflowV3({ organizationId: 'org-1', integrationId: 'id-1' })
    ).resolves.toBe('continued');

    expect(mockSleep).toHaveBeenCalledWith(60 * 1000);
    expect(mockContinueAsNew).toHaveBeenCalledWith({
      organizationId: 'org-1',
      integrationId: 'id-1',
    });
  });

  it('continues as new when a reconnect changes the revision during refresh', async () => {
    mockGetIntegrationsSafeById
      .mockResolvedValueOnce(activeIntegration)
      .mockResolvedValueOnce(activeIntegration)
      .mockResolvedValueOnce({ ...activeIntegration, revision: 8 });
    mockRefreshTokenById.mockResolvedValue(false);
    mockContinueAsNew.mockResolvedValue('continued-after-reconnect');

    await expect(
      refreshTokenWorkflowV3({ organizationId: 'org-1', integrationId: 'id-1' })
    ).resolves.toBe('continued-after-reconnect');

    expect(mockRefreshTokenById).toHaveBeenCalledWith('org-1', 'id-1', 7);
    expect(mockContinueAsNew).toHaveBeenCalledWith({
      organizationId: 'org-1',
      integrationId: 'id-1',
    });
  });
});
