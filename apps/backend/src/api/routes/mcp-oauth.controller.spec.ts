process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';

import { HttpException, HttpStatus } from '@nestjs/common';
import { OAuthController, OAuthAuthorizedController } from './oauth.controller';
import { McpOAuthController } from './mcp-oauth.controller';

const catchErr = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (err) {
    return err;
  }
};

/** For calls that may throw synchronously (before any await). */
const catchErrSync = async (fn: () => unknown) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
};

const errBody = (err: any) => {
  const res = err?.getResponse?.();
  return typeof res === 'object' ? res : { msg: String(res) };
};

describe('OAuthController MCP routing', () => {
  const make = () => {
    const oauthService = {
      validateAuthorizationRequest: jest.fn(),
      exchangeCodeForToken: jest.fn(),
    };
    const mcpService = {
      beginAuthorization: jest.fn(),
      getClient: jest.fn(),
      refresh: jest.fn(),
      exchangeCode: jest.fn(),
    };
    return {
      oauthService,
      mcpService,
      controller: new OAuthController(
        oauthService as any,
        mcpService as any
      ),
    };
  };

  it('redirects PKCE requests to the consent page', async () => {
    const { controller, mcpService, oauthService } = make();
    mcpService.beginAuthorization.mockResolvedValue({
      consentUrl: 'https://app.postsider.com/oauth/consent?request=p1',
    });
    const res = { redirect: jest.fn() };

    await controller.authorize(
      {
        client_id: 'pmc_x',
        response_type: 'code',
        code_challenge: 'c'.repeat(43),
        code_challenge_method: 'S256',
        redirect_uri: 'https://claude.ai/cb',
      } as any,
      res as any
    );

    expect(oauthService.validateAuthorizationRequest).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      HttpStatus.FOUND,
      'https://app.postsider.com/oauth/consent?request=p1'
    );
  });

  it('keeps the legacy JSON response for non-PKCE requests', async () => {
    const { controller, oauthService } = make();
    oauthService.validateAuthorizationRequest.mockResolvedValue({
      name: 'App',
      description: 'd',
      picture: null,
      clientId: 'pca_1',
      redirectUrl: 'https://client.example.com/cb',
    });

    const result = await controller.authorize(
      { client_id: 'pca_1', response_type: 'code', state: 'st' } as any,
      { redirect: jest.fn() } as any
    );

    expect(result).toMatchObject({ state: 'st' });
    expect((result as any).app.clientId).toBe('pca_1');
  });

  it('hints at the missing PKCE when a DCR client omits the challenge', async () => {
    const { controller, oauthService, mcpService } = make();
    oauthService.validateAuthorizationRequest.mockRejectedValue(
      new HttpException('Invalid client_id', HttpStatus.BAD_REQUEST)
    );
    mcpService.getClient.mockResolvedValue({ id: 'c1' });

    const err = await catchErr(
      controller.authorize(
        { client_id: 'pmc_x', response_type: 'code' } as any,
        { redirect: jest.fn() } as any
      )
    );

    expect(errBody(err).error).toBe('invalid_request');
    expect(errBody(err).error_description).toMatch(/PKCE/);
  });

  it('routes refresh_token grants to the MCP service', async () => {
    const { controller, mcpService, oauthService } = make();
    mcpService.refresh.mockResolvedValue({ access_token: 'pos_x' });

    await controller.token({
      grant_type: 'refresh_token',
      client_id: 'pmc_x',
      refresh_token: 'psr_y',
    } as any);

    expect(mcpService.refresh).toHaveBeenCalledWith({
      refreshToken: 'psr_y',
      clientId: 'pmc_x',
      clientSecret: undefined,
    });
    expect(oauthService.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('routes authorization_code from DCR clients to the MCP service', async () => {
    const { controller, mcpService, oauthService } = make();
    mcpService.getClient.mockResolvedValue({ id: 'c1' });
    mcpService.exchangeCode.mockResolvedValue({ access_token: 'pos_x' });

    await controller.token({
      grant_type: 'authorization_code',
      client_id: 'pmc_x',
      code: 'the-code',
      code_verifier: 'v'.repeat(64),
    } as any);

    expect(mcpService.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'the-code', clientId: 'pmc_x' })
    );
    expect(oauthService.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('keeps the legacy exchange for known legacy clients', async () => {
    const { controller, mcpService, oauthService } = make();
    mcpService.getClient.mockResolvedValue(null);
    oauthService.exchangeCodeForToken.mockResolvedValue({
      access_token: 'pos_legacy',
    });

    const result = await controller.token({
      grant_type: 'authorization_code',
      client_id: 'pca_1',
      code: 'c',
      client_secret: 's',
    } as any);

    expect(result).toEqual({ access_token: 'pos_legacy' });
    expect(oauthService.exchangeCodeForToken).toHaveBeenCalledWith(
      'c',
      'pca_1',
      's'
    );
  });

  it('requires code and client_secret on the legacy path', async () => {
    const { controller, mcpService } = make();
    mcpService.getClient.mockResolvedValue(null);

    const err = await catchErr(
      controller.token({
        grant_type: 'authorization_code',
        client_id: 'pca_1',
      } as any)
    );

    expect(errBody(err).error).toBe('invalid_request');
  });

  it('rejects unsupported grant types', async () => {
    const { controller } = make();
    const err = await catchErr(
      controller.token({ grant_type: 'password', client_id: 'x' } as any)
    );
    expect(errBody(err).error).toBe('unsupported_grant_type');
  });
});

describe('OAuthAuthorizedController consent endpoints', () => {
  const make = () => {
    const mcpService = {
      getConsentRequest: jest.fn(),
      getConsentOrganizations: jest.fn(),
      approveOrDeny: jest.fn(),
    };
    return {
      mcpService,
      controller: new OAuthAuthorizedController(
        { validateAuthorizationRequest: jest.fn() } as any,
        mcpService as any
      ),
    };
  };

  it('combines the pending request with the user admin organizations', async () => {
    const { controller, mcpService } = make();
    mcpService.getConsentRequest.mockResolvedValue({
      id: 'p1',
      clientName: 'Claude',
      scopes: ['posts:read'],
      redirectUri: 'https://claude.ai/cb',
    });
    mcpService.getConsentOrganizations.mockResolvedValue([
      { id: 'org1', name: 'Acme', role: 'ADMIN' },
    ]);

    const result = await controller.mcpConsentRequest('p1', {
      id: 'u1',
    } as any);

    expect(mcpService.getConsentOrganizations).toHaveBeenCalledWith('u1');
    expect(result).toMatchObject({
      id: 'p1',
      clientName: 'Claude',
      organizations: [{ id: 'org1', name: 'Acme', role: 'ADMIN' }],
    });
  });

  it('delegates the consent decision', async () => {
    const { controller, mcpService } = make();
    mcpService.approveOrDeny.mockResolvedValue({
      redirect: 'https://claude.ai/cb?code=abc',
    });

    const result = await controller.mcpConsent(
      {
        request_id: 'p1',
        organization_id: 'org1',
        action: 'approve',
        scopes: ['posts:read'],
      } as any,
      { id: 'u1' } as any
    );

    expect(mcpService.approveOrDeny).toHaveBeenCalledWith({
      pendingId: 'p1',
      userId: 'u1',
      organizationId: 'org1',
      action: 'approve',
      scopes: ['posts:read'],
    });
    expect(result.redirect).toContain('code=abc');
  });
});

describe('McpOAuthController', () => {
  const make = () => {
    const mcpService = {
      authorizationServerMetadata: jest.fn(),
      registerClient: jest.fn(),
      introspect: jest.fn(),
      revokeToken: jest.fn(),
      userinfo: jest.fn(),
    };
    return {
      mcpService,
      controller: new McpOAuthController(mcpService as any),
    };
  };

  const reqFrom = (ip: string) =>
    ({
      headers: { 'x-forwarded-for': ip },
      socket: { remoteAddress: ip },
    }) as any;

  it('serves the discovery metadata', () => {
    const { controller, mcpService } = make();
    mcpService.authorizationServerMetadata.mockReturnValue({ issuer: 'x' });
    expect(controller.authorizationServerMetadata()).toEqual({ issuer: 'x' });
  });

  it('registers a client with the forwarded client IP', async () => {
    const { controller, mcpService } = make();
    mcpService.registerClient.mockResolvedValue({ client_id: 'pmc_1' });

    await controller.register(
      { client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] } as any,
      reqFrom('203.0.113.10')
    );

    expect(mcpService.registerClient).toHaveBeenCalledWith(
      expect.objectContaining({ client_name: 'Claude' }),
      '203.0.113.10'
    );
  });

  it('rate-limits registration per IP', async () => {
    const { controller, mcpService } = make();
    mcpService.registerClient.mockResolvedValue({ client_id: 'pmc_1' });
    process.env.MCP_DCR_RATE_LIMIT = '0';
    try {
      const err = await catchErr(
        controller.register(
          { client_name: 'X', redirect_uris: ['https://x/cb'] } as any,
          reqFrom('203.0.113.99')
        )
      );
      expect((err as any).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(mcpService.registerClient).not.toHaveBeenCalled();
    } finally {
      delete process.env.MCP_DCR_RATE_LIMIT;
    }
  });

  describe('introspection auth', () => {
    afterEach(() => {
      delete process.env.MCP_INTROSPECTION_SECRET;
    });

    it('fails closed when no secret is configured', async () => {
      const { controller } = make();
      const err = await catchErrSync(() =>
        controller.introspect({ token: 't' } as any, 'Bearer whatever')
      );
      expect((err as any).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('rejects a wrong bearer secret', async () => {
      process.env.MCP_INTROSPECTION_SECRET = 'correct-secret';
      const { controller, mcpService } = make();

      const err = await catchErrSync(() =>
        controller.introspect({ token: 't' } as any, 'Bearer wrong-secret')
      );
      expect((err as any).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect(mcpService.introspect).not.toHaveBeenCalled();
    });

    it('accepts the shared secret and introspects', async () => {
      process.env.MCP_INTROSPECTION_SECRET = 'correct-secret';
      const { controller, mcpService } = make();
      mcpService.introspect.mockResolvedValue({ active: true });

      await controller.introspect(
        { token: 'pos_x' } as any,
        'Bearer correct-secret'
      );
      expect(mcpService.introspect).toHaveBeenCalledWith('pos_x');
    });
  });

  it('delegates revocation', async () => {
    const { controller, mcpService } = make();
    mcpService.revokeToken.mockResolvedValue({});
    await controller.revoke({ token: 'pos_x' } as any);
    expect(mcpService.revokeToken).toHaveBeenCalledWith('pos_x');
  });

  describe('userinfo', () => {
    it('requires a bearer token and sets WWW-Authenticate', async () => {
      const { controller, mcpService } = make();
      const res = { setHeader: jest.fn() };

      const err = await catchErr(
        controller.userinfo(undefined, res as any)
      );

      expect((err as any).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        'Bearer error="invalid_token"'
      );
      expect(mcpService.userinfo).not.toHaveBeenCalled();
    });

    it('returns claims for a live token', async () => {
      const { controller, mcpService } = make();
      mcpService.userinfo.mockResolvedValue({
        sub: 'u1',
        email: 'a@b.co',
        email_verified: true,
      });
      const res = { setHeader: jest.fn() };

      const result = await controller.userinfo('Bearer pos_live', res as any);
      expect(result).toMatchObject({ email_verified: true });
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    it('adds WWW-Authenticate when the service rejects the token', async () => {
      const { controller, mcpService } = make();
      mcpService.userinfo.mockRejectedValue(
        new HttpException(
          { error: 'invalid_token' },
          HttpStatus.UNAUTHORIZED
        )
      );
      const res = { setHeader: jest.fn() };

      const err = await catchErr(
        controller.userinfo('Bearer pos_dead', res as any)
      );

      expect((err as any).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('invalid_token')
      );
    });
  });
});
