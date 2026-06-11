import { AgentToolInterface } from '@postsider/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@postsider/nestjs-libraries/chat/auth.context';

@Injectable()
export class TagsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'tagsTool';

  run() {
    return createTool({
      id: 'tagsTool',
      description: `List and create tags that can be attached to posts for organization and filtering.`,
      mcp: {
        annotations: {
          title: 'Manage Tags',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        action: z.enum(['list', 'create']).describe('list = get all tags, create = make a new tag'),
        name: z.string().optional().describe('Required for create: tag name'),
        color: z.string().optional().describe('Required for create: hex color like #3b82f6'),
      }),
      outputSchema: z.object({
        tags: z.array(z.object({
          id: z.string(),
          name: z.string(),
          color: z.string(),
        })).optional(),
        created: z.object({
          id: z.string(),
          name: z.string(),
          color: z.string(),
        }).optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        if (inputData.action === 'list') {
          const tags = await this._postsService.getTags(organizationId);
          return {
            tags: tags.map((t: any) => ({ id: t.id, name: t.name, color: t.color })),
          };
        }

        if (inputData.action === 'create') {
          if (!inputData.name || !inputData.color) {
            throw new Error('name and color are required for creating a tag');
          }
          const tag = await this._postsService.createTag(organizationId, {
            name: inputData.name,
            color: inputData.color,
          } as any);
          return { created: { id: (tag as any).id, name: inputData.name, color: inputData.color } };
        }

        return {};
      },
    });
  }
}
