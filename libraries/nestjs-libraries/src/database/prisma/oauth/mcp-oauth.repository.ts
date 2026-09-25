import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

/**
 * Persistence for the MCP OAuth authorization server (Phase 2).
 *
 * Kept separate from the legacy `OAuthRepository` on purpose: the legacy tables
 * model "one OAuth app per organization" with non-expiring tokens, while DCR
 * clients, pending consents, codes, grants, and rotating tokens are a new
 * domain with its own lifecycle. Both feed the same public API credential path
 * (see `OAuthService.getOrgByOAuthToken`).
 */
@Injectable()
export class McpOAuthRepository {
  constructor(
    private _client: PrismaRepository<'mcpOAuthClient'>,
    private _pending: PrismaRepository<'mcpOAuthPendingAuthorization'>,
    private _code: PrismaRepository<'mcpOAuthCode'>,
    private _grant: PrismaRepository<'mcpOAuthGrant'>,
    private _access: PrismaRepository<'mcpOAuthAccessToken'>,
    private _refresh: PrismaRepository<'mcpOAuthRefreshToken'>,
    private _userOrg: PrismaRepository<'userOrganization'>
  ) {}

  // --- clients (DCR) -------------------------------------------------------

  createClient(data: {
    clientId: string;
    name: string;
    redirectUris: string[];
    scopes: string[];
    tokenEndpointAuthMethod: string;
    clientSecret: string | null;
    registrationIp: string | null;
  }) {
    return this._client.model.mcpOAuthClient.create({ data });
  }

  getClientByClientId(clientId: string) {
    return this._client.model.mcpOAuthClient.findUnique({
      where: { clientId },
    });
  }

  // --- pending authorizations (consent in progress) ------------------------

  createPending(data: {
    mcpOAuthClientId: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scopes: string[];
    state: string | null;
    redirectUri: string;
    expiresAt: Date;
  }) {
    return this._pending.model.mcpOAuthPendingAuthorization.create({ data });
  }

  getPendingById(id: string) {
    return this._pending.model.mcpOAuthPendingAuthorization.findUnique({
      where: { id },
      include: { client: true },
    });
  }

  /**
   * Atomically claim a pending authorization. Returns the number of rows
   * updated: 0 means another request already consumed it (double-approve race).
   */
  async claimPending(id: string) {
    const result = await this._pending.model.mcpOAuthPendingAuthorization.updateMany(
      {
        where: { id, consumedAt: null },
        data: { consumedAt: new Date() },
      }
    );
    return result.count;
  }

  // --- authorization codes --------------------------------------------------

  createCode(data: {
    codeHash: string;
    mcpOAuthClientId: string;
    userId: string;
    organizationId: string;
    scopes: string[];
    codeChallenge: string;
    codeChallengeMethod: string;
    redirectUri: string;
    expiresAt: Date;
  }) {
    return this._code.model.mcpOAuthCode.create({ data });
  }

  getCodeByHash(codeHash: string) {
    return this._code.model.mcpOAuthCode.findUnique({ where: { codeHash } });
  }

  /** One-shot claim of a code; 0 rows means it was already redeemed. */
  async claimCode(id: string) {
    const result = await this._code.model.mcpOAuthCode.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return result.count;
  }

  // --- grants ---------------------------------------------------------------

  upsertGrant(data: {
    mcpOAuthClientId: string;
    userId: string;
    organizationId: string;
    scopes: string[];
  }) {
    return this._grant.model.mcpOAuthGrant.upsert({
      where: {
        mcpOAuthClientId_userId_organizationId: {
          mcpOAuthClientId: data.mcpOAuthClientId,
          userId: data.userId,
          organizationId: data.organizationId,
        },
      },
      create: data,
      update: {
        scopes: data.scopes,
        revokedAt: null,
        revokedReason: null,
      },
    });
  }

  getGrantById(id: string) {
    return this._grant.model.mcpOAuthGrant.findUnique({
      where: { id },
      include: { client: true, user: true },
    });
  }

  getGrantByTriple(
    mcpOAuthClientId: string,
    userId: string,
    organizationId: string
  ) {
    return this._grant.model.mcpOAuthGrant.findUnique({
      where: {
        mcpOAuthClientId_userId_organizationId: {
          mcpOAuthClientId,
          userId,
          organizationId,
        },
      },
    });
  }

