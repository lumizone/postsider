process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret';

import { createHash } from 'crypto';
import {
  McpOAuthService,
  isValidRedirectUri,
  verifyPkceS256,
  MCP_ACCESS_TOKEN_TTL_MS,
  MCP_CODE_TTL_MS,
  MCP_PENDING_TTL_MS,
  MCP_REFRESH_TOKEN_TTL_MS,
} from './mcp-oauth.service';
import { AuthService } from '@postsider/helpers/auth/auth.service';

const s256 = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');

const VERIFIER = 'a'.repeat(64);
const CHALLENGE = s256(VERIFIER);

const makeRepo = () => ({
  createClient: jest.fn(),
  getClientByClientId: jest.fn(),
  createPending: jest.fn(),
  getPendingById: jest.fn(),
  claimPending: jest.fn(),
  createCode: jest.fn(),
  getCodeByHash: jest.fn(),
  claimCode: jest.fn(),
  upsertGrant: jest.fn().mockResolvedValue({}),
  getGrantById: jest.fn(),
  getGrantByTriple: jest.fn(),
  touchGrant: jest.fn().mockResolvedValue({}),
  revokeGrantChain: jest.fn().mockResolvedValue({}),
  createAccessToken: jest.fn(),
  createRefreshToken: jest.fn(),
  getAccessByHash: jest.fn(),
  getRefreshByHash: jest.fn(),
  claimRefreshToken: jest.fn(),
  setRefreshReplacedBy: jest.fn().mockResolvedValue({}),
  revokeAccessById: jest.fn(),
  revokeRefreshById: jest.fn(),
  getMembership: jest.fn(),
  listOrgMemberships: jest.fn(),
  findActiveAccessForApi: jest.fn(),
});

type MockRepo = ReturnType<typeof makeRepo>;

const makeService = (repo: MockRepo) => new McpOAuthService(repo as any);

const catchErr = async (promise: Promise<unknown>) => {
  try {
    await promise;
    return null;
  } catch (err) {
    return err;
  }
};

const oauthErrorOf = (err: any): { error?: string; error_description?: string } => {
  const res = err?.getResponse?.();
  return typeof res === 'object' ? res : { error: String(res) };
};

const makeClient = (over: Record<string, unknown> = {}) => ({
  id: 'client-row-1',
  clientId: 'pmc_test',
  name: 'Claude',
  redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
  scopes: ['posts:read'],
  tokenEndpointAuthMethod: 'none',
  clientSecret: null,
  ...over,
});

const future = (ms: number) => new Date(Date.now() + ms);

describe('isValidRedirectUri', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['https://example.com/oauth/cb?x=1', true],
    ['http://localhost:8976/callback', true],
    ['http://127.0.0.1:3000/cb', true],
    ['http://[::1]:8085/cb', true],
    ['http://evil.example.com/cb', false],
    ['https://app.example.com/cb#fragment', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
    ['', false],
    ['ftp://example.com/cb', false],
  ])('%s -> %s', (uri, expected) => {
    expect(isValidRedirectUri(uri as string)).toBe(expected);
  });
});

describe('verifyPkceS256', () => {
  it('accepts the matching verifier', () => {
    expect(verifyPkceS256(VERIFIER, CHALLENGE)).toBe(true);
  });

  it('rejects a wrong verifier', () => {
    expect(verifyPkceS256('b'.repeat(64), CHALLENGE)).toBe(false);
  });

  it('rejects a too-short verifier', () => {
    expect(verifyPkceS256('short', CHALLENGE)).toBe(false);
  });

  it('rejects a verifier with illegal characters', () => {
    expect(verifyPkceS256('a'.repeat(63) + '!', CHALLENGE)).toBe(false);
  });
});

