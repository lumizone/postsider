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
      json: jest.fn(),
    };
    res.status.mockReturnValue(res);
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
      expect(req.publicApiScopes).toEqual(['*']);
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
