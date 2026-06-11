import { AgentToolInterface } from '@postsider/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@postsider/nestjs-libraries/chat/auth.context';
import { ConnectorCatalogService } from '@postsider/nestjs-libraries/integrations/connector.catalog';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';

@Injectable()
export class ConnectorsListTool implements AgentToolInterface {
  constructor(
    private _catalog: ConnectorCatalogService,
    private _integrationService: IntegrationService
  ) {}
  name = 'connectorsList';

  run() {
    return createTool({
      id: 'connectorsList',
      description: `Lists the available connectors (social channels, communities, email) with their declared capabilities (PUBLISH, SOURCE, ANALYTICS, SCHEDULE) and whether the current organization has authorized each one.`,
      inputSchema: z.object({}),
      mcp: {
        annotations: {
          title: 'List Connectors',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        output: z.array(
          z.object({
            identifier: z.string(),
            label: z.string(),
            capabilities: z.array(z.string()),
            authorized: z.boolean(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const integrations =
          await this._integrationService.getIntegrationsList(organizationId);
        const authorized = new Set<string>(
          (integrations || [])
            .filter((i: any) => !i.disabled)
            .map((i: any) => i.providerIdentifier)
        );
        return {
          output: this._catalog.listForOrganization(authorized).map((c) => ({
            identifier: c.identifier,
            label: c.label,
            capabilities: c.capabilities,
            authorized: c.authorized,
          })),
        };
      },
    });
  }
}
