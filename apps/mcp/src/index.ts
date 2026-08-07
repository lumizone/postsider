#!/usr/bin/env node
/**
 * PostSider MCP server.
 *
 * Exposes the PostSider platform to AI agents (Claude Code, Claude Desktop,
 * Codex, and any MCP-compatible runtime) as a set of tools over the public API.
 * Lean by design: it wraps the existing `/public/v1` REST surface with the
 * official MCP SDK and a small HTTP client, with no coupling to the backend.
 *
 * Configuration (environment variables):
 *   POSTSIDER_API_KEY  (required) - org API key from Settings -> API
 *   POSTSIDER_API_URL  (optional) - instance base URL
 *                                   default: https://api.postsider.com
 *
 * Transport: stdio (the standard for local MCP clients).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PostsiderClient } from './client.js';
import { buildCreatePostBody } from './post-body.js';

const apiKey = process.env.POSTSIDER_API_KEY;
const baseUrl = process.env.POSTSIDER_API_URL || 'https://api.postsider.com';

if (!apiKey) {
  // Fail fast with an actionable message on stderr (stdout is the MCP channel).
  process.stderr.write(
    'POSTSIDER_API_KEY is not set. Add it to your MCP client config. ' +
      'Generate a key in PostSider under Settings -> API.\n'
  );
  process.exit(1);
}

const client = new PostsiderClient(apiKey, baseUrl);

const server = new McpServer({
  name: 'postsider',
  version: '1.0.0',
});

/** Wrap a tool handler so any error becomes an actionable MCP error result. */
function ok(data: unknown) {
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}
function fail(err: unknown) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: err instanceof Error ? err.message : String(err),
      },
    ],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Channels & scheduling helpers (read-only)
// ───────────────────────────────────────────────────────────────────────────

