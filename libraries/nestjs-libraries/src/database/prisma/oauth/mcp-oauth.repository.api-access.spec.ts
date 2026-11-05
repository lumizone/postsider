import { McpOAuthRepository } from './mcp-oauth.repository';

describe('McpOAuthRepository.findActiveAccessForApi', () => {
  it('returns the grant id, client id and authorizing user for the API actor', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      grant: {
        id: 'g1',
        mcpOAuthClientId: 'mc1',
        userId: 'u7',
        organizationId: 'org-1',
        organization: { id: 'org-1' },
        scopes: ['posts:read'],
        revokedAt: null,
      },
    });
    const membership = { userId: 'u7', role: 'USER', disabled: false };
    const access = { model: { mcpOAuthAccessToken: { findFirst } } };
    const userOrg = { model: { userOrganization: { findFirst: jest.fn().mockResolvedValue(membership) } } };
    const repo = new McpOAuthRepository(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      access as any,
      {} as any,
      userOrg as any
    );

    const result = await repo.findActiveAccessForApi('h');

    expect(result).toMatchObject({
      mcpOAuthGrantId: 'g1',
      mcpOAuthClientId: 'mc1',
      userId: 'u7',
    });
  });
});
