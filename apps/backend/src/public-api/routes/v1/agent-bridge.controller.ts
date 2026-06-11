import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { AgentBridgeService } from '@postsider/nestjs-libraries/agent-bridge/agent-bridge.service';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { ConnectorCatalogService } from '@postsider/nestjs-libraries/integrations/connector.catalog';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { VerifiedAgentToken } from '@postsider/nestjs-libraries/database/prisma/agent-tokens/agent-token.service';
import { InboundService } from '@postsider/nestjs-libraries/database/prisma/inbound/inbound.service';
import { InboundSourceRegistry } from '@postsider/nestjs-libraries/integrations/inbound/inbound.registry';

/** Pull the agent token (if any) and correlation id off the request. */
function ctx(req: Request): { token?: VerifiedAgentToken; correlationId: string } {
  // @ts-ignore — set by middleware
  const token: VerifiedAgentToken | undefined = req.agentToken;
  const correlationId =
    // @ts-ignore — set by RequestIdMiddleware
    (req.requestId as string) ||
    (req.headers['x-request-id'] as string) ||
    (req.headers['x-correlation-id'] as string) ||
    'no-correlation';
  return { token, correlationId };
}

@ApiTags('Agent Bridge')
@Controller('/public/v1')
export class AgentBridgeController {
  constructor(
    private _agentBridge: AgentBridgeService,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _catalog: ConnectorCatalogService,
    private _inboundService: InboundService,
    private _inboundRegistry: InboundSourceRegistry
  ) {}

  /** Requirement 14.1 — list connectors filtered to the org's authorizations. */
  @Get('/connectors')
  async listConnectors(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request
  ) {
    const { correlationId } = ctx(req);
    return this._agentBridge.listConnectors(org, correlationId);
  }

  /**
   * Requirement 14.2 — return an OAuth authorization URL for the connector, or
   * confirm it is already authorized.
   */
  @Post('/connectors/:id/authorize')
  async authorizeConnector(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Req() req: Request
  ) {
    const connector = this._catalog.getConnector(id);
    if (!connector) {
      throw new HttpException({ msg: 'Unknown connector' }, 404);
    }

    const integrations = await this._integrationService.getIntegrationsList(
      org.id
    );
    const already = (integrations || []).some(
      (i: any) => i.providerIdentifier === id && !i.disabled
    );
    if (already) {
      return { authorized: true };
    }

    if (!this._integrationManager.getAllowedSocialsIntegrations().includes(id)) {
      throw new HttpException({ msg: 'Connector not available for OAuth' }, 400);
    }

    const provider = this._integrationManager.getSocialIntegration(id);
    if (provider.externalUrl) {
      throw new HttpException(
        { msg: 'This connector is not connectable via the Agent Bridge' },
        400
      );
    }

    try {
      const { codeVerifier, state, url } = await provider.generateAuthUrl();
      await ioRedis.set(`organization:${state}`, org.id, 'EX', 3600);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);
      return { authorized: false, url };
    } catch {
      throw new HttpException({ msg: 'Failed to generate auth URL' }, 500);
    }
  }

  /** Requirement 14.5 — analytics with capability awareness. */
  @Get('/connectors/:id/analytics')
  async getAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('date') date: string,
    @Req() req: Request
  ) {
    const { token, correlationId } = ctx(req);
    return this._agentBridge.getAnalytics(org, id, date, correlationId, token);
  }

  /**
   * Requirement 14.6 / 19.2 — subscribe to inbound source events. Returns the
   * per-subscription HMAC secret exactly once.
   */
  @Post('/inbound/subscriptions')
  async subscribeInbound(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { sources: string[]; webhookUrl: string }
  ) {
    if (!body?.webhookUrl || !Array.isArray(body?.sources) || !body.sources.length) {
      throw new HttpException(
        { msg: 'sources[] and webhookUrl are required' },
        400
      );
    }
    return this._inboundService.subscribe(org.id, body.sources, body.webhookUrl);
  }

  @Get('/inbound/subscriptions')
  async listInbound(@GetOrgFromRequest() org: Organization) {
    return this._inboundService.list(org.id);
  }

  /**
   * Requirement 14.7 — fetch a paginated page of items from an inbound source.
   * `cursor` is the opaque value returned by the previous call.
   */
  @Get('/inbound/:source')
  async fetchSourceContent(
    @GetOrgFromRequest() org: Organization,
    @Param('source') source: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    if (!this._inboundRegistry.has(source)) {
      throw new HttpException(
        { msg: `Source "${source}" is not an inbound source` },
        400
      );
    }
    return this._inboundRegistry.fetch(
      org.id,
      source,
      cursor,
      limit ? Math.min(Math.max(+limit, 1), 100) : undefined
    );
  }
}
