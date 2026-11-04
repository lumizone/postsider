import { PublicAuthMiddleware } from './public.auth.middleware';
import { currentActor, currentKeyPermissions } from '@postsider/nestjs-libraries/actor/actor-context';
import { LEGACY_PUBLIC_API_SCOPES } from '@postsider/nestjs-libraries/services/public-api-oauth-scopes';

describe('PublicAuthMiddleware credentials', () => {
  const originalPolarAccessToken = process.env.POLAR_ACCESS_TOKEN;

  beforeEach(() => {
    delete process.env.POLAR_ACCESS_TOKEN;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalPolarAccessToken === undefined) {
      delete process.env.POLAR_ACCESS_TOKEN;
    } else {
      process.env.POLAR_ACCESS_TOKEN = originalPolarAccessToken;
    }
  });

  const response = () => {
    const res = {
      status: jest.fn(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.setHeader.mockReturnValue(res);
    return res;
  };

  it.each([
    ['Bearer pos_standard', 'pos_standard'],
    ['pos_raw', 'pos_raw'],
  ])(
    'authenticates OAuth credential %s and uses its current role',
    async (header, token) => {
      const membership = { userId: 'user-1', role: 'ADMIN', disabled: false };
      const oauth = {
        getOrgByOAuthToken: jest.fn().mockResolvedValue({
          organization: { id: 'org-1', subscription: null },
          membership,
        }),
      };
      const organizations = { getOrgByApiKey: jest.fn() };
      const middleware = new PublicAuthMiddleware(
        organizations as any,
        oauth as any
      );
      const req = { headers: { authorization: header } } as any;
      const next = jest.fn();

      await middleware.use(req, response() as any, next);

      expect(oauth.getOrgByOAuthToken).toHaveBeenCalledWith(token);
      expect(organizations.getOrgByApiKey).not.toHaveBeenCalled();
      expect(req.org.users).toEqual([membership]);
      expect(req.publicApiScopes).toEqual(LEGACY_PUBLIC_API_SCOPES);
      expect(req.publicApiCredential).toEqual({ type: 'oauth' });
      expect(next).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    [['posts:read'], ['posts:read', 'channels:read', 'analytics:read', 'organization:read'], 'GET', '/public/v1/posts'],
    [['posts:write'], ['posts:write', 'media:write', 'approvals:write', 'publishing:write'], 'POST', '/public/v1/posts'],
    [['channels:write'], ['channels:write'], 'POST', '/public/v1/integrations/channel-1/disable'],
  ])('keeps an MCP OAuth grant %p on its exact allowed operations', async (scopes, expected, method, originalUrl) => {
    const oauth = {
      getOrgByOAuthToken: jest.fn().mockResolvedValue({
        organization: { id: 'org-1', subscription: null },
        membership: { userId: 'user-1', role: 'USER', disabled: false },
        scopes,
      }),
    };
    const middleware = new PublicAuthMiddleware({} as any, oauth as any);
    const req = { headers: { authorization: 'Bearer pos_scoped' }, method, originalUrl } as any;
    const next = jest.fn();
    const res = response();
    await middleware.use(req, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.publicApiScopes).toEqual(expect.arrayContaining(expected));
    expect(req.publicApiScopes).not.toContain('*');
    expect(req.publicApiScopes).not.toContain('webhooks:read');
    expect(req.publicApiScopes).not.toContain('webhooks:write');
    expect(req.org.users[0].role).toBe('USER');
  });

  it.each([
    [[], 'GET', '/public/v1/posts'],
    [['posts:read'], 'POST', '/public/v1/posts'],
    [['posts:write'], 'POST', '/public/v1/integrations/channel-1/disable'],
  ])('denies an MCP grant %p without permission for %s %s', async (scopes, method, originalUrl) => {
    const oauth = {
      getOrgByOAuthToken: jest.fn().mockResolvedValue({
        organization: { id: 'org-1', subscription: null },
        membership: { userId: 'user-1', role: 'USER', disabled: false },
        scopes,
      }),
    };
    const middleware = new PublicAuthMiddleware({} as any, oauth as any);
    const req = { headers: { authorization: 'Bearer pos_scoped' }, method, originalUrl } as any;
    const res = response();
    const next = jest.fn();
    await middleware.use(req, res as any, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('preserves a raw API key and attaches its scopes to the request', async () => {
    const organizations = {
      resolvePublicApiCredential: jest.fn().mockResolvedValue({
        organization: {
          id: 'org-1',
          subscription: null,
        },
        scopes: ['posts:read'],
        credentialType: 'api-key',
        apiKeyId: 'key-1',
      }),
    };
    const oauth = { getOrgByOAuthToken: jest.fn() };
    const middleware = new PublicAuthMiddleware(
      organizations as any,
      oauth as any
    );
    const req = { headers: { authorization: 'named-api-key' } } as any;
    const next = jest.fn();

    await middleware.use(req, response() as any, next);

    expect(organizations.resolvePublicApiCredential).toHaveBeenCalledWith(
      'named-api-key'
    );
    expect(oauth.getOrgByOAuthToken).not.toHaveBeenCalled();
    expect(req.publicApiScopes).toEqual(['posts:read']);
    expect(req.publicApiCredential).toEqual({
      type: 'api-key',
      id: 'key-1',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rejects an OAuth token without an active membership', async () => {
    const oauth = { getOrgByOAuthToken: jest.fn().mockResolvedValue(null) };
    const middleware = new PublicAuthMiddleware({} as any, oauth as any);
    const res = response();
    const next = jest.fn();

    await middleware.use(
      { headers: { authorization: 'Bearer pos_removed' } } as any,
      res as any,
      next
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ msg: 'Invalid OAuth token' });
    expect(next).not.toHaveBeenCalled();
  });
  describe('actor binding', () => {
    const recordingNext = () => {
      const seen: any[] = [];
      const next = jest.fn(() => {
        seen.push(currentActor());
      });
      return { seen, next };
    };

    it('binds an API key actor', async () => {
      const organizations = {
        resolvePublicApiCredential: jest.fn().mockResolvedValue({
          organization: { id: 'org-1', subscription: null },
          scopes: ['posts:read'],
          credentialType: 'api-key',
          apiKeyId: 'k1',
        }),
      };
      const middleware = new PublicAuthMiddleware(organizations as any, {} as any);
      const { seen, next } = recordingNext();
      await middleware.use({ headers: { authorization: 'key' } } as any, response() as any, next);
      expect(seen).toEqual([{ type: 'API_KEY', apiKeyId: 'k1' }]);
    });

    it('binds a legacy org key as an API_KEY actor without an id', async () => {
      const organizations = {
        resolvePublicApiCredential: jest.fn().mockResolvedValue({
          organization: { id: 'org-1', subscription: null },
          scopes: ['*'],
          credentialType: 'legacy',
        }),
      };
      const middleware = new PublicAuthMiddleware(organizations as any, {} as any);
      const { seen, next } = recordingNext();
      await middleware.use({ headers: { authorization: 'legacy' } } as any, response() as any, next);
      expect(seen).toEqual([{ type: 'API_KEY', apiKeyId: null }]);
    });

    it('binds an MCP OAuth token to its client and authorizing user', async () => {
      const oauth = {
        getOrgByOAuthToken: jest.fn().mockResolvedValue({
          organization: { id: 'org-1', subscription: null },
          membership: { userId: 'u7', role: 'USER', disabled: false },
          scopes: ['posts:read'],
          mcpOAuthClientId: 'mc1',
          userId: 'u7',
        }),
      };
      const middleware = new PublicAuthMiddleware({} as any, oauth as any);
      const { seen, next } = recordingNext();
      const req = { headers: { authorization: 'Bearer pos_mcp' }, method: 'GET', originalUrl: '/public/v1/posts' } as any;
      await middleware.use(req, response() as any, next);
      expect(req.publicApiCredential).toEqual({ type: 'oauth', oauthClientId: 'mc1', oauthUserId: 'u7' });
      expect(seen).toEqual([{ type: 'OAUTH_CLIENT', oauthClientId: 'mc1', userId: 'u7' }]);
    });

    it('binds a legacy OAuth app authorization', async () => {
      const oauth = {
        getOrgByOAuthToken: jest.fn().mockResolvedValue({
          organization: { id: 'org-1', subscription: null },
          membership: { userId: 'u2', role: 'USER', disabled: false },
          oauthAppId: 'app1',
          userId: 'u2',
        }),
      };
      const middleware = new PublicAuthMiddleware({} as any, oauth as any);
      const { seen, next } = recordingNext();
      const req = { headers: { authorization: 'Bearer pos_legacy' } } as any;
      await middleware.use(req, response() as any, next);
      expect(req.publicApiCredential).toEqual({ type: 'oauth', oauthClientId: 'app1', oauthUserId: 'u2' });
      expect(seen).toEqual([{ type: 'OAUTH_CLIENT', oauthClientId: 'app1', userId: 'u2' }]);
    });

    it('ignores spoofed actor headers and body fields', async () => {
      const organizations = {
        resolvePublicApiCredential: jest.fn().mockResolvedValue({
          organization: { id: 'org-1', subscription: null },
          scopes: ['posts:write'],
          credentialType: 'api-key',
          apiKeyId: 'k1',
        }),
      };
      const middleware = new PublicAuthMiddleware(organizations as any, {} as any);
      const { seen, next } = recordingNext();
      const req = {
        headers: {
          authorization: 'key',
          'x-postsider-actor-type': 'USER',
          'x-postsider-agent': 'admin',
        },
        body: {
          creationMethod: 'WEB',
          createdByType: 'USER',
          actor: { type: 'USER', userId: 'victim' },
        },
      } as any;
      await middleware.use(req, response() as any, next);
      expect(seen).toEqual([{ type: 'API_KEY', apiKeyId: 'k1' }]);
    });

    it('never calls next for a rejected credential and leaves the actor SYSTEM', async () => {
      const organizations = { resolvePublicApiCredential: jest.fn().mockResolvedValue(null) };
      const middleware = new PublicAuthMiddleware(organizations as any, {} as any);
      const res = response();
      const { next } = recordingNext();
      await middleware.use({ headers: { authorization: 'bad' } } as any, res as any, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
      expect(currentActor()).toEqual({ type: 'SYSTEM' });
    });
  });

  describe('key permissions', () => {
    const run = async (credential: Record<string, unknown>, authorization = 'named-api-key') => {
      const organizations = {
        resolvePublicApiCredential: jest.fn().mockResolvedValue({
          organization: { id: 'org-1', subscription: null },
          scopes: ['posts:write'],
          ...credential,
        }),
      };
      const middleware = new PublicAuthMiddleware(organizations as any, {} as any);
      const req = { headers: { authorization } } as any;
      let inside: unknown = 'unset';
      await middleware.use(req, response() as any, () => {
        inside = currentKeyPermissions();
      });
      return { req, inside };
    };

    it('attaches limits of an api-key to the request and the context', async () => {
      const keyPermissions = { allowedActions: ['DRAFT'], allowedIntegrationIds: [] };
      const { req, inside } = await run({
        credentialType: 'api-key',
        apiKeyId: 'key-1',
        keyPermissions,
      });
      expect(req.publicApiCredential.permissions).toEqual(keyPermissions);
      expect(inside).toEqual(keyPermissions);
    });

    it('sets nothing for an unrestricted key', async () => {
      const { req, inside } = await run({ credentialType: 'api-key', apiKeyId: 'key-1' });
      expect(req.publicApiCredential).not.toHaveProperty('permissions');
      expect(inside).toBeNull();
    });

    it('ignores the fields on a legacy credential', async () => {
      const { req, inside } = await run({
        credentialType: 'legacy',
        keyPermissions: { allowedActions: ['DRAFT'], allowedIntegrationIds: [] },
      });
      expect(req.publicApiCredential).not.toHaveProperty('permissions');
      expect(inside).toBeNull();
    });

    it('ignores the fields on an oauth token', async () => {
      const oauth = {
        getOrgByOAuthToken: jest.fn().mockResolvedValue({
          organization: { id: 'org-1', subscription: null },
          membership: { userId: 'u1', role: 'USER', disabled: false },
          keyPermissions: { allowedActions: ['DRAFT'], allowedIntegrationIds: [] },
        }),
      };
      const middleware = new PublicAuthMiddleware({} as any, oauth as any);
      const req = { headers: { authorization: 'Bearer pos_x' } } as any;
      let inside: unknown = 'unset';
      await middleware.use(req, response() as any, () => {
        inside = currentKeyPermissions();
      });
      expect(req.publicApiCredential).not.toHaveProperty('permissions');
      expect(inside).toBeNull();
    });
  });
});