  touchGrant(id: string) {
    return this._grant.model.mcpOAuthGrant.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Revoke a grant and every token issued under it. The grant row is updated
   * first: every validation path checks `grant.revokedAt`, so the moment it is
   * set the whole chain is dead even if the token cleanup below fails. The
   * token updates are then best-effort bookkeeping.
   */
  async revokeGrantChain(grantId: string, reason: string) {
    const revoked = await this._grant.model.mcpOAuthGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    await Promise.all([
      this._access.model.mcpOAuthAccessToken.updateMany({
        where: { grantId, revokedAt: null },
        data: { revokedAt: revoked.revokedAt },
      }),
      this._refresh.model.mcpOAuthRefreshToken.updateMany({
        where: { grantId, revokedAt: null },
        data: { revokedAt: revoked.revokedAt },
      }),
    ]);
    return revoked;
  }

  // --- tokens ---------------------------------------------------------------

  createAccessToken(data: {
    tokenHash: string;
    grantId: string;
    expiresAt: Date;
  }) {
    return this._access.model.mcpOAuthAccessToken.create({ data });
  }

  createRefreshToken(data: {
    tokenHash: string;
    grantId: string;
    expiresAt: Date;
  }) {
    return this._refresh.model.mcpOAuthRefreshToken.create({ data });
  }

  getAccessByHash(tokenHash: string) {
    return this._access.model.mcpOAuthAccessToken.findUnique({
      where: { tokenHash },
      include: {
        grant: {
          include: {
            client: true,
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                lastName: true,
                activated: true,
              },
            },
          },
        },
      },
    });
  }

  getRefreshByHash(tokenHash: string) {
    return this._refresh.model.mcpOAuthRefreshToken.findUnique({
      where: { tokenHash },
      include: { grant: { include: { client: true } } },
    });
  }

  /** One-shot claim of a refresh token; 0 rows means it was already rotated. */
  async claimRefreshToken(id: string) {
    const result = await this._refresh.model.mcpOAuthRefreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  setRefreshReplacedBy(id: string, replacedById: string) {
    return this._refresh.model.mcpOAuthRefreshToken.update({
      where: { id },
      data: { replacedById },
    });
  }

  revokeAccessById(id: string) {
    return this._access.model.mcpOAuthAccessToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  revokeRefreshById(id: string) {
    return this._refresh.model.mcpOAuthRefreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  // --- shared lookups -------------------------------------------------------

  /**
   * Membership row for (user, org) that is still active — same shape and rules
   * as the legacy OAuth path: a token stays valid only while the authorizing
   * user is an active member of the organization.
   */
  getMembership(userId: string, organizationId: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        userId,
        organizationId,
        disabled: false,
        user: { activated: true },
      },
      select: {
        userId: true,
        role: true,
        disabled: true,
      },
    });
  }

  /** Organizations the user may grant from the consent screen. */
  async listOrgMemberships(userId: string) {
    const memberships = await this._userOrg.model.userOrganization.findMany({
      where: { userId, disabled: false, user: { activated: true } },
      select: {
        role: true,
        organization: { select: { id: true, name: true } },
      },
    });
    return memberships.map((m) => ({
      id: m.organization.id,
      name: m.organization.name,
      role: m.role,
    }));
  }

  /**
   * Public-API credential path for MCP access tokens. Returns the same
   * `{ organization, membership }` shape as the legacy lookup so
   * `PublicAuthMiddleware` treats both identically, plus `scopes` for
   * consumers that need them (the MCP resource server enforces per-tool).
   */
  async findActiveAccessForApi(tokenHash: string) {
    const row = await this._access.model.mcpOAuthAccessToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        grant: {
          include: {
            organization: {
              include: {
                subscription: {
                  select: {
                    subscriptionTier: true,
                    totalChannels: true,
                    isLifetime: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!row || row.grant.revokedAt) {
      return null;
    }

    const membership = await this.getMembership(
      row.grant.userId,
      row.grant.organizationId
    );
    if (!membership) {
      return null;
    }

    return {
      organization: row.grant.organization,
      membership,
      scopes: row.grant.scopes,
      mcpOAuthGrantId: row.grant.id,
    };
  }
}
