import { AgentToolInterface } from '@postsider/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import z from 'zod';
import { checkAuth } from '@postsider/nestjs-libraries/chat/auth.context';
import { InboundSourceRegistry } from '@postsider/nestjs-libraries/integrations/inbound/inbound.registry';

@Injectable()
export class InboundFetchTool implements AgentToolInterface {
  constructor(private _inboundRegistry: InboundSourceRegistry) {}
  name = 'inboundFetch';

  run() {
    return createTool({
      id: 'inboundFetch',
      description: `Fetches a paginated page of inbound items (e-mails, Reddit threads, Discord messages, Skool posts) from a SOURCE-capable connector. Pass the nextCursor from the previous call to page forward.`,
      inputSchema: z.object({
        source: z.string().describe('Inbound source connector identifier, e.g. "reddit"'),
        cursor: z.string().optional().describe('Opaque cursor from a previous call'),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      mcp: {
        annotations: {
          title: 'Fetch Inbound Content',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      outputSchema: z.object({
        items: z.array(
          z.object({
            id: z.string(),
            source: z.string(),
            type: z.string(),
            title: z.string().optional(),
            body: z.string().optional(),
            author: z.string().optional(),
            url: z.string().optional(),
            createdAt: z.string().optional(),
          })
        ),
        nextCursor: z.string().nullable(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;
        const source = (inputData as any).source as string;
        const cursor = (inputData as any).cursor as string | undefined;
        const limit = (inputData as any).limit as number | undefined;

        if (!this._inboundRegistry.has(source)) {
          throw new Error(`"${source}" is not an inbound source`);
        }
        const page = await this._inboundRegistry.fetch(
          organizationId,
          source,
          cursor,
          limit
        );
        return {
          items: page.items.map((i) => ({
            id: i.id,
            source: i.source,
            type: i.type,
            title: i.title,
            body: i.body,
            author: i.author,
            url: i.url,
            createdAt: i.createdAt,
          })),
          nextCursor: page.nextCursor,
        };
      },
    });
  }
}
