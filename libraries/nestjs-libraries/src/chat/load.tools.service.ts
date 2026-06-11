import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { Memory } from '@mastra/memory';
import { pStore } from '@postsider/nestjs-libraries/chat/mastra.store';
import { array, object, string } from 'zod';
import { ModuleRef } from '@nestjs/core';
import { toolList } from '@postsider/nestjs-libraries/chat/tools/tool.list';
import dayjs from 'dayjs';

export const AgentState = object({
  proverbs: array(string()).default([]),
});

const renderArray = (list: string[], show: boolean) => {
  if (!show) return '';
  return list.map((p) => `- ${p}`).join('\n');
};

@Injectable()
export class LoadToolsService {
  constructor(private _moduleRef: ModuleRef) {}

  async loadTools() {
    return (
      await Promise.all<{ name: string; tool: any }>(
        toolList
          .map((p) => this._moduleRef.get(p, { strict: false }))
          .map(async (p) => ({
            name: p.name as string,
            tool: await p.run(),
          }))
      )
    ).reduce(
      (all, current) => ({
        ...all,
        [current.name]: current.tool,
      }),
      {} as Record<string, any>
    );
  }

  async agent() {
    const tools = await this.loadTools();
    return new Agent({
      id: 'postsider',
      name: 'postsider',
      description: 'Agent that helps manage and schedule social media posts for users',
      instructions: ({ requestContext }) => {
        const ui: string = requestContext.get('ui' as never);
        return `
      Global information:
        - Date (UTC): ${dayjs().format('YYYY-MM-DD HH:mm:ss')}

      You are an agent with FULL access to the PostSider social media management platform. You can:

      Content & Scheduling:
        - Schedule, publish, or draft posts to any connected channel
        - Create threads (X, Bluesky, Threads) or posts with comments (LinkedIn, Facebook)
        - View all existing posts (scheduled, published, drafts, failed)
        - Delete posts, duplicate posts (same or different channel), reschedule posts
        - Generate AI images and videos for posts
        - Upload media from external URLs

      Channels & Analytics:
        - List all connected channels, filter by customer group
        - Enable, disable, or delete channels
        - View per-channel analytics (followers, impressions, engagement)

      Organization:
        - List and create tags for post categorization
        - Browse the media library
        - List customer groups

      Rules:
        - We call social media accounts "channels" (not "integrations")
        - Always use integrationSchema tool before scheduling to understand platform rules
        - Content must be HTML wrapped in <p> tags (allowed: h1, h2, h3, u, strong, li, ul, p)
        - For X without Premium, don't suggest long posts
        - For threads (X, Bluesky, Threads): each item in postsAndComments array = separate post in thread
        - For LinkedIn/Facebook: second+ items = comments on the first post
        - Always confirm with the user before destructive actions (delete channel, delete post)
        - Always show post details and ask confirmation before scheduling
        - Platform-specific rules from integrationSchema are mandatory — never ignore them
        - When outputting dates, use human-readable format with time
      ${renderArray(
        [
          'If the user confirms, ask if they would like to get a modal with populated content without scheduling the post yet or if they want to schedule it right away.',
        ],
        !!ui
      )}
`;
      },
      model: openai('gpt-5.5'),
      tools,
      memory: new Memory({
        storage: pStore,
        options: {
          generateTitle: true,
          workingMemory: {
            enabled: true,
            schema: AgentState,
          },
        },
      }),
    });
  }
}
