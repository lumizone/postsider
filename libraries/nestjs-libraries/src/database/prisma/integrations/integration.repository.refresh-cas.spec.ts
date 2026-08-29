import {
  ChannelCapacityExceededError,
  IntegrationRepository,
} from './integration.repository';

describe('IntegrationRepository refresh compare-and-swap', () => {
  const createRepository = (count = 1) => {
    const integration = {
      model: {
        integration: {
          updateMany: jest.fn().mockResolvedValue({ count }),
        },
      },
    };

    return {
      repository: new IntegrationRepository(
        integration as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any
      ),
      updateMany: integration.model.integration.updateMany,
    };
  };

  const currentChannel = {
    id: 'channel-1',
    organizationId: 'org-1',
    revision: 7,
    disabled: false,
    deletedAt: null,
    inBetweenSteps: false,
    refreshNeeded: false,
  };

  it('writes refreshed credentials only when the original active revision remains current', async () => {
    const { repository, updateMany } = createRepository();

    await expect(
      repository.refreshSucceededIfCurrent('org-1', 'channel-1', 7, {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
      })
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: currentChannel,
      data: {
        token: 'access-token',
        refreshToken: 'refresh-token',
        tokenExpiration: expect.any(Date),
        revision: { increment: 1 },
      },
    });
  });

  it('does not mark a newer, disabled, or disconnected channel as needing refresh', async () => {
    const { repository, updateMany } = createRepository(0);

    await expect(
      repository.refreshFailedIfCurrent('org-1', 'channel-1', 7)
    ).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith({
      where: currentChannel,
      data: { refreshNeeded: true, revision: { increment: 1 } },
    });
  });

  it('does not strand a newer channel between refresh steps', async () => {
    const { repository, updateMany } = createRepository(0);

    await expect(
      repository.setBetweenRefreshStepsIfCurrent('org-1', 'channel-1', 7)
    ).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith({
      where: currentChannel,
      data: { inBetweenSteps: true, revision: { increment: 1 } },
    });
  });

  it('does not let the legacy refresh sweep revive a deleted channel', async () => {
    const { repository, updateMany } = createRepository(0);

    await expect(
      repository.refreshSucceededIfCurrent('org-1', 'channel-1', 7, {
        accessToken: 'access-token',
      })
    ).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          revision: 7,
          deletedAt: null,
          disabled: false,
        }),
      })
    );
  });

  it('does not let an extension refresh revive a disabled or deleted channel', async () => {
    const { repository, updateMany } = createRepository(0);

    await expect(
      repository.refreshExtensionCredentialsIfCurrent(
        'org-1',
        'channel-1',
        7,
        'extension-access-token',
        3600,
        'encrypted-cookies'
      )
    ).resolves.toBe(false);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'channel-1',
        organizationId: 'org-1',
        revision: 7,
        disabled: false,
        deletedAt: null,
      },
      data: {
        token: 'extension-access-token',
        tokenExpiration: expect.any(Date),
        customInstanceDetails: 'encrypted-cookies',
        refreshNeeded: false,
        revision: { increment: 1 },
      },
    });
  });

  it('synchronizes one-time-token siblings only at the observed revision', async () => {
    const { repository, updateMany } = createRepository();

    await repository.refreshLinkedTokensIfCurrent(
      'org-1',
      'channel-1',
      'account-1',
      'old-refresh-token',
      [{ id: 'sibling-1', revision: 4 }],
      {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
      }
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        OR: [{ id: 'sibling-1', revision: 4 }],
        organizationId: 'org-1',
        rootInternalId: 'account-1',
        disabled: false,
        deletedAt: null,
        inBetweenSteps: false,
        refreshNeeded: false,
      },
      data: {
        token: 'access-token',
        refreshToken: 'refresh-token',
        tokenExpiration: expect.any(Date),
        refreshNeeded: false,
        revision: { increment: 1 },
      },
    });
  });

  it('does not query randomized encrypted refresh tokens by plaintext', async () => {
    const integration = {
      model: {
        integration: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'same-token', revision: 4, refreshToken: 'old-refresh-token' },
            { id: 'reconnected', revision: 5, refreshToken: 'new-refresh-token' },
          ]),
        },
      },
    };
    const repository = new IntegrationRepository(
      integration as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await expect(
      repository.getLinkedTokenSiblingsForRefresh(
        'org-1',
        'channel-1',
        'account-1',
        'old-refresh-token'
      )
    ).resolves.toEqual([{ id: 'same-token', revision: 4 }]);

    expect(integration.model.integration.findMany).toHaveBeenCalledWith({
      where: {
        id: { not: 'channel-1' },
        organizationId: 'org-1',
        rootInternalId: 'account-1',
        disabled: false,
        deletedAt: null,
        inBetweenSteps: false,
        refreshNeeded: false,
      },
      select: { id: true, revision: true, refreshToken: true },
    });
  });

  it('requires the sibling revision observed before the provider refresh', async () => {
    const { repository, updateMany } = createRepository();

    await repository.refreshLinkedTokensIfCurrent(
      'org-1',
      'channel-1',
      'account-1',
      'old-refresh-token',
      [{ id: 'sibling-1', revision: 4 }],
      { accessToken: 'access-token' }
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ id: 'sibling-1', revision: 4 }],
        }),
      })
    );
  });

  it('does not mutate a duplicate selection when the staged revision lost', async () => {
    const tx = {
      integration: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      post: { updateMany: jest.fn() },
    };
    const transaction = {
      model: { $transaction: jest.fn((callback) => callback(tx)) },
    };
    const repository = new IntegrationRepository(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      transaction as any
    );

    await expect(
      repository.completeProviderPageIfCurrent('org-1', 'staged-channel', 7, {
        organizationId: 'org-1',
        internalId: 'selected-page',
      } as any)
    ).resolves.toBe(false);

    expect(tx.integration.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'staged-channel',
        organizationId: 'org-1',
        revision: 7,
        inBetweenSteps: true,
        disabled: false,
        deletedAt: null,
        refreshNeeded: false,
      },
      data: { revision: { increment: 1 } },
    });
    expect(tx.integration.findUnique).not.toHaveBeenCalled();
  });

  const createCapacityRepository = (
    existing: { deletedAt: Date | null; disabled: boolean } | null,
    activeChannels = 0
  ) => {
    const tx = {
      $executeRaw: jest.fn(),
      integration: {
        findUnique: jest.fn().mockResolvedValue(existing),
        count: jest.fn().mockResolvedValue(activeChannels),
        findMany: jest.fn().mockResolvedValue([{ id: 'channel-1' }]),
        upsert: jest.fn().mockResolvedValue({ id: 'channel-1' }),
        findFirst: jest.fn().mockResolvedValue({ rootInternalId: 'account-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({ id: 'channel-1' }),
      },
      subscription: {
        findFirst: jest.fn().mockResolvedValue({
          totalChannels: 1,
          identifier: 'subscription-1',
          cancelAt: null,
        }),
      },
    };
    const transaction = {
      model: { $transaction: jest.fn((callback) => callback(tx)) },
    };
    const repository = new IntegrationRepository(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      transaction as any
    );

    return { repository, tx, transaction };
  };

  const createWithCapacity = (repository: IntegrationRepository, limit: number) =>
    repository.createOrUpdateIntegration(
      undefined,
      false,
      'org-1',
      'Channel',
      undefined,
      'social',
      'platform-1',
      'x',
      'access-token',
      '',
      3600,
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      limit,
      true
    );

  it('serializes and rejects a new or resurrected channel at the active limit', async () => {
    const { repository, tx } = createCapacityRepository(
      { deletedAt: new Date(), disabled: false },
      1
    );

    // The request observed a stale paid-plan limit, but the lock-protected
    // entitlement has already been downgraded to one channel.
    await expect(createWithCapacity(repository, 50)).rejects.toBeInstanceOf(
      ChannelCapacityExceededError
    );

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.integration.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', deletedAt: null, disabled: false },
    });
    expect(tx.subscription.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', deletedAt: null },
      select: { totalChannels: true, identifier: true, cancelAt: true },
    });
    expect(tx.integration.upsert).not.toHaveBeenCalled();
  });

  it('does not consume capacity when reconnecting an already active channel', async () => {
    const { repository, tx } = createCapacityRepository({
      deletedAt: null,
      disabled: false,
    });

    await expect(createWithCapacity(repository, 1)).resolves.toEqual({
      id: 'channel-1',
    });

    expect(tx.integration.count).not.toHaveBeenCalled();
    expect(tx.integration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ disabled: false, deletedAt: null }),
      })
    );
  });

  it('treats an expired trial as FREE while holding the capacity lock', async () => {
    const { repository, tx } = createCapacityRepository(null, 0);
    tx.subscription.findFirst.mockResolvedValue({
      totalChannels: 5,
      identifier: 'trial',
      cancelAt: new Date(Date.now() - 1),
    });

    await expect(createWithCapacity(repository, 5)).rejects.toBeInstanceOf(
      ChannelCapacityExceededError
    );

    expect(tx.integration.upsert).not.toHaveBeenCalled();
  });

  it('treats an expired trial as FREE when enabling under the capacity lock', async () => {
    const { repository, tx } = createCapacityRepository(null, 0);
    tx.integration.findFirst.mockResolvedValue({
      deletedAt: null,
      disabled: true,
    });
    tx.subscription.findFirst.mockResolvedValue({
      totalChannels: 5,
      identifier: 'trial',
      cancelAt: new Date(Date.now() - 1),
    });

    await expect(
      repository.enableChannel('org-1', 'channel-1', 5)
    ).rejects.toBeInstanceOf(ChannelCapacityExceededError);

    expect(tx.integration.update).not.toHaveBeenCalled();
  });

  it('serializes enable and counts only canonical active channels', async () => {
    const { repository, tx } = createCapacityRepository(null, 1);
    tx.integration.findFirst.mockResolvedValue({
      deletedAt: null,
      disabled: true,
    });

    await expect(
      repository.enableChannel('org-1', 'channel-1', 50)
    ).rejects.toBeInstanceOf(ChannelCapacityExceededError);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.integration.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', deletedAt: null, disabled: false },
    });
    expect(tx.integration.update).not.toHaveBeenCalled();
  });

  it('uses the same lock to reduce active channels to a new plan limit', async () => {
    const { repository, tx } = createCapacityRepository(null, 3);

    await expect(repository.disableIntegrations('org-1', 2)).resolves.toEqual({
      count: 1,
    });

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.integration.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', disabled: false, deletedAt: null },
      take: 1,
      select: { id: true },
    });
    expect(tx.integration.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['channel-1'] } },
      data: { disabled: true, revision: { increment: 1 } },
    });
  });
});
