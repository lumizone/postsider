import { AgentToolInterface } from '@postsider/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@postsider/nestjs-libraries/chat/auth.context';

@Injectable()
export class ChannelsManageTool implements AgentToolInterface {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
  ) {}
  name = 'channelsManageTool';

  run() {
    return createTool({
      id: 'channelsManageTool',
      description: `Manage connected channels: enable, disable, or delete a channel. Disabling pauses posting without losing the connection. Deleting removes the channel and all associated posts permanently.`,
      mcp: {
        annotations: {
          title: 'Manage Channels',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        action: z.enum(['enable', 'disable', 'delete']).describe('Action to perform on the channel'),
        integrationId: z.string().describe('Channel ID from integrationList'),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        try {
          switch (inputData.action) {
            case 'enable':
              await this._integrationService.enableChannel(org.id, 999, inputData.integrationId);
              return { success: true, message: 'Channel enabled.' };
            case 'disable':
              await this._integrationService.disableChannel(org.id, inputData.integrationId);
              return { success: true, message: 'Channel disabled. Posts will be paused.' };
            case 'delete': {
              const posts = await this._integrationService.getPostsForChannel(org.id, inputData.integrationId);
              for (const post of posts) {
                this._postsService.deletePost(org.id, post.group).catch(() => {});
              }
              await this._integrationService.deleteChannel(org.id, inputData.integrationId);
              return { success: true, message: 'Channel and associated posts deleted.' };
            }
          }
        } catch (err: any) {
          return { success: false, message: err?.message || 'Operation failed.' };
        }
      },
    });
  }
}
