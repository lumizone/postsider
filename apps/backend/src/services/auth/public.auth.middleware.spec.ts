import { PublicAuthMiddleware } from './public.auth.middleware';

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
      setHeader: jest.fn(),
      json: jest.fn(),
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
      const organizations = { resolvePublicApiCredential: jest.fn() };
      const middleware = new PublicAuthMiddleware(
        organizations as any,
        oauth as any
      );
      const req = { headers: { authorization: header } } as any;
      const next = jest.fn();

      await middleware.use(req, response() as any, next);

      expect(oauth.getOrgByOAuthToken).toHaveBeenCalledWith(token);
      expect(organizations.resolvePublicApiCredential).not.toHaveBeenCalled();
      expect(req.org.users).toEqual([membership]);
      expect(req.publicApiScopes).toContain('posts:write');
      expect(req.publicApiScopes).not.toContain('webhooks:read');
      expect(req.publicApiScopes).not.toContain('webhooks:write');
      expect(req.publicApiCredential).toEqual({ type: 'oauth' });
      expect(next).toHaveBeenCalledTimes(1);
    }
  );

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

  it('keeps MCP OAuth read-only grants on the original API endpoints', async () => {
    const oauth = {
      getOrgByOAuthToken: jest.fn().mockResolvedValue({
        organization: { id: 'org-1', subscription: null },
        membership: { userId: 'user-1', role: 'USER', disabled: false },
        scopes: ['posts:read'],
      }),
    };
    const middleware = new PublicAuthMiddleware({} as any, oauth as any);
    const req = {
      headers: { authorization: 'Bearer pos_readonly' },
      method: 'GET',
      originalUrl: '/public/v1/posts',
    } as any;
    const next = jest.fn();

    await middleware.use(req, response() as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.publicApiScopes).toContain('posts:read');
    expect(req.publicApiScopes).not.toContain('posts:write');
    expect(req.publicApiScopes).not.toContain('webhooks:write');
  });

  it('denies direct REST writes by a read-only MCP token', async () => {
    const oauth = {
      getOrgByOAuthToken: jest.fn().mockResolvedValue({
        organization: { id: 'org-1', subscription: null },
        membership: { userId: 'user-1', role: 'USER', disabled: false },
        scopes: ['posts:read'],
      }),
    };
    const middleware = new PublicAuthMiddleware({} as any, oauth as any);
    const res = response();
    const next = jest.fn();
    await middleware.use({
      headers: { authorization: 'Bearer pos_readonly' },
      method: 'POST',
      originalUrl: '/public/v1/posts',
    } as any, res as any, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('insufficient_scope')
    );
    expect(next).not.toHaveBeenCalled();
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
});
