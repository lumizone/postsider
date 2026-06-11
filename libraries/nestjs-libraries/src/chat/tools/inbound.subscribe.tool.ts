import { AgentToolInterface } from '@postsider/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@postsider/nestjs-libraries/chat/auth.context';
import { InboundService } from '@postsider/nestjs-libraries/database/prisma/inbound/inbound.service';

@Injectable()
export class InboundSubscribeTool implements AgentToolInterface {
  constructor(private _inboundService: InboundService) {}
  name = 'inboundSubscribe';

  run() {
    return createTool({
      id: 'inboundSubscribe',
      description: `Subscribe a webhook URL to inbound events from one or more SOURCE-capable connectors. Returns a per-subscription HMAC secret (shown once) used to verify delivered events.`,
      inputSchema: z.object({
        sources: z
          .array(z.string())
          .min(1)
          .describe('Inbound source connector identifiers'),
        webhookUrl: z.string().url().describe('HTTPS URL to receive events'),
      }),
      mcp: {
        annotations: {
          title: 'Subscribe To Inbound Events',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      outputSchema: z.object({
        id: z.string(),
        sources: z.array(z.string()),
        webhookUrl: z.string(),
        secret: z.string(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;
        const sources = (inputData as any).sources as string[];
        const webhookUrl = (inputData as any).webhookUrl as string;

        const created = await this._inboundService.subscribe(
          organizationId,
          sources,
          webhookUrl
        );
        return {
          id: created.id,
          sources: created.sources,
          webhookUrl: created.webhookUrl,
          secret: created.secret,
        };
      },
    });
  }
}
