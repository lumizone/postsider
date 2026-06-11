import { Injectable } from '@nestjs/common';
import { Capability, Organization } from '@prisma/client';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { ConnectorCatalogService } from '@postsider/nestjs-libraries/integrations/connector.catalog';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import {
  AgentRateLimiter,
  RateLimitResult,
} from '@postsider/nestjs-libraries/services/agent-rate-limit.service';
import {
  AgentTokenService,
  VerifiedAgentToken,
} from '@postsider/nestjs-libraries/database/prisma/agent-tokens/agent-token.service';

export interface BridgeError {
  error: {
    code: string;
    message: string;
    retryAfter?: number;
  };
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Thin orchestration layer for agent operations (Requirement 14). Pipeline:
 *   authorize scope -> rate limit -> audit start -> delegate -> audit result.
 *
 * Business logic for publishing/analytics stays in the existing services; this
 * service only adds scope enforcement, rate limiting, idempotency and audit.
 */
@Injectable()
export class AgentBridgeService {
  constructor(
    private _catalog: ConnectorCatalogService,
    private _integrationService: IntegrationService,
    private _auditLogger: AuditLogger,
    private _rateLimiter: AgentRateLimiter,
    private _agentTokenService: AgentTokenService
  ) {}

  private static bridgeError(
    code: string,
    message: string,
    retryAfter?: number
  ): BridgeError {
    return { error: { code, message, ...(retryAfter ? { retryAfter } : {}) } };
  }

  /**
   * List connectors filtered to those the organization has authorized
   * (Requirement 14.1).
   */
  async listConnectors(org: Organization, correlationId: string) {
    const integrations = await this._integrationService.getIntegrationsList(
      org.id
    );
    const authorized = new Set<string>(
      (integrations || [])
        .filter((i: any) => !i.disabled)
        .map((i: any) => i.providerIdentifier)
    );
    const result = this._catalog.listForOrganization(authorized);
    await this._auditLogger.log({
      organizationId: org.id,
      operation: 'listConnectors',
      correlationId,
      status: 'ok',
    });
    return result;
  }

  /**
   * Enforce scope + rate limits for an operation on a connector. Returns a
   * BridgeError on denial (already audited), or null when allowed.
   */
  async guard(
    token: VerifiedAgentToken | undefined,
    org: Organization,
    operation: string,
    capability: Capability,
    connectorId: string | undefined,
    correlationId: string,
    input?: unknown
  ): Promise<BridgeError | null> {
    // Scope check (only when an agent token is present; org API keys are
    // full-scope by design and skip per-capability checks).
    if (token) {
      const denial = this._agentTokenService.authorize(
        token,
        connectorId,
        capability
      );
      if (denial) {
        await this._auditLogger.log({
          organizationId: org.id,
          agentTokenId: token.id,
          operation,
          connectorId,
          correlationId,
          status: denial,
          type: denial,
          input,
        });
        return AgentBridgeService.bridgeError(
          denial,
          denial === 'connector_not_authorized'
            ? 'The calling agent is not authorized for this connector.'
            : 'The calling agent token does not grant this capability.'
        );
      }

      // Rate limit (per token).
      const rl: RateLimitResult = await this._rateLimiter.consume(
        token.id,
        token.rateLimitPerMinute,
        token.rateLimitPerDay
      );
      if (!rl.allowed) {
        await this._auditLogger.log({
          organizationId: org.id,
          agentTokenId: token.id,
          operation,
          connectorId,
          correlationId,
          status: 'rate_limited',
          type: 'rate_limited',
        });
        return AgentBridgeService.bridgeError(
          'rate_limited',
          `Rate limit exceeded (${rl.exceeded}). Retry later.`,
          rl.retryAfter
        );
      }
    }

    return null;
  }

  /**
   * Idempotency check for publishPost (Requirement 14.10, Correctness Property 6).
   * Returns a previously stored publication id when the key was already used,
   * otherwise null. Call `rememberIdempotent` after a successful publish.
   */
  async lookupIdempotent(
    orgId: string,
    key: string | undefined
  ): Promise<string | null> {
    if (!key) return null;
    return (await ioRedis.get(`idem:${orgId}:${key}`)) as unknown as
      | string
      | null;
  }

  async rememberIdempotent(
    orgId: string,
    key: string | undefined,
    publicationId: string
  ): Promise<void> {
    if (!key) return;
    await ioRedis.set(
      `idem:${orgId}:${key}`,
      publicationId,
      'EX',
      IDEMPOTENCY_TTL_SECONDS
    );
  }

  /**
   * getAnalytics with capability awareness (Requirement 14.5). Returns a
   * structured error when the connector does not declare ANALYTICS.
   */
  async getAnalytics(
    org: Organization,
    connectorId: string,
    date: string,
    correlationId: string,
    token?: VerifiedAgentToken
  ) {
    const connector = this._catalog.getConnector(connectorId);
    if (!connector || !connector.capabilities.includes('ANALYTICS')) {
      await this._auditLogger.log({
        organizationId: org.id,
        agentTokenId: token?.id,
        operation: 'getAnalytics',
        connectorId,
        correlationId,
        status: 'analytics_not_supported',
        type: 'analytics_not_supported',
      });
      return AgentBridgeService.bridgeError(
        'analytics_not_supported',
        `Connector "${connectorId}" does not support analytics.`
      );
    }
    const data = await this._integrationService.checkAnalytics(
      org,
      connectorId,
      date
    );
    await this._auditLogger.log({
      organizationId: org.id,
      agentTokenId: token?.id,
      operation: 'getAnalytics',
      connectorId,
      correlationId,
      status: 'ok',
    });
    return data;
  }

  /** Whether the organization requires human approval for agent publications. */
  isHitlEnabled(org: Organization): boolean {
    return !!(org as any).hitlMode;
  }
}
