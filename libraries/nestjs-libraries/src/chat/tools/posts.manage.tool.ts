import { AgentToolInterface } from '@postsider/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@postsider/nestjs-libraries/chat/auth.context';

@Injectable()
export class PostsManageTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postsManageTool';

  run() {
    return createTool({
      id: 'postsManageTool',
      description: `Manage existing posts: delete, duplicate (same or different channel), change date. Use group ID from postsListTool.`,
      mcp: {
        annotations: {
          title: 'Manage Posts',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        action: z.enum(['delete', 'duplicate', 'changeDate']).describe('Action to perform'),
        group: z.string().describe('Post group ID'),
        targetIntegrationId: z.string().optional().describe('For duplicate: target channel ID (omit to duplicate to same channel)'),
        date: z.string().optional().describe('For changeDate: new date in ISO format. For duplicate: optional date for the copy.'),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        message: z.string(),
        newPostId: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        switch (inputData.action) {
          case 'delete': {
            await this._postsService.deletePost(organizationId, inputData.group);
            return { success: true, message: `Post ${inputData.group} deleted.` };
          }
          case 'duplicate': {
            const result = await this._postsService.duplicatePost(
              organizationId,
              inputData.group,
              inputData.targetIntegrationId,
              inputData.date,
            );
            return {
              success: true,
              message: `Post duplicated to ${result.target.integration}.`,
              newPostId: result.target.group,
            };
          }
          case 'changeDate': {
            if (!inputData.date) {
              return { success: false, message: 'Date is required for changeDate action.' };
            }
            await this._postsService.changeDate(
              organizationId,
              inputData.group,
              inputData.date,
              'schedule',
            );
            return { success: true, message: `Post rescheduled to ${inputData.date}.` };
          }
          default:
            return { success: false, message: 'Unknown action.' };
        }
      },
    });
  }
}
