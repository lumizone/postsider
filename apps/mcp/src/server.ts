/**
 * PostSider MCP server factory.
 *
 * Owns every tool registration so all transports (today: stdio; later: a remote
 * Streamable HTTP server) share exactly one agent-facing surface. The factory
 * takes an injected client and reads no environment variable, which keeps it
 * importable from tests and from any entrypoint without side effects.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PostsiderClient } from './client.js';
import { buildCreatePostBody } from './post-body.js';

export const POSTSIDER_MCP_SERVER_NAME = 'postsider';
export const POSTSIDER_MCP_SERVER_VERSION = '1.0.0';

/** Wrap a tool handler so any error becomes an actionable MCP error result. */
function ok(data: unknown) {
  return {
    content: [
      // Compact, not pretty-printed: every tool result is injected into the
      // agent's context, and an indented body is roughly twice the tokens for
      // no gain the agent can use.
      { type: 'text' as const, text: JSON.stringify(data) },
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

const mediaItem = z
  .object({
    id: z.string().optional(),
    path: z.string().min(1).describe('Media path/URL returned by an upload tool.'),
  })
  .passthrough();

/**
 * ISO 8601 calendar date or date-time. Mirrors the API's `@IsDateString()`,
 * which accepts both `2026-06-01` and `2026-06-01T00:00:00Z`; validating any
 * harder here would reject payloads the API itself serves.
 */
const isoDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    'Must be an ISO 8601 date (2026-06-01) or date-time (2026-06-01T00:00:00Z).'
  )
  .refine(isRealCalendarValue, {
    message:
      'Must be a date that exists, e.g. 2026-06-01 (month 1-12, a real day for that month, time 00:00:00-23:59:59).',
  });

/**
 * The regex above checks the shape; this checks that the value is a real moment.
 * `2026-13-45` and `2026-02-30` both pass a shape test and would otherwise fail
 * server-side with an opaque 400 instead of a local, fixable message.
 */
function isRealCalendarValue(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(
    value
  );
  if (!match) {
    return false;
  }
  const [, year, month, day, hour, minute, second] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12) {
    return false;
  }
  // Day 0 of the following month is the last day of this one.
  const lastDay = new Date(Date.UTC(Number(year), monthNumber, 0)).getUTCDate();
  if (dayNumber < 1 || dayNumber > lastDay) {
    return false;
  }
  if (hour !== undefined && Number(hour) > 23) {
    return false;
  }
  if (minute !== undefined && Number(minute) > 59) {
    return false;
  }
  if (second !== undefined && Number(second) > 59) {
    return false;
  }
  return true;
}

/**
 * Public HTTPS URL. The API additionally rejects internal addresses and
 * non-media paths (its SSRF guard); those checks stay server-side.
 */
const httpsUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', {
    message: 'Must be a public HTTPS URL.',
  });

/** Non-empty identifier, so a blank id fails locally instead of at the API. */
const nonEmptyId = z.string().min(1, 'Must be a non-empty id.');

