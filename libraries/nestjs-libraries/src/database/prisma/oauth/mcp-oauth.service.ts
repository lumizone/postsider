import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { McpOAuthRepository } from '@postsider/nestjs-libraries/database/prisma/oauth/mcp-oauth.repository';
import {
  McpRegisterDto,
  MCP_SUPPORTED_SCOPES,
} from '@postsider/nestjs-libraries/dtos/oauth/mcp.dto';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';

/** Access tokens live 15 minutes (locked decision 14). */
export const MCP_ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
/** Refresh tokens live 30 days and rotate on every use (locked decision 14). */
export const MCP_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A pending consent expires after 10 minutes. */
export const MCP_PENDING_TTL_MS = 10 * 60 * 1000;
/** An authorization code expires after 10 minutes. */
export const MCP_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Only organization admins may approve an MCP consent (locked decision 16,
 * consistent with the legacy OAuth app policy).
 */
const CONSENT_ROLES = ['ADMIN', 'SUPERADMIN'];

/** RFC 7636 §4.1: 43-128 characters of the unreserved set. */
const PKCE_VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
/** S256 challenge: base64url-encoded SHA-256, i.e. 43 characters of base64url. */
const PKCE_CHALLENGE_RE = /^[A-Za-z0-9\-_]{43}$/;

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/**
 * A redirect URI is acceptable when it is https anywhere, or plain http on a
 * loopback host (native MCP clients run a local callback server). Fragments
 * are forbidden — the client appends query parameters itself.
 */
export function isValidRedirectUri(uri: string): boolean {
  if (!uri || uri.length > 2048) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) {
    return false;
  }
  if (url.protocol === 'https:') {
    return true;
  }
  if (url.protocol === 'http:') {
    return LOOPBACK_HOSTS.includes(url.hostname.toLowerCase());
  }
  return false;
}

/** S256 verification with a constant-time comparison. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !PKCE_VERIFIER_RE.test(verifier)) {
    return false;
  }
  const digest = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(digest);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

const oauthError = (
  error: string,
  description?: string,
  status: HttpStatus = HttpStatus.BAD_REQUEST
) =>
  new HttpException(
    { error, ...(description ? { error_description: description } : {}) },
    status
  );

const parseScopes = (value?: string | null): string[] =>
  (value || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The MCP OAuth 2.1 authorization server (RFC 8414 metadata, RFC 7591 DCR,
 * RFC 7636 PKCE, RFC 7662 introspection, RFC 7009 revocation, OIDC-style
 * UserInfo). It is a function of the same PostSider backend — same database,
 * same membership model — not a separate service.
 */
@Injectable()
export class McpOAuthService {
  constructor(private _repository: McpOAuthRepository) {}

  // --- discovery ------------------------------------------------------------

  issuer(): string {
    return (process.env.MCP_OAUTH_ISSUER || 'https://api.postsider.com').replace(
      /\/+$/,
      ''
    );
  }

  private consentBaseUrl(): string {
    if (process.env.MCP_CONSENT_URL) {
      return process.env.MCP_CONSENT_URL.replace(/\/+$/, '');
    }
    const frontend = (process.env.FRONTEND_URL || '').replace(/\/+$/, '');
    return `${frontend}/oauth/consent`;
  }

