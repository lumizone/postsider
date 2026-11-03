import { OrganizationRepository } from './organization.repository';

function repositoryWithModels(models: Record<string, unknown>) {
  const prismaRepository = { model: models } as any;
  return new OrganizationRepository(
    prismaRepository,
    {} as any,
    {} as any,
    {} as any
  );
}

describe('OrganizationRepository public API credentials', () => {
  it('keeps legacy organization keys working with wildcard access', async () => {
    const legacyOrganization = { id: 'org-legacy', subscription: null };
    const apiKeyFindFirst = jest.fn();
    const repository = repositoryWithModels({
      organization: {
        findFirst: jest.fn().mockResolvedValue(legacyOrganization),
      },
      apiKey: { findFirst: apiKeyFindFirst },
    });

    await expect(
      repository.resolvePublicApiCredential('legacy-key')
    ).resolves.toEqual({
      organization: legacyOrganization,
      scopes: ['*'],
      credentialType: 'legacy',
    });
    expect(apiKeyFindFirst).not.toHaveBeenCalled();
  });

  it('resolves an active named key with only its stored scopes', async () => {
    const organization = { id: 'org-scoped', subscription: null };
    const apiKeyFindFirst = jest.fn().mockResolvedValue({
      id: 'key-1',
      scopes: ['organization:read', 'posts:read'],
      organization,
    });
    const repository = repositoryWithModels({
      organization: { findFirst: jest.fn().mockResolvedValue(null) },
      apiKey: { findFirst: apiKeyFindFirst },
    });

    await expect(
      repository.resolvePublicApiCredential('ps_scoped')
    ).resolves.toEqual({
      organization,
      scopes: ['organization:read', 'posts:read'],
      credentialType: 'api-key',
      apiKeyId: 'key-1',
    });
    expect(apiKeyFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  it('updates a named key only inside its organization and keeps the raw key hidden', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'key-1',
      name: 'Zapier',
      scopes: ['posts:read'],
      createdAt: new Date('2026-09-25T00:00:00.000Z'),
    });
    const repository = repositoryWithModels({
      organization: {},
      apiKey: { update },
    });

    const result = await repository.updateNamedApiKey('org-1', 'key-1', {
      scopes: ['posts:read'],
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'key-1', organizationId: 'org-1', deletedAt: null },
        data: { scopes: ['posts:read'] },
      })
    );
    expect(result).not.toHaveProperty('key');
  });

  it('creates a named key with explicit scopes and returns the raw value only once', async () => {
    const create = jest.fn().mockImplementation(async ({ data }) => ({
      id: 'key-2',
      name: data.name,
      scopes: data.scopes,
      createdAt: new Date('2026-09-25T00:00:00.000Z'),
    }));
    const repository = repositoryWithModels({
      organization: {},
      apiKey: { create },
    });

    const created = await repository.createApiKey('org-1', 'n8n', [
      'organization:read',
      'posts:read',
    ]);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'n8n',
          scopes: ['organization:read', 'posts:read'],
          organization: { connect: { id: 'org-1' } },
        }),
      })
    );
    expect(created.key).toMatch(/^ps_/);
    expect(create.mock.calls[0][0].data.key).not.toBe(created.key);
  });
});