/** Build the PostSider MCP server bound to `client`. */
export function createPostSiderMcpServer(client: PostsiderClient): McpServer {
  const server = new McpServer({
    name: POSTSIDER_MCP_SERVER_NAME,
    version: POSTSIDER_MCP_SERVER_VERSION,
  });

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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
    'postsider_get_agency_overview',
    {
      title: 'Get agency overview',
      description:
        'Get an organization-wide operational overview for an agency: clients, channels, queued posts, drafts, published posts, errors, recent errors and pending approvals. Useful for morning checks and client reporting.',
      inputSchema: {
        days: z.number().int().positive().max(365).default(30).describe('Window for recent errors, in days.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ days }) => {
      try {
        return ok(await client.get('/overview', { days }));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_get_customer_report',
    {
      title: 'Get customer report',
      description: 'Get a customer-scoped agency report with channels, queued, draft, published, error and pending approval counts.',
      inputSchema: {
        customerId: nonEmptyId.describe('Customer id from postsider_list_groups.'),
        days: z.number().int().positive().max(365).default(30).describe('Window for recent errors, in days.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ customerId, days }) => {
      try {
        return ok(await client.get(`/customers/${encodeURIComponent(customerId)}/report`, { days }));
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
        'List configured channel groups. In PostSider a group is a customer, so an id returned here is the customerId expected by postsider_get_customer_report and by the customer filter of postsider_list_posts.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
        channelId: nonEmptyId.describe(
          'Channel (integration) id, from postsider_list_channels.'
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
        startDate: isoDate.describe('Range start, ISO 8601 (e.g. 2026-06-01T00:00:00Z).'),
        endDate: isoDate.describe('Range end, ISO 8601 (e.g. 2026-06-30T23:59:59Z).'),
        customer: nonEmptyId
          .optional()
          .describe('Optional customer id to filter by.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
        postId: nonEmptyId.describe('Post id.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
    'postsider_get_post',
    {
      title: 'Get post details',
      description:
        'Get the full organization-scoped post group, including current state, scheduled time, media, channel and publish error. Use this to inspect the result of an asynchronous create or publish operation.',
      inputSchema: {
        postId: nonEmptyId.describe('Post id returned by postsider_create_post.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ postId }) => {
      try {
        return ok(await client.get(`/posts/${encodeURIComponent(postId)}`));
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
        postId: nonEmptyId.describe('Post id.'),
        days: z
          .number()
          .int()
          .positive()
          .default(7)
          .describe('Look-back window in days (default 7).'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
        channelId: nonEmptyId.describe(
          'Channel (integration) id, from postsider_list_channels.'
        ),
        date: z
          .string()
          .optional()
          .describe('Provider-specific date/range parameter, if required.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
  // Emergency Pause (kill switch)
  // ───────────────────────────────────────────────────────────────────────────

  server.registerTool(
    'postsider_pause_publishing',
    {
      title: 'Pause all publishing',
      description:
        'Immediately halt ALL publishing for this organization (kill switch): no `now` or `schedule` posts can be created, and queued posts are parked to HELD instead of going out. Use when something is wrong, for example a PR crisis, a post on the wrong channel, or a runaway automation loop. Resume is human-only (owner, dashboard); this cannot be undone via the API.',
      inputSchema: {
        reason: z
          .string()
          .optional()
          .describe('Optional reason, recorded in the audit trail and shown to the team.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ reason }) => {
      try {
        return ok(await client.post('/publishing/pause', { reason }));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_get_publishing_state',
    {
      title: 'Get publishing state',
      description:
        'Check whether publishing is active or paused for this organization. Useful before scheduling (a paused org rejects new posts with publishing_paused), and to confirm a kill switch is on.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        return ok(await client.get('/publishing/state'));
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
        url: httpsUrl.describe('Public HTTPS URL of the image or video to import.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
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
        date: isoDate.describe(
          'Required publish date, ISO 8601 UTC (e.g. 2026-07-01T10:00:00Z). For "now" use the current time; drafts still require a date in the current API contract.'
        ),
        shortLink: z
          .boolean()
          .default(false)
          .describe('Whether to shorten links in the content.'),
        posts: z
          .array(
            z.object({
              channelId: nonEmptyId.describe('Channel (integration) id to publish to.'),
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
        idempotencyKey: z
          .string()
          .min(1)
          .max(255)
          .optional()
          .describe('Stable key for safe retries. Reusing it with the same request returns the original result without creating duplicates.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ type, date, shortLink, posts, tags, idempotencyKey }) => {
      try {
        const body = buildCreatePostBody({ type, date, shortLink, posts, tags });
        return ok(await client.post('/posts', body, idempotencyKey));
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
        postId: nonEmptyId.describe('Post id.'),
        status: z
          .enum(['draft', 'schedule'])
          .describe('New status value: draft or schedule.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
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
      description:
        'Permanently delete a post and every other channel version of it. The id may be any post in a group: PostSider stores a multi-channel post as one group, and a single id deletes the whole group. Read the post first (postsider_get_post) and confirm the full set of channel versions with the user before calling this.',
      inputSchema: {
        postId: nonEmptyId.describe('Post id to delete.'),
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
        'Push a draft post into the human approval queue for review, instead of publishing or scheduling it directly. The post must already exist as a draft (see postsider_create_post with type "draft"). Approval is optional in PostSider, and most posts can also be scheduled directly without ever going through this.',
      inputSchema: {
        postId: nonEmptyId.describe('Draft post id to submit for approval.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
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
        postId: nonEmptyId.describe('Post id to check.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
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

  return server;
}