  authorizationServerMetadata() {
    const issuer = this.issuer();
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      revocation_endpoint: `${issuer}/oauth/revoke`,
      introspection_endpoint: `${issuer}/oauth/introspect`,
      userinfo_endpoint: `${issuer}/oauth/userinfo`,
      scopes_supported: [...MCP_SUPPORTED_SCOPES],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      code_challenge_methods_supported: ['S256'],
      service_documentation: 'https://docs.postsider.com/agent/mcp/overview',
    };
  }

  // --- dynamic client registration (RFC 7591) -------------------------------

  async registerClient(dto: McpRegisterDto, ip: string | null) {
    const redirectUris = dto.redirect_uris.map((u) => u.trim());
    for (const uri of redirectUris) {
      if (!isValidRedirectUri(uri)) {
        throw oauthError(
          'invalid_redirect_uri',
          `Unsupported redirect_uri: ${uri}`
        );
      }
    }

    // Default new clients to read-only (T4 mitigation); unknown scope values
    // are ignored rather than rejected so a client asking for a superset can
    // still register.
    const requested = parseScopes(dto.scope);
    const granted = requested.filter((s) => MCP_SUPPORTED_SCOPES.includes(s));
    const scopes = granted.length ? granted : ['posts:read'];

    const method = dto.token_endpoint_auth_method || 'none';
    const clientId = 'pmc_' + makeId(32);
    const clientSecret = method === 'client_secret_post' ? 'pms_' + makeId(48) : null;

    await this._repository.createClient({
      clientId,
      name: dto.client_name,
      redirectUris,
      scopes,
      tokenEndpointAuthMethod: method,
      clientSecret: clientSecret ? AuthService.fixedEncryption(clientSecret) : null,
      registrationIp: ip,
    });

    return {
      client_id: clientId,
      client_name: dto.client_name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: method,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: scopes.join(' '),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    };
  }

  getClient(clientId: string) {
    return this._repository.getClientByClientId(clientId);
  }

  // --- authorization + consent ----------------------------------------------

  /**
   * Validates an authorization request from a DCR client and records a pending
   * consent. The caller (controller) redirects the browser to the returned
   * consent URL — the user then approves on a page where they are logged in.
   */
  async beginAuthorization(input: {
    clientId: string;
    redirectUri?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    scope?: string;
    state?: string;
  }) {
    const client = await this._repository.getClientByClientId(input.clientId);
    if (!client) {
      throw oauthError('invalid_request', 'Unknown client_id');
    }
    if (input.codeChallengeMethod && input.codeChallengeMethod !== 'S256') {
      throw oauthError('invalid_request', 'Only S256 PKCE is supported');
    }
    if (!input.codeChallenge || !PKCE_CHALLENGE_RE.test(input.codeChallenge)) {
      throw oauthError(
        'invalid_request',
        'code_challenge (S256) is required for this client'
      );
    }
    if (!input.redirectUri || !client.redirectUris.includes(input.redirectUri)) {
      throw oauthError(
        'invalid_request',
        'redirect_uri must exactly match a registered redirect URI'
      );
    }

    const requested = parseScopes(input.scope);
    const granted = requested.filter((s) => MCP_SUPPORTED_SCOPES.includes(s));
    const scopes = granted.length ? granted : ['posts:read'];

    const pending = await this._repository.createPending({
      mcpOAuthClientId: client.id,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      scopes,
      state: input.state ?? null,
      redirectUri: input.redirectUri,
      expiresAt: new Date(Date.now() + MCP_PENDING_TTL_MS),
    });

    return {
      pendingId: pending.id,
      consentUrl: `${this.consentBaseUrl()}?request=${pending.id}`,
    };
  }

  private async loadLivePending(pendingId: string) {
    const pending = await this._repository.getPendingById(pendingId);
    if (!pending || pending.consumedAt || pending.expiresAt < new Date()) {
      throw oauthError(
        'invalid_request',
        'This authorization request has expired or was already used',
        HttpStatus.NOT_FOUND
      );
    }
    return pending;
  }

  /** Consent-page data: what the user is being asked to approve. */
  async getConsentRequest(pendingId: string) {
    const pending = await this.loadLivePending(pendingId);
    return {
      id: pending.id,
      clientName: pending.client.name,
      scopes: pending.scopes,
      redirectUri: pending.redirectUri,
    };
  }

  /** Organizations the current user may grant from the consent screen. */
  async getConsentOrganizations(userId: string) {
    const memberships = await this._repository.listOrgMemberships(userId);
    return memberships.filter((m) => CONSENT_ROLES.includes(m.role));
  }

  /**
   * Approve or deny a pending consent. On approve: re-activates (or creates)
   * the grant for (client, user, org), issues a one-time code, and returns the
   * redirect the browser must follow. On deny: returns the error redirect.
   */
  async approveOrDeny(input: {
    pendingId: string;
    userId: string;
    organizationId?: string;
    action: 'approve' | 'deny';
    scopes?: string[];
  }) {
    const pending = await this.loadLivePending(input.pendingId);

    const buildRedirect = (params: Record<string, string>) => {
      const url = new URL(pending.redirectUri);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      if (pending.state) {
        url.searchParams.set('state', pending.state);
      }
      return url.toString();
    };

    // Atomically claim the pending row so a double-submit cannot mint two codes.
    const claimed = await this._repository.claimPending(pending.id);
    if (!claimed) {
      throw oauthError(
        'invalid_request',
        'This authorization request has expired or was already used'
      );
    }

    if (input.action === 'deny') {
      return { redirect: buildRedirect({ error: 'access_denied' }) };
    }

    if (!input.organizationId) {
      throw oauthError('invalid_request', 'organization_id is required');
    }

    const membership = await this._repository.getMembership(
      input.userId,
      input.organizationId
    );
    if (!membership) {
      throw new HttpException(
        'You are not an active member of this organization',
        HttpStatus.FORBIDDEN
      );
    }
    if (!CONSENT_ROLES.includes(membership.role)) {
      throw new HttpException(
        'Only organization administrators can authorize MCP access',
        HttpStatus.FORBIDDEN
      );
    }

    // The approver may narrow the request but never widen it: a scope outside
    // the client's request is a bug (or an attack) and is rejected outright.
    let scopes = pending.scopes;
    if (input.scopes) {
      const widened = input.scopes.filter((s) => !pending.scopes.includes(s));
      if (widened.length) {
        throw oauthError(
          'invalid_request',
          'Requested scopes exceed the client request'
        );
      }
      const narrowed = input.scopes.filter((s) =>
        MCP_SUPPORTED_SCOPES.includes(s)
      );
      if (!narrowed.length) {
        throw oauthError('invalid_request', 'No supported scopes selected');
      }
      scopes = narrowed;
    }

    await this._repository.upsertGrant({
      mcpOAuthClientId: pending.mcpOAuthClientId,
      userId: input.userId,
      organizationId: input.organizationId,
      scopes,
    });

    const code = makeId(48);
    await this._repository.createCode({
      codeHash: AuthService.fixedEncryption(code),
      mcpOAuthClientId: pending.mcpOAuthClientId,
      userId: input.userId,
      organizationId: input.organizationId,
      scopes,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      redirectUri: pending.redirectUri,
      expiresAt: new Date(Date.now() + MCP_CODE_TTL_MS),
    });

    return { redirect: buildRedirect({ code }) };
  }

  // --- token endpoint -------------------------------------------------------

  private assertClientAuth(
    client: { tokenEndpointAuthMethod: string; clientSecret: string | null },
    clientSecret?: string
  ) {
    if (client.tokenEndpointAuthMethod === 'none') {
      return;
    }
    if (
      !clientSecret ||
      client.clientSecret !== AuthService.fixedEncryption(clientSecret)
    ) {
      throw oauthError('invalid_client', undefined, HttpStatus.UNAUTHORIZED);
    }
  }

  private async issueTokens(grantId: string, scopes: string[]) {
    const accessToken = 'pos_' + makeId(40);
    const refreshToken = 'psr_' + makeId(48);
    const accessRecord = await this._repository.createAccessToken({
      tokenHash: AuthService.fixedEncryption(accessToken),
      grantId,
      expiresAt: new Date(Date.now() + MCP_ACCESS_TOKEN_TTL_MS),
    });
    const refreshRecord = await this._repository.createRefreshToken({
      tokenHash: AuthService.fixedEncryption(refreshToken),
      grantId,
      expiresAt: new Date(Date.now() + MCP_REFRESH_TOKEN_TTL_MS),
    });
    return {
      body: {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: Math.floor(MCP_ACCESS_TOKEN_TTL_MS / 1000),
        refresh_token: refreshToken,
        scope: scopes.join(' '),
      },
      accessRecord,
      refreshRecord,
    };
  }

  /**
   * Authorization code exchange. Always PKCE-verified; confidential clients
   * additionally authenticate with their secret. Codes are single-use.
   */
  async exchangeCode(input: {
    code?: string;
    clientId: string;
    clientSecret?: string;
    codeVerifier?: string;
    redirectUri?: string;
  }) {
    const client = await this._repository.getClientByClientId(input.clientId);
    if (!client) {
      throw oauthError('invalid_client', undefined, HttpStatus.UNAUTHORIZED);
    }
    this.assertClientAuth(client, input.clientSecret);

    if (!input.code) {
      throw oauthError('invalid_request', 'code is required');
    }

    const record = await this._repository.getCodeByHash(
      AuthService.fixedEncryption(input.code)
    );
    if (!record || record.mcpOAuthClientId !== client.id) {
      throw oauthError('invalid_grant', 'Invalid or unknown code');
    }
    if (record.expiresAt < new Date()) {
      throw oauthError('invalid_grant', 'Code has expired');
    }

    // A redeemed code presented again is a replay: the reply is a plain error,
    // and the grant behind it is revoked defensively.
    if (record.consumedAt) {
      const grant = await this._repository.getGrantByTriple(
        record.mcpOAuthClientId,
        record.userId,
        record.organizationId
      );
      if (grant && !grant.revokedAt) {
        await this._repository.revokeGrantChain(grant.id, 'code_replay_detected');
      }
      throw oauthError('invalid_grant', 'Code has already been used');
    }

    const claimed = await this._repository.claimCode(record.id);
    if (!claimed) {
      throw oauthError('invalid_grant', 'Code has already been used');
    }

    if (!input.codeVerifier || !verifyPkceS256(input.codeVerifier, record.codeChallenge)) {
      throw oauthError('invalid_grant', 'PKCE verification failed');
    }

    // The token request must repeat the redirect_uri (RFC 6749 §4.1.3) — but
    // tolerate an omitted one only when the client has exactly one registered
    // URI, which is unambiguous.
    if (input.redirectUri) {
      if (input.redirectUri !== record.redirectUri) {
        throw oauthError('invalid_grant', 'redirect_uri mismatch');
      }
    } else if (client.redirectUris.length !== 1) {
      throw oauthError('invalid_request', 'redirect_uri is required');
    }

    const grant = await this._repository.getGrantByTriple(
      record.mcpOAuthClientId,
      record.userId,
      record.organizationId
    );
    if (!grant || grant.revokedAt) {
      throw oauthError('invalid_grant', 'The authorization was revoked');
    }

    const { body } = await this.issueTokens(grant.id, record.scopes);
    void this._repository.touchGrant(grant.id).catch(() => undefined);
    return body;
  }

  /**
   * Refresh with rotation and reuse detection: a refresh token can be used
   * exactly once; presenting a rotated one revokes the whole chain (locked
   * decision 14).
   */
  async refresh(input: {
    refreshToken?: string;
    clientId: string;
    clientSecret?: string;
  }) {
    const client = await this._repository.getClientByClientId(input.clientId);
    if (!client) {
      throw oauthError('invalid_client', undefined, HttpStatus.UNAUTHORIZED);
    }
    this.assertClientAuth(client, input.clientSecret);

    if (!input.refreshToken) {
      throw oauthError('invalid_request', 'refresh_token is required');
    }

    const record = await this._repository.getRefreshByHash(
      AuthService.fixedEncryption(input.refreshToken)
    );
    if (!record || record.grant.mcpOAuthClientId !== client.id) {
      throw oauthError('invalid_grant', 'Invalid or unknown refresh token');
    }

    if (record.revokedAt) {
      await this._repository.revokeGrantChain(
        record.grantId,
        'refresh_token_reuse_detected'
      );
      throw oauthError(
        'invalid_grant',
        'Refresh token reuse detected; the grant was revoked'
      );
    }
    if (record.expiresAt < new Date() || record.grant.revokedAt) {
      throw oauthError('invalid_grant', 'Refresh token expired or revoked');
    }

    const claimed = await this._repository.claimRefreshToken(record.id);
    if (!claimed) {
      await this._repository.revokeGrantChain(
        record.grantId,
        'refresh_token_reuse_detected'
      );
      throw oauthError(
        'invalid_grant',
        'Refresh token reuse detected; the grant was revoked'
      );
    }

    const { body, refreshRecord } = await this.issueTokens(
      record.grantId,
      record.grant.scopes
    );
    await this._repository.setRefreshReplacedBy(record.id, refreshRecord.id);
    void this._repository.touchGrant(record.grantId).catch(() => undefined);
    return body;
  }

  // --- introspection / revocation / userinfo --------------------------------

  /**
   * RFC 7662 introspection for the MCP resource server. Active means: token
   * exists, is not revoked, is not expired, the grant is alive, and the user
   * is still an active member of the organization.
   */
  async introspect(token: string) {
    const tokenHash = AuthService.fixedEncryption(token);

    const access = await this._repository.getAccessByHash(tokenHash);
    if (access) {
      if (access.revokedAt || access.expiresAt < new Date() || access.grant.revokedAt) {
        return { active: false };
      }
      const membership = await this._repository.getMembership(
        access.grant.userId,
        access.grant.organizationId
      );
      if (!membership || !access.grant.user.activated) {
        return { active: false };
      }
      void this._repository.touchGrant(access.grant.id).catch(() => undefined);
      return {
        active: true,
        scope: access.grant.scopes.join(' '),
        client_id: access.grant.client.clientId,
        sub: access.grant.userId,
        org: access.grant.organizationId,
        token_type: 'Bearer',
        username: access.grant.user.email,
        iat: Math.floor(access.createdAt.getTime() / 1000),
        exp: Math.floor(access.expiresAt.getTime() / 1000),
      };
    }

    const refresh = await this._repository.getRefreshByHash(tokenHash);
    if (refresh) {
      if (refresh.revokedAt || refresh.expiresAt < new Date() || refresh.grant.revokedAt) {
        return { active: false };
      }
      return {
        active: true,
        token_type: 'refresh_token',
        sub: refresh.grant.userId,
        org: refresh.grant.organizationId,
        exp: Math.floor(refresh.expiresAt.getTime() / 1000),
      };
    }

    return { active: false };
  }

  /**
   * RFC 7009 revocation. Revoking a refresh token disconnects the client:
   * the whole grant chain is revoked (grant row first, then tokens), which is
   * what a user clicking "disconnect" expects.
   */
  async revokeToken(token: string) {
    const tokenHash = AuthService.fixedEncryption(token);

    const access = await this._repository.getAccessByHash(tokenHash);
    if (access && !access.revokedAt) {
      await this._repository.revokeGrantChain(access.grantId, 'user_revoked');
      return {};
    }

    const refresh = await this._repository.getRefreshByHash(tokenHash);
    if (refresh && !refresh.revokedAt) {
      await this._repository.revokeGrantChain(refresh.grantId, 'user_revoked');
    }
    return {};
  }

  /**
   * OIDC-style UserInfo. `email_verified` uses the best signal PostSider has:
   * an activated account (the signup flow only activates accounts that
   * completed email verification).
   */
  async userinfo(accessToken: string) {
    const record = await this._repository.getAccessByHash(
      AuthService.fixedEncryption(accessToken)
    );
    if (!record || record.revokedAt || record.expiresAt < new Date() || record.grant.revokedAt) {
      throw oauthError('invalid_token', undefined, HttpStatus.UNAUTHORIZED);
    }
    const membership = await this._repository.getMembership(
      record.grant.userId,
      record.grant.organizationId
    );
    if (!membership || !record.grant.user.activated) {
      throw oauthError('invalid_token', undefined, HttpStatus.UNAUTHORIZED);
    }

    const name = [record.grant.user.name, record.grant.user.lastName]
      .filter(Boolean)
      .join(' ');

    return {
      sub: record.grant.userId,
      email: record.grant.user.email,
      email_verified: record.grant.user.activated,
      ...(name ? { name } : {}),
    };
  }
}
