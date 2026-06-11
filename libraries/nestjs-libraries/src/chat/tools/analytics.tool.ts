import { AgentToolInterface } from '@postsider/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { checkAuth } from '@postsider/nestjs-libraries/chat/auth.context';
import dayjs from 'dayjs';

@Injectable()
export class AnalyticsTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'analyticsTool';

  run() {
    return createTool({
      id: 'analyticsTool',
      description: `Get analytics/metrics for a connected channel. Returns follower count changes, impressions, engagement over the requested time period. Pass days=7 for weekly, days=30 for monthly stats.`,
      mcp: {
        annotations: {
          title: 'Channel Analytics',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        integrationId: z.string().describe('Channel ID from integrationList'),
        days: z.number().default(7).describe('Number of days to look back (7 = weekly, 30 = monthly)'),
      }),
      outputSchema: z.object({
        data: z.array(z.object({
          label: z.string(),
          data: z.array(z.object({ total: z.string(), date: z.string() })),
          percentageChange: z.number(),
        })),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        try {
          const data = await this._integrationService.checkAnalytics(
            org,
            inputData.integrationId,
            String(inputData.days),
          );
          return { data: data || [] };
        } catch (err: any) {
          return { data: [], error: err?.message || 'Analytics not available for this channel.' };
        }
      },
    });
  }
}