server.registerTool(
  'postsider_list_channels',
  {
    title: 'List channels',
    description:
      'List the social channels (integrations) connected to this PostSider organization. Returns each channel id, name and platform. Call this first to get the channel ids needed by postsider_create_post.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      return ok(await client.get('/integrations'));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_list_groups',
  {
    title: 'List channel groups',
    description:
      'List configured channel groups (sets of channels that are published to together).',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      return ok(await client.get('/groups'));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_find_slot',
  {
    title: 'Find next free time slot',
    description:
      'Return the next free scheduling date-time (UTC) for a channel, based on its configured posting queue. Use the returned value as the `date` for postsider_create_post when scheduling into the queue.',
    inputSchema: {
      channelId: z
        .string()
        .describe('Channel (integration) id, from postsider_list_channels.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ channelId }) => {
    try {
      return ok(await client.get(`/find-slot/${encodeURIComponent(channelId)}`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_list_posts',
  {
    title: 'List posts',
    description:
      'List posts scheduled or published within a date range (UTC). Useful for reviewing the content calendar before scheduling more.',
    inputSchema: {
      startDate: z
        .string()
        .describe('Range start, ISO 8601 (e.g. 2026-06-01T00:00:00Z).'),
      endDate: z
        .string()
        .describe('Range end, ISO 8601 (e.g. 2026-06-30T23:59:59Z).'),
      customer: z
        .string()
        .optional()
        .describe('Optional customer id to filter by.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ startDate, endDate, customer }) => {
    try {
      return ok(await client.get('/posts', { startDate, endDate, customer }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_get_post_missing_fields',
  {
    title: 'Check post for missing fields',
    description:
      'Return per-channel validation problems / missing required fields for a post, so they can be fixed before publishing.',
    inputSchema: {
      postId: z.string().describe('Post id.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ postId }) => {
    try {
      return ok(await client.get(`/posts/${encodeURIComponent(postId)}/missing`));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_get_post_analytics',
  {
    title: 'Get post analytics',
    description:
      'Get performance analytics for a single post over the last N days (where the provider supports it).',
    inputSchema: {
      postId: z.string().describe('Post id.'),
      days: z
        .number()
        .int()
        .positive()
        .default(7)
        .describe('Look-back window in days (default 7).'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ postId, days }) => {
    try {
      return ok(
        await client.get(`/analytics/post/${encodeURIComponent(postId)}`, {
          date: days,
        })
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_get_channel_analytics',
  {
    title: 'Get channel analytics',
    description:
      'Get account-level analytics for a connected channel (where the provider supports it).',
    inputSchema: {
      channelId: z
        .string()
        .describe('Channel (integration) id, from postsider_list_channels.'),
      date: z
        .string()
        .optional()
        .describe('Provider-specific date/range parameter, if required.'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ channelId, date }) => {
    try {
      return ok(
        await client.get(`/analytics/${encodeURIComponent(channelId)}`, { date })
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_get_notifications',
  {
    title: 'Get notifications',
    description:
      'List recent notifications for the organization (e.g. publish failures, channels needing reconnection).',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async () => {
    try {
      return ok(await client.get('/notifications'));
    } catch (e) {
      return fail(e);
    }
  }
);

// ───────────────────────────────────────────────────────────────────────────
// Media
// ───────────────────────────────────────────────────────────────────────────

server.registerTool(
  'postsider_upload_media_from_url',
  {
    title: 'Upload media from URL',
    description:
      'Download an image or video from a public URL and store it in the PostSider media library. Returns a media object; pass it (or its array) as `images` to postsider_create_post.',
    inputSchema: {
      url: z
        .string()
        .url()
        .describe('Public URL of the image or video to import.'),
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ url }) => {
    try {
      return ok(await client.post('/upload-from-url', { url }));
    } catch (e) {
      return fail(e);
    }
  }
);

// ───────────────────────────────────────────────────────────────────────────
// Posting (write)
// ───────────────────────────────────────────────────────────────────────────

const mediaItem = z
  .object({
    id: z.string().optional(),
    path: z.string().describe('Media path/URL returned by an upload tool.'),
  })
  .passthrough();

server.registerTool(
  'postsider_create_post',
  {
    title: 'Create / schedule / publish a post',
    description:
      'Create a post across one or more channels. `type`: "schedule" books it for `date`; "now" publishes immediately; "draft" saves without publishing. Get channel ids from postsider_list_channels and a free slot from postsider_find_slot. Attach media via postsider_upload_media_from_url first, then pass the returned media objects as `images`.',
    inputSchema: {
      type: z
        .enum(['draft', 'schedule', 'now'])
        .default('schedule')
        .describe('draft = save only; schedule = book for `date`; now = publish immediately.'),
      date: z
        .string()
        .describe(
          'When to publish, ISO 8601 UTC (e.g. 2026-07-01T10:00:00Z). For "now" use the current time.'
        ),
      shortLink: z
        .boolean()
        .default(false)
        .describe('Whether to shorten links in the content.'),
      posts: z
        .array(
          z.object({
            channelId: z
              .string()
              .describe('Channel (integration) id to publish to.'),
            content: z.string().describe('The post text/caption.'),
            firstComment: z
              .string()
              .optional()
              .describe('Optional first comment posted right after (where supported).'),
            images: z
              .array(mediaItem)
              .optional()
              .describe('Optional media objects from postsider_upload_media_from_url.'),
            settings: z
              .record(z.any())
              .optional()
              .describe('Optional provider-specific settings (advanced; usually omit).'),
          })
        )
        .min(1)
        .describe('One entry per channel to publish to.'),
      tags: z
        .array(z.object({ value: z.string(), label: z.string() }))
        .optional()
        .describe('Optional tags.'),
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  async ({ type, date, shortLink, posts, tags }) => {
    try {
      const body = buildCreatePostBody({ type, date, shortLink, posts, tags });
      return ok(await client.post('/posts', body));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_update_post_status',
  {
    title: 'Update post status',
    description:
      'Change the status of an existing post (e.g. move between draft and queue).',
    inputSchema: {
      postId: z.string().describe('Post id.'),
      status: z.string().describe('New status value.'),
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ postId, status }) => {
    try {
      return ok(
        await client.put(`/posts/${encodeURIComponent(postId)}/status`, { status })
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_delete_post',
  {
    title: 'Delete a post',
    description: 'Permanently delete a scheduled or draft post by id.',
    inputSchema: {
      postId: z.string().describe('Post id to delete.'),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ postId }) => {
    try {
      await client.del(`/posts/${encodeURIComponent(postId)}`);
      return ok({ deleted: true, postId });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_request_approval',
  {
    title: 'Send a draft for approval',
    description:
      'Push a draft post into the human approval queue for review, instead of publishing or scheduling it directly. The post must already exist as a draft (see postsider_create_post with type "draft"). Approval is optional in PostSider — most posts can also be scheduled directly without ever going through this.',
    inputSchema: {
      postId: z.string().describe('Draft post id to submit for approval.'),
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ postId }) => {
    try {
      return ok(
        await client.post(`/posts/${encodeURIComponent(postId)}/request-approval`)
      );
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  'postsider_get_approval_status',
  {
    title: 'Get a post\'s approval status',
    description:
      'Check whether a post submitted via postsider_request_approval has been approved, rejected (with the reviewer\'s note, if any), or is still pending. Returns status "NONE" if the post was never sent for approval.',
    inputSchema: {
      postId: z.string().describe('Post id to check.'),
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  async ({ postId }) => {
    try {
      return ok(await client.get(`/posts/${encodeURIComponent(postId)}/approval`));
    } catch (e) {
      return fail(e);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `PostSider MCP server running (stdio) against ${baseUrl}\n`
  );
}

main().catch((err) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
