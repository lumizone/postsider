import { AgentToolInterface } from '@postsider/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@postsider/nestjs-libraries/database/prisma/media/media.service';
import { checkAuth } from '@postsider/nestjs-libraries/chat/auth.context';

@Injectable()
export class MediaListTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'mediaListTool';

  run() {
    return createTool({
      id: 'mediaListTool',
      description: `Browse the media library. Returns uploaded images and videos that can be attached to posts. Use the 'path' field as the attachment URL when scheduling posts.`,
      mcp: {
        annotations: {
          title: 'List Media Library',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      inputSchema: z.object({
        page: z.number().default(0).describe('Page number'),
        search: z.string().optional().describe('Search by filename'),
      }),
      outputSchema: z.object({
        media: z.array(z.object({
          id: z.string(),
          name: z.string(),
          path: z.string(),
          type: z.string(),
          createdAt: z.string(),
        })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const result = await this._mediaService.getMedia(organizationId, inputData.page, inputData.search);
        const items = Array.isArray(result) ? result : (result as any)?.results || [];
        return {
          media: items.map((m: any) => ({
            id: m.id,
            name: m.name || m.originalName || 'untitled',
            path: m.path,
            type: m.type || 'image',
            createdAt: m.createdAt?.toISOString?.() || '',
          })),
        };
      },
    });
  }
}
