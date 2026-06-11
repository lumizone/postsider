import { AgentToolInterface } from '@postsider/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@postsider/nestjs-libraries/chat/auth.context';
import { ConnectorCatalogService } from '@postsider/nestjs-libraries/integrations/connector.catalog';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';

@Injectable()
export class ConnectorAuthorizeTool implements AgentToolInterface {
  constructor(
    private _catalog: ConnectorCatalogService,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager
  ) {}
  name = 'connectorAuthorize';

  run() {
    return createTool({
      id: 'connectorAuthorize',
      description: `Start authorizing a connector for the organization. Returns an OAuth URL for a human to open, or confirms the connector is already authorized. Agents cannot complete OAuth themselves — present the URL to a human.`,
      inputSchema: z.object({
        connector: z.string().describe('Connector identifier, e.g. "linkedin"'),
      }),
      mcp: {
        annotations: {
          title: 'Authorize Connector',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      outputSchema: z.object({
        authorized: z.boolean(),
        url: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;
        const connector = (inputData as any).connector as string;

        if (!this._catalog.getConnector(connector)) {
          throw new Error(`Unknown connector "${connector}"`);
        }

        const integrations =
          await this._integrationService.getIntegrationsList(organizationId);
        const already = (integrations || []).some(
          (i: any) => i.providerIdentifier === connector && !i.disabled
        );
        if (already) {
          return { authorized: true };
        }

        if (
          !this._integrationManager
            .getAllowedSocialsIntegrations()
            .includes(connector)
        ) {
          throw new Error(`Connector "${connector}" is not connectable via OAuth`);
        }

        const provider = this._integrationManager.getSocialIntegration(connector);
        if (provider.externalUrl) {
          throw new Error(
            `Connector "${connector}" is not connectable via the Agent Bridge`
          );
        }

        const { codeVerifier, state, url } = await provider.generateAuthUrl();
        await ioRedis.set(`organization:${state}`, organizationId, 'EX', 3600);
        await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);
        return { authorized: false, url };
      },
    });
  }
}
