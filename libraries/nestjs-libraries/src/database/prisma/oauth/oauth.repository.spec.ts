import { OAuthRepository } from './oauth.repository';

describe('OAuthRepository access-token membership', () => {
  const authorization = {
    id: 'authorization-1',
    userId: 'user-1',
    organizationId: 'org-1',
    organization: { id: 'org-1' },
    user: { id: 'user-1' },
  };

  const createRepository = (membership: object | null) => {
    const findAuthorization = jest.fn().mockResolvedValue(authorization);
    const findMembership = jest.fn().mockResolvedValue(membership);
    const repository = new OAuthRepository(
      {} as any,
      {
        model: {
          oAuthAuthorization: { findFirst: findAuthorization },
        },
      } as any,
      {
        model: {
          userOrganization: { findFirst: findMembership },
        },
      } as any
    );

    return { repository, findMembership };
  };

  it('returns the current active membership with the authorization', async () => {
    const membership = { userId: 'user-1', role: 'ADMIN', disabled: false };
    const { repository, findMembership } = createRepository(membership);

    await expect(repository.findByAccessToken('encrypted')).resolves.toEqual({
      ...authorization,
      membership,
    });
    expect(findMembership).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        organizationId: 'org-1',
        disabled: false,
        user: { activated: true },
      },
      select: { userId: true, role: true, disabled: true },
    });
  });

  it('rejects a token when the authorizing membership is absent or disabled', async () => {
    const { repository } = createRepository(null);

    await expect(repository.findByAccessToken('encrypted')).resolves.toBeNull();
  });
});