describe('McpOAuthService', () => {
  let repo: MockRepo;
  let service: McpOAuthService;

  beforeEach(() => {
    repo = makeRepo();
    service = makeService(repo);
    process.env.FRONTEND_URL = 'https://app.postsider.com';
    delete process.env.MCP_CONSENT_URL;
    delete process.env.MCP_OAUTH_ISSUER;
  });

  describe('authorizationServerMetadata', () => {
    it('advertises the endpoints, scopes and PKCE support', () => {
      const meta = service.authorizationServerMetadata();
      expect(meta.issuer).toBe('https://api.postsider.com');
      expect(meta.authorization_endpoint).toBe(
        'https://api.postsider.com/oauth/authorize'
      );
      expect(meta.token_endpoint).toBe('https://api.postsider.com/oauth/token');
      expect(meta.registration_endpoint).toBe(
        'https://api.postsider.com/oauth/register'
      );
      expect(meta.userinfo_endpoint).toBe(
        'https://api.postsider.com/oauth/userinfo'
      );
      expect(meta.scopes_supported).toEqual(
        expect.arrayContaining(['posts:read', 'posts:write', 'openid', 'email'])
      );
      expect(meta.code_challenge_methods_supported).toEqual(['S256']);
      expect(meta.grant_types_supported).toEqual([
        'authorization_code',
        'refresh_token',
      ]);
    });

    it('honors MCP_OAUTH_ISSUER override', () => {
      process.env.MCP_OAUTH_ISSUER = 'https://mcp-staging.example.com/';
      const meta = service.authorizationServerMetadata();
      expect(meta.issuer).toBe('https://mcp-staging.example.com');
      expect(meta.token_endpoint).toBe(
        'https://mcp-staging.example.com/oauth/token'
      );
    });
  });

  describe('registerClient', () => {
    it('registers a public client with a read-only default scope', async () => {
      repo.createClient.mockResolvedValue({});
      const res = await service.registerClient(
        {
          client_name: 'Claude',
          redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
        } as any,
        '203.0.113.7'
      );

      expect(res.client_id).toMatch(/^pmc_/);
      expect(res.scope).toBe('posts:read');
      expect(res.token_endpoint_auth_method).toBe('none');
      expect(res.client_secret).toBeUndefined();
      expect(repo.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          scopes: ['posts:read'],
          clientSecret: null,
          registrationIp: '203.0.113.7',
        })
      );
    });

    it('filters unknown scopes but keeps the supported ones', async () => {
      repo.createClient.mockResolvedValue({});
      const res = await service.registerClient(
        {
          client_name: 'Claude',
          redirect_uris: ['https://claude.ai/cb'],
          scope: 'posts:read posts:write openid email nonsense:all',
        } as any,
        null
      );
      expect(res.scope).toBe('posts:read posts:write openid email');
    });

    it('issues a one-time secret for confidential clients', async () => {
      repo.createClient.mockResolvedValue({});
      const res = await service.registerClient(
        {
          client_name: 'Server app',
          redirect_uris: ['https://example.com/cb'],
          token_endpoint_auth_method: 'client_secret_post',
        } as any,
        null
      );

      expect(res.client_secret).toMatch(/^pms_/);
      expect(repo.createClient).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenEndpointAuthMethod: 'client_secret_post',
          clientSecret: AuthService.fixedEncryption(res.client_secret!),
        })
      );
    });

    it('rejects a non-loopback http redirect_uri', async () => {
      const err = await catchErr(
        service.registerClient(
          {
            client_name: 'Bad',
            redirect_uris: ['http://evil.example.com/cb'],
          } as any,
          null
        )
      );
      expect(oauthErrorOf(err).error).toBe('invalid_redirect_uri');
      expect(repo.createClient).not.toHaveBeenCalled();
    });
  });

  describe('beginAuthorization', () => {
    const base = {
      clientId: 'pmc_test',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
    };

    it('rejects an unknown client', async () => {
      repo.getClientByClientId.mockResolvedValue(null);
      const err = await catchErr(service.beginAuthorization(base));
      expect(oauthErrorOf(err).error).toBe('invalid_request');
    });

    it('rejects a non-S256 method', async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      const err = await catchErr(
        service.beginAuthorization({ ...base, codeChallengeMethod: 'plain' })
      );
      expect(oauthErrorOf(err).error_description).toMatch(/S256/);
    });

    it('rejects a missing or malformed challenge', async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      const err = await catchErr(
        service.beginAuthorization({ ...base, codeChallenge: undefined })
      );
      expect(oauthErrorOf(err).error).toBe('invalid_request');
      const err2 = await catchErr(
        service.beginAuthorization({ ...base, codeChallenge: 'too-short' })
      );
      expect(oauthErrorOf(err2).error).toBe('invalid_request');
    });

    it('requires an exactly registered redirect_uri', async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      const err = await catchErr(
        service.beginAuthorization({
          ...base,
          redirectUri: 'https://claude.ai/other/callback',
        })
      );
      expect(oauthErrorOf(err).error_description).toMatch(/redirect_uri/);
    });

    it('records a 10-minute pending consent and returns the consent URL', async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      repo.createPending.mockImplementation(async (data: any) => ({
        id: 'pending-1',
        ...data,
      }));

      const before = Date.now();
      const res = await service.beginAuthorization({
        ...base,
        state: 'st-123',
      });

      expect(res.pendingId).toBe('pending-1');
      expect(res.consentUrl).toBe(
        'https://app.postsider.com/oauth/consent?request=pending-1'
      );
      const created = repo.createPending.mock.calls[0][0];
      expect(created.state).toBe('st-123');
      expect(created.scopes).toEqual(['posts:read']);
      const ttl = created.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(MCP_PENDING_TTL_MS - 5000);
      expect(ttl).toBeLessThanOrEqual(MCP_PENDING_TTL_MS + 1000);
    });

    it('uses MCP_CONSENT_URL when configured', async () => {
      process.env.MCP_CONSENT_URL = 'https://postsider.com/mcp-consent/';
      repo.getClientByClientId.mockResolvedValue(makeClient());
      repo.createPending.mockResolvedValue({ id: 'p2' });
      const res = await service.beginAuthorization(base);
      expect(res.consentUrl).toBe('https://postsider.com/mcp-consent?request=p2');
    });
  });

  describe('approveOrDeny', () => {
    const pending = () => ({
      id: 'pending-1',
      mcpOAuthClientId: 'client-row-1',
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      scopes: ['posts:read', 'posts:write'],
      state: 'st-1',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      consumedAt: null,
      expiresAt: future(MCP_PENDING_TTL_MS),
      client: makeClient(),
    });

    it('404s an expired or consumed request', async () => {
      repo.getPendingById.mockResolvedValue({
        ...pending(),
        expiresAt: new Date(Date.now() - 1000),
      });
      const err = await catchErr(
        service.approveOrDeny({
          pendingId: 'pending-1',
          userId: 'u1',
          organizationId: 'org1',
          action: 'approve',
        })
      );
      expect((err as any).getStatus()).toBe(404);
    });

    it('deny returns an access_denied redirect with the state, no grant', async () => {
      repo.getPendingById.mockResolvedValue(pending());
      repo.claimPending.mockResolvedValue(1);

      const res = await service.approveOrDeny({
        pendingId: 'pending-1',
        userId: 'u1',
        organizationId: 'org1',
        action: 'deny',
      });

      expect(res.redirect).toContain('error=access_denied');
      expect(res.redirect).toContain('state=st-1');
      expect(repo.upsertGrant).not.toHaveBeenCalled();
    });

    it('refuses a second approval of the same request (claim race)', async () => {
      repo.getPendingById.mockResolvedValue(pending());
      repo.claimPending.mockResolvedValue(0);
      const err = await catchErr(
        service.approveOrDeny({
          pendingId: 'pending-1',
          userId: 'u1',
          organizationId: 'org1',
          action: 'approve',
        })
      );
      expect(oauthErrorOf(err).error).toBe('invalid_request');
    });

    it('rejects non-admin members', async () => {
      repo.getPendingById.mockResolvedValue(pending());
      repo.claimPending.mockResolvedValue(1);
      repo.getMembership.mockResolvedValue({
        userId: 'u1',
        role: 'USER',
        disabled: false,
      });
      const err = await catchErr(
        service.approveOrDeny({
          pendingId: 'pending-1',
          userId: 'u1',
          organizationId: 'org1',
          action: 'approve',
        })
      );
      expect((err as any).getStatus()).toBe(403);
    });

    it('rejects a non-member', async () => {
      repo.getPendingById.mockResolvedValue(pending());
      repo.claimPending.mockResolvedValue(1);
      repo.getMembership.mockResolvedValue(null);
      const err = await catchErr(
        service.approveOrDeny({
          pendingId: 'pending-1',
          userId: 'u1',
          organizationId: 'org1',
          action: 'approve',
        })
      );
      expect((err as any).getStatus()).toBe(403);
    });

    it('approve upserts the grant, issues a code and returns the redirect', async () => {
      repo.getPendingById.mockResolvedValue(pending());
      repo.claimPending.mockResolvedValue(1);
      repo.getMembership.mockResolvedValue({
        userId: 'u1',
        role: 'ADMIN',
        disabled: false,
      });

      const before = Date.now();
      const res = await service.approveOrDeny({
        pendingId: 'pending-1',
        userId: 'u1',
        organizationId: 'org1',
        action: 'approve',
      });

      expect(repo.upsertGrant).toHaveBeenCalledWith({
        mcpOAuthClientId: 'client-row-1',
        userId: 'u1',
        organizationId: 'org1',
        scopes: ['posts:read', 'posts:write'],
      });

      const codeArg = repo.createCode.mock.calls[0][0];
      expect(codeArg.redirectUri).toBe(
        'https://claude.ai/api/mcp/auth_callback'
      );
      expect(codeArg.codeChallenge).toBe(CHALLENGE);
      const ttl = codeArg.expiresAt.getTime() - before;
      expect(ttl).toBeGreaterThan(MCP_CODE_TTL_MS - 5000);
      expect(ttl).toBeLessThanOrEqual(MCP_CODE_TTL_MS + 1000);

      const redirect = new URL(res.redirect);
      expect(redirect.searchParams.get('state')).toBe('st-1');
      const code = redirect.searchParams.get('code')!;
      expect(code.length).toBe(48);
      // The stored hash must be the lookup value for the exact code returned.
      expect(codeArg.codeHash).toBe(AuthService.fixedEncryption(code));
    });

    it('lets the approver narrow scopes but not widen them', async () => {
      repo.getPendingById.mockResolvedValue(pending());
      repo.claimPending.mockResolvedValue(1);
      repo.getMembership.mockResolvedValue({
        userId: 'u1',
        role: 'ADMIN',
        disabled: false,
      });

      await service.approveOrDeny({
        pendingId: 'pending-1',
        userId: 'u1',
        organizationId: 'org1',
        action: 'approve',
        scopes: ['posts:read'],
      });
      expect(repo.upsertGrant).toHaveBeenCalledWith(
        expect.objectContaining({ scopes: ['posts:read'] })
      );

      repo.upsertGrant.mockClear();
      const err = await catchErr(
        service.approveOrDeny({
          pendingId: 'pending-1',
          userId: 'u1',
          organizationId: 'org1',
          action: 'approve',
          scopes: ['posts:read', 'posts:write', 'admin:all'],
        })
      );
      expect(oauthErrorOf(err).error).toBe('invalid_request');
      expect(repo.upsertGrant).not.toHaveBeenCalled();
    });
  });

  describe('exchangeCode', () => {
    const codeRecord = (over: Record<string, unknown> = {}) => ({
      id: 'code-row-1',
      codeHash: AuthService.fixedEncryption('the-code'),
      mcpOAuthClientId: 'client-row-1',
      userId: 'u1',
      organizationId: 'org1',
      scopes: ['posts:read'],
      codeChallenge: CHALLENGE,
      codeChallengeMethod: 'S256',
      redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      createdAt: new Date(),
      expiresAt: future(MCP_CODE_TTL_MS),
      consumedAt: null,
      ...over,
    });

    const happy = async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      repo.getCodeByHash.mockResolvedValue(codeRecord());
      repo.claimCode.mockResolvedValue(1);
      repo.getGrantByTriple.mockResolvedValue({
        id: 'grant-1',
        revokedAt: null,
        scopes: ['posts:read'],
      });
      repo.createAccessToken.mockImplementation(async (d: any) => ({
        id: 'access-1',
        ...d,
      }));
      repo.createRefreshToken.mockImplementation(async (d: any) => ({
        id: 'refresh-1',
        ...d,
      }));
    };

    it('rejects an unknown client with 401 invalid_client', async () => {
      repo.getClientByClientId.mockResolvedValue(null);
      const err = await catchErr(
        service.exchangeCode({ code: 'x', clientId: 'nope' })
      );
      expect((err as any).getStatus()).toBe(401);
      expect(oauthErrorOf(err).error).toBe('invalid_client');
    });

    it('issues tokens with the locked TTLs and single-use code claim', async () => {
      await happy();

      const before = Date.now();
      const res = await service.exchangeCode({
        code: 'the-code',
        clientId: 'pmc_test',
        codeVerifier: VERIFIER,
        redirectUri: 'https://claude.ai/api/mcp/auth_callback',
      });

      expect(res.access_token).toMatch(/^pos_/);
      expect(res.refresh_token).toMatch(/^psr_/);
      expect(res.token_type).toBe('bearer');
      expect(res.expires_in).toBe(900);
      expect(res.scope).toBe('posts:read');

      expect(repo.claimCode).toHaveBeenCalledWith('code-row-1');
      const accessArg = repo.createAccessToken.mock.calls[0][0];
      const accessTtl = accessArg.expiresAt.getTime() - before;
      expect(accessTtl).toBeGreaterThan(MCP_ACCESS_TOKEN_TTL_MS - 5000);
      expect(accessTtl).toBeLessThanOrEqual(MCP_ACCESS_TOKEN_TTL_MS + 1000);
      const refreshArg = repo.createRefreshToken.mock.calls[0][0];
      const refreshTtl = refreshArg.expiresAt.getTime() - before;
      expect(refreshTtl).toBeGreaterThan(MCP_REFRESH_TOKEN_TTL_MS - 5000);
      // Hashes, never raw values.
      expect(accessArg.tokenHash).toBe(
        AuthService.fixedEncryption(res.access_token)
      );
      expect(refreshArg.tokenHash).toBe(
        AuthService.fixedEncryption(res.refresh_token)
      );
    });

    it('rejects a wrong PKCE verifier', async () => {
      await happy();
      const err = await catchErr(
        service.exchangeCode({
          code: 'the-code',
          clientId: 'pmc_test',
          codeVerifier: 'b'.repeat(64),
        })
      );
      expect(oauthErrorOf(err).error).toBe('invalid_grant');
      expect(oauthErrorOf(err).error_description).toMatch(/PKCE/);
      expect(repo.createAccessToken).not.toHaveBeenCalled();
    });

    it('rejects a missing verifier', async () => {
      await happy();
      const err = await catchErr(
        service.exchangeCode({ code: 'the-code', clientId: 'pmc_test' })
      );
      expect(oauthErrorOf(err).error).toBe('invalid_grant');
    });

    it('rejects a redirected mismatch and requires redirect_uri for multi-URI clients', async () => {
      await happy();
      // client has exactly one registered URI -> omission tolerated
      const ok = await catchErr(
        service.exchangeCode({
          code: 'the-code',
          clientId: 'pmc_test',
          codeVerifier: VERIFIER,
        })
      );
      expect(ok).toBeNull();

      repo.getClientByClientId.mockResolvedValue(
        makeClient({ redirectUris: ['https://a/cb', 'https://b/cb'] })
      );
      const err = await catchErr(
        service.exchangeCode({
          code: 'the-code',
          clientId: 'pmc_test',
          codeVerifier: VERIFIER,
        })
      );
      expect(oauthErrorOf(err).error).toBe('invalid_request');

      const err2 = await catchErr(
        service.exchangeCode({
          code: 'the-code',
          clientId: 'pmc_test',
          codeVerifier: VERIFIER,
          redirectUri: 'https://other/cb',
        })
      );
      expect(oauthErrorOf(err2).error).toBe('invalid_grant');
    });

    it('rejects an expired code', async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      repo.getCodeByHash.mockResolvedValue(
        codeRecord({ expiresAt: new Date(Date.now() - 1) })
      );
      const err = await catchErr(
        service.exchangeCode({
          code: 'the-code',
          clientId: 'pmc_test',
          codeVerifier: VERIFIER,
        })
      );
      expect(oauthErrorOf(err).error_description).toMatch(/expired/);
    });

    it('revokes the grant when a consumed code is replayed', async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      repo.getCodeByHash.mockResolvedValue(
        codeRecord({ consumedAt: new Date() })
      );
      repo.getGrantByTriple.mockResolvedValue({
        id: 'grant-1',
        revokedAt: null,
      });

      const err = await catchErr(
        service.exchangeCode({
          code: 'the-code',
          clientId: 'pmc_test',
          codeVerifier: VERIFIER,
        })
      );

      expect(oauthErrorOf(err).error).toBe('invalid_grant');
      expect(repo.revokeGrantChain).toHaveBeenCalledWith(
        'grant-1',
        'code_replay_detected'
      );
    });

    it('rejects when the claim loses a race', async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      repo.getCodeByHash.mockResolvedValue(codeRecord());
      repo.claimCode.mockResolvedValue(0);
      const err = await catchErr(
        service.exchangeCode({
          code: 'the-code',
          clientId: 'pmc_test',
          codeVerifier: VERIFIER,
        })
      );
      expect(oauthErrorOf(err).error).toBe('invalid_grant');
    });

    it('requires the secret for confidential clients', async () => {
      await happy();
      repo.getClientByClientId.mockResolvedValue(
        makeClient({
          tokenEndpointAuthMethod: 'client_secret_post',
          clientSecret: AuthService.fixedEncryption('pms_secret'),
        })
      );

      const err = await catchErr(
        service.exchangeCode({
          code: 'the-code',
          clientId: 'pmc_test',
          codeVerifier: VERIFIER,
        })
      );
      expect((err as any).getStatus()).toBe(401);

      const ok = await catchErr(
        service.exchangeCode({
          code: 'the-code',
          clientId: 'pmc_test',
          clientSecret: 'pms_secret',
          codeVerifier: VERIFIER,
        })
      );
      expect(ok).toBeNull();
    });
  });

  describe('refresh', () => {
    const refreshRecord = (over: Record<string, unknown> = {}) => ({
      id: 'refresh-row-1',
      tokenHash: AuthService.fixedEncryption('psr_old'),
      grantId: 'grant-1',
      createdAt: new Date(),
      expiresAt: future(MCP_REFRESH_TOKEN_TTL_MS),
      revokedAt: null,
      replacedById: null,
      grant: {
        id: 'grant-1',
        mcpOAuthClientId: 'client-row-1',
        revokedAt: null,
        scopes: ['posts:read'],
      },
      ...over,
    });

    const happy = async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      repo.getRefreshByHash.mockResolvedValue(refreshRecord());
      repo.claimRefreshToken.mockResolvedValue(1);
      repo.createAccessToken.mockImplementation(async (d: any) => ({
        id: 'access-2',
        ...d,
      }));
      repo.createRefreshToken.mockImplementation(async (d: any) => ({
        id: 'refresh-row-2',
        ...d,
      }));
    };

    it('rotates: new tokens, old marked revoked and replaced', async () => {
      await happy();
      const res = await service.refresh({
        refreshToken: 'psr_old',
        clientId: 'pmc_test',
      });

      expect(res.access_token).toMatch(/^pos_/);
      expect(res.refresh_token).toMatch(/^psr_/);
      expect(res.refresh_token).not.toBe('psr_old');
      expect(repo.claimRefreshToken).toHaveBeenCalledWith('refresh-row-1');
      expect(repo.setRefreshReplacedBy).toHaveBeenCalledWith(
        'refresh-row-1',
        'refresh-row-2'
      );
    });

    it('revokes the whole chain when a rotated token is reused', async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      repo.getRefreshByHash.mockResolvedValue(
        refreshRecord({ revokedAt: new Date() })
      );

      const err = await catchErr(
        service.refresh({ refreshToken: 'psr_old', clientId: 'pmc_test' })
      );

      expect(oauthErrorOf(err).error).toBe('invalid_grant');
      expect(repo.revokeGrantChain).toHaveBeenCalledWith(
        'grant-1',
        'refresh_token_reuse_detected'
      );
      expect(repo.createAccessToken).not.toHaveBeenCalled();
    });

    it('revokes the chain when the claim loses a race', async () => {
      await happy();
      repo.claimRefreshToken.mockResolvedValue(0);
      const err = await catchErr(
        service.refresh({ refreshToken: 'psr_old', clientId: 'pmc_test' })
      );
      expect(oauthErrorOf(err).error).toBe('invalid_grant');
      expect(repo.revokeGrantChain).toHaveBeenCalledWith(
        'grant-1',
        'refresh_token_reuse_detected'
      );
    });

    it('rejects expired refresh tokens', async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      repo.getRefreshByHash.mockResolvedValue(
        refreshRecord({ expiresAt: new Date(Date.now() - 1) })
      );
      const err = await catchErr(
        service.refresh({ refreshToken: 'psr_old', clientId: 'pmc_test' })
      );
      expect(oauthErrorOf(err).error).toBe('invalid_grant');
      expect(repo.revokeGrantChain).not.toHaveBeenCalled();
    });

    it('rejects a token that belongs to another client', async () => {
      repo.getClientByClientId.mockResolvedValue(makeClient());
      repo.getRefreshByHash.mockResolvedValue(
        refreshRecord({
          grant: {
            id: 'grant-1',
            mcpOAuthClientId: 'client-row-OTHER',
            revokedAt: null,
            scopes: ['posts:read'],
          },
        })
      );
      const err = await catchErr(
        service.refresh({ refreshToken: 'psr_old', clientId: 'pmc_test' })
      );
      expect(oauthErrorOf(err).error).toBe('invalid_grant');
    });
  });

  describe('introspect', () => {
    const accessRow = (over: Record<string, unknown> = {}) => ({
      id: 'access-1',
      revokedAt: null,
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: future(10 * 60 * 1000),
      grant: {
        id: 'grant-1',
        revokedAt: null,
        scopes: ['posts:read', 'posts:write'],
        userId: 'u1',
        organizationId: 'org1',
        client: { clientId: 'pmc_test', name: 'Claude' },
        user: { id: 'u1', email: 'a@b.co', activated: true },
      },
      ...over,
    });

    it('returns the active payload for a live token', async () => {
      repo.getAccessByHash.mockResolvedValue(accessRow());
      repo.getMembership.mockResolvedValue({
        userId: 'u1',
        role: 'ADMIN',
        disabled: false,
      });

      const res = await service.introspect('pos_live');

      expect(res).toMatchObject({
        active: true,
        scope: 'posts:read posts:write',
        client_id: 'pmc_test',
        sub: 'u1',
        org: 'org1',
        token_type: 'Bearer',
        username: 'a@b.co',
      });
      expect(typeof (res as any).exp).toBe('number');
    });

    it.each([
      ['revoked token', () => accessRow({ revokedAt: new Date() })],
      [
        'expired token',
        () => accessRow({ expiresAt: new Date(Date.now() - 1) }),
      ],
      [
        'revoked grant',
        () =>
          accessRow({
            grant: { ...accessRow().grant, revokedAt: new Date() },
          }),
      ],
    ])('reports inactive for a %s', async (_label, row) => {
      repo.getAccessByHash.mockResolvedValue(row());
      const res = await service.introspect('pos_dead');
      expect(res).toEqual({ active: false });
    });

    it('reports inactive when the user is no longer a member', async () => {
      repo.getAccessByHash.mockResolvedValue(accessRow());
      repo.getMembership.mockResolvedValue(null);
      const res = await service.introspect('pos_orphan');
      expect(res).toEqual({ active: false });
    });

    it('supports refresh tokens and reports unknown tokens inactive', async () => {
      repo.getAccessByHash.mockResolvedValue(null);
      repo.getRefreshByHash.mockResolvedValue({
        id: 'r1',
        revokedAt: null,
        expiresAt: future(1000),
        grant: {
          id: 'g1',
          revokedAt: null,
          userId: 'u1',
          organizationId: 'org1',
          client: { clientId: 'pmc_test' },
        },
      });
      const active = await service.introspect('psr_x');
      expect(active).toMatchObject({ active: true, token_type: 'refresh_token' });

      repo.getRefreshByHash.mockResolvedValue(null);
      const none = await service.introspect('pos_unknown');
      expect(none).toEqual({ active: false });
    });
  });

  describe('revokeToken', () => {
    it('revokes the whole grant when the token is known', async () => {
      repo.getAccessByHash.mockResolvedValue({
        id: 'access-1',
        grantId: 'grant-1',
        revokedAt: null,
      });
      await service.revokeToken('pos_x');
      expect(repo.revokeGrantChain).toHaveBeenCalledWith('grant-1', 'user_revoked');
    });

    it('falls back to refresh tokens and stays silent for unknown ones', async () => {
      repo.getAccessByHash.mockResolvedValue(null);
      repo.getRefreshByHash.mockResolvedValue({
        id: 'r1',
        grantId: 'grant-9',
        revokedAt: null,
      });
      await service.revokeToken('psr_x');
      expect(repo.revokeGrantChain).toHaveBeenCalledWith('grant-9', 'user_revoked');

      repo.revokeGrantChain.mockClear();
      repo.getRefreshByHash.mockResolvedValue(null);
      await expect(service.revokeToken('pos_nope')).resolves.toEqual({});
      expect(repo.revokeGrantChain).not.toHaveBeenCalled();
    });
  });

  describe('userinfo', () => {
    it('returns sub/email/email_verified for a live token', async () => {
      repo.getAccessByHash.mockResolvedValue({
        id: 'access-1',
        revokedAt: null,
        expiresAt: future(60000),
        grant: {
          revokedAt: null,
          userId: 'u1',
          organizationId: 'org1',
          user: {
            id: 'u1',
            email: 'anna@example.com',
            name: 'Anna',
            lastName: 'Nowak',
            activated: true,
          },
        },
      });
      repo.getMembership.mockResolvedValue({
        userId: 'u1',
        role: 'ADMIN',
        disabled: false,
      });

      const res = await service.userinfo('pos_live');
      expect(res).toEqual({
        sub: 'u1',
        email: 'anna@example.com',
        email_verified: true,
        name: 'Anna Nowak',
      });
    });

    it.each([
      ['unknown token', null, null],
      [
        'revoked token',
        {
          id: 'a',
          revokedAt: new Date(),
          expiresAt: future(1000),
          grant: { revokedAt: null, user: { activated: true } },
        },
        null,
      ],
    ])('401s for a %s', async (_label, row, membership) => {
      repo.getAccessByHash.mockResolvedValue(row as any);
      repo.getMembership.mockResolvedValue(membership as any);
      const err = await catchErr(service.userinfo('pos_bad'));
      expect((err as any).getStatus()).toBe(401);
      expect(oauthErrorOf(err).error).toBe('invalid_token');
    });
  });
});
