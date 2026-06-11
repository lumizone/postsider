import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Capability } from '@prisma/client';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import {
  AgentTokenRepository,
  AgentTokenScope,
} from '@postsider/nestjs-libraries/database/prisma/agent-tokens/agent-token.repository';

export const AGENT_TOKEN_PREFIX = 'agt_';

export type AuthorizationDenial =
  | 'connector_not_authorized'
  | 'capability_not_allowed';

export interface VerifiedAgentToken {
  id: string;
  organizationId: string;
  connectors: string[];
  capabilities: Capability[];
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  organization: any;
}

@Injectable()
export class AgentTokenService {
  constructor(private _repository: AgentTokenRepository) {}

  /** One-way hash of a raw token. Tokens are high-entropy, so sha256 is enough
   * and gives a fast unique-index lookup (Requirement 21.1). */
  static hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Issue a new scoped agent token. Returns the plaintext exactly once; only
   * the hash is persisted (Requirements 15.1, 21.1, 24.3).
   */
  async issue(
    organizationId: string,
    name: string,
    scope: AgentTokenScope
  ): Promise<{ id: string; name: string; token: string }> {
    const rawToken = AGENT_TOKEN_PREFIX + makeId(40);
    const tokenHash = AgentTokenService.hashToken(rawToken);
    const created = await this._repository.create(
      organizationId,
      name,
      tokenHash,
      {
        connectors: scope.connectors ?? [],
        capabilities: scope.capabilities ?? [],
        expiresAt: scope.expiresAt ?? null,
        rateLimitPerMinute: scope.rateLimitPerMinute,
        rateLimitPerDay: scope.rateLimitPerDay,
      }
    );
    return { id: created.id, name: created.name, token: rawToken };
  }

  /**
   * Verify a raw token. The verdict is independent of the order in which
   * signature/expiration/revocation are checked (Correctness Property 8):
   * any failing condition rejects, regardless of evaluation order.
   */
  async verify(rawToken: string): Promise<VerifiedAgentToken | null> {
    if (!rawToken || !rawToken.startsWith(AGENT_TOKEN_PREFIX)) {
      return null;
    }
    const tokenHash = AgentTokenService.hashToken(rawToken);
    const token = await this._repository.findByHash(tokenHash);
    if (!token) {
      return null;
    }

    const isRevoked = token.revokedAt != null;
    const isExpired = token.expiresAt != null && token.expiresAt.getTime() <= Date.now();
    if (isRevoked || isExpired) {
      return null;
    }

    // Best-effort last-used tracking; never blocks verification.
    this._repository.touchLastUsed(token.id).catch(() => {});

    return {
      id: token.id,
      organizationId: token.organizationId,
      connectors: token.connectors,
      capabilities: token.capabilities,
      rateLimitPerMinute: token.rateLimitPerMinute,
      rateLimitPerDay: token.rateLimitPerDay,
      organization: token.organization,
    };
  }

  /**
   * Check whether a verified token is authorized to use a capability on a
   * connector. Returns null when allowed, or a denial code (Requirement 14.8).
   * An empty connector scope means "all connectors authorized by the org".
   */
  authorize(
    token: Pick<VerifiedAgentToken, 'connectors' | 'capabilities'>,
    connectorId: string | undefined,
    capability: Capability
  ): AuthorizationDenial | null {
    if (!token.capabilities.includes(capability)) {
      return 'capability_not_allowed';
    }
    if (
      connectorId &&
      token.connectors.length > 0 &&
      !token.connectors.includes(connectorId)
    ) {
      return 'connector_not_authorized';
    }
    return null;
  }

  list(organizationId: string) {
    return this._repository.listByOrg(organizationId);
  }

  revoke(organizationId: string, id: string) {
    return this._repository.revoke(organizationId, id);
  }
}
