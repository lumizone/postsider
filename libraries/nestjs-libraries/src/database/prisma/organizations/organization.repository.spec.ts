import { OrganizationRepository } from './organization.repository';
import { LEGACY_PUBLIC_API_SCOPES } from '@postsider/nestjs-libraries/services/public-api-oauth-scopes';

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
  it('keeps legacy organization keys working without new webhook permissions', async () => {
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
      scopes: LEGACY_PUBLIC_API_SCOPES,
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

  describe('api-key limits', () => {
    const organization = { id: 'org-1', subscription: null };
    const resolve = async (row: Record<string, unknown>) => {
      const apiKeyFindFirst = jest.fn().mockResolvedValue({
        id: 'key-1',
        scopes: ['posts:write'],
        organization,
        ...row,
      });
      const repository = repositoryWithModels({
        organization: { findFirst: jest.fn().mockResolvedValue(null) },
        apiKey: { findFirst: apiKeyFindFirst },
      });
      const result: any = await repository.resolvePublicApiCredential('ps_x');
      return { result, apiKeyFindFirst };
    };

    it('selects both limit columns', async () => {
      const { apiKeyFindFirst } = await resolve({});
      const select = apiKeyFindFirst.mock.calls[0][0].select;
      expect(select.allowedActions).toBe(true);
      expect(select.allowedIntegrationIds).toBe(true);
    });

    it('returns keyPermissions when either list is non-empty', async () => {
      const a = await resolve({ allowedActions: ['DRAFT'], allowedIntegrationIds: [] });
      expect(a.result.keyPermissions).toEqual({
        allowedActions: ['DRAFT'],
        allowedIntegrationIds: [],
      });
      const b = await resolve({ allowedActions: [], allowedIntegrationIds: ['c1'] });
      expect(b.result.keyPermissions).toEqual({
        allowedActions: [],
        allowedIntegrationIds: ['c1'],
      });
    });

    it('returns no keyPermissions when both lists are empty', async () => {
      const { result } = await resolve({ allowedActions: [], allowedIntegrationIds: [] });
      expect(result.credentialType).toBe('api-key');
      expect(result.keyPermissions).toBeUndefined();
    });

    it('never returns keyPermissions for a legacy key', async () => {
      const repository = repositoryWithModels({
        organization: { findFirst: jest.fn().mockResolvedValue(organization) },
        apiKey: { findFirst: jest.fn() },
      });
      const result: any = await repository.resolvePublicApiCredential('legacy');
      expect(result.credentialType).toBe('legacy');
      expect(result).not.toHaveProperty('keyPermissions');
    });

    it('selects the limits in list, create and update results', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const create = jest.fn().mockResolvedValue({ id: 'k' });
      const update = jest.fn().mockResolvedValue({ id: 'k' });
      const repository = repositoryWithModels({ apiKey: { findMany, create, update } });
      await repository.listApiKeys('org-1');
      await repository.createApiKey('org-1', 'n', ['posts:write'] as any, {
        allowedActions: ['DRAFT'],
        allowedIntegrationIds: ['c1'],
      });
      await repository.updateNamedApiKey('org-1', 'k', { allowedActions: [] });
      for (const call of [findMany, create, update]) {
        const select = call.mock.calls[0][0].select;
        expect(select.allowedActions).toBe(true);
        expect(select.allowedIntegrationIds).toBe(true);
        expect(select).not.toHaveProperty('key');
      }
      expect(create.mock.calls[0][0].data).toMatchObject({
        allowedActions: ['DRAFT'],
        allowedIntegrationIds: ['c1'],
      });
      expect(update.mock.calls[0][0].data).toEqual({ allowedActions: [] });
    });
  });
});
