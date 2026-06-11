import { AgentToolInterface } from '@postsider/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { checkAuth } from '@postsider/nestjs-libraries/chat/auth.context';

@Injectable()
export class PostsListTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postsListTool';

  run() {
    return createTool({
      id: 'postsListTool',
      description: `List existing posts. Can filter by state (scheduled, published, draft, error) and paginate. Use to see what's already planned or published.`,
      mcp: {
        annotations: {
          title: 'List Posts',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        state: z.enum(['all', 'scheduled', 'published', 'draft']).default('all').describe('Filter by post state'),
        page: z.number().default(0).describe('Page number (0-indexed)'),
        limit: z.number().default(20).describe('Posts per page'),
      }),
      outputSchema: z.object({
        posts: z.array(z.object({
          id: z.string(),
          group: z.string(),
          content: z.string(),
          publishDate: z.string(),
          state: z.string(),
          integration: z.object({ id: z.string(), name: z.string(), platform: z.string() }).optional(),
        })),
        hasMore: z.boolean(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const result = await this._postsService.getPostsList(organizationId, {
          page: inputData.page,
          limit: inputData.limit,
          state: inputData.state === 'all' ? undefined : inputData.state,
        } as any);

        return {
          posts: ((result as any).posts || []).map((p: any) => ({
            id: p.id,
            group: p.group,
            content: (p.content || '').slice(0, 200),
            publishDate: p.publishDate,
            state: p.state,
            integration: p.integration ? {
              id: p.integration.id,
              name: p.integration.name,
              platform: p.integration.providerIdentifier,
            } : undefined,
          })),
          hasMore: !!(result as any).hasMore,
        };
      },
    });
  }
}
