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
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { PostsiderClient } from './client.js';
import { buildCreatePostBody } from './post-body.js';
import { registerPostSiderSkills } from './skills-catalog.js';

export const POSTSIDER_MCP_SERVER_NAME = 'postsider';
export const POSTSIDER_MCP_SERVER_VERSION = '1.0.0';

/**
 * Ceiling on one tool result. Every result is injected into the agent's
 * context, so an oversized list is cut with an instruction to narrow it
 * instead of silently flooding the conversation.
 */
export const MAX_TOOL_RESULT_CHARS = 100_000;

/** Wrap a tool handler so any error becomes an actionable MCP error result. */
function ok(data: unknown) {
  // Compact, not pretty-printed: every tool result is injected into the
  // agent's context, and an indented body is roughly twice the tokens for
  // no gain the agent can use.
  const full = JSON.stringify(data) ?? 'null';
  const text =
    full.length > MAX_TOOL_RESULT_CHARS
      ? `${full.slice(0, MAX_TOOL_RESULT_CHARS)}\n[Result truncated: showing ${MAX_TOOL_RESULT_CHARS} of ${full.length} characters. Narrow the request (shorter date range, a status or channel filter, a smaller page) and call again.]`
      : full;
  return { content: [{ type: 'text' as const, text }] };
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

export interface PostSiderServerOptions {
  /**
   * Register `postsider_upload_media_from_file`, which reads a file from the
   * machine the server runs on. Only meaningful (and only safe) for the local
   * stdio server, where that machine is the user's own. The shared remote
   * server must leave it off: its filesystem is not the caller's.
   */
  allowLocalFiles?: boolean;
  /**
   * Largest file `postsider_upload_media_base64` accepts, in decoded bytes.
   * The local stdio server has no transport limit (25 MB, the API's own cap).
   * The remote Streamable HTTP transport refuses request bodies over 4 MiB, so
   * it passes a smaller value; otherwise a 5 MB file would fail with an opaque
   * 413 while the tool description promised 25 MB.
   */
  maxBase64Bytes?: number;
}

/** Largest file the local-file tool will read, matching the API video cap. */
const LOCAL_FILE_MAX_BYTES = 500 * 1024 * 1024;

/**
 * File types the local-file tool will read. Checked before the file is opened,
 * so an agent that is tricked (or simply wrong) can never send a document,
 * key or config file from the user's disk to the API just to have it refused.
 */
const LOCAL_MEDIA_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tif', '.tiff',
  '.mp4', '.mov', '.webm', '.mkv',
]);

/** Largest decoded payload accepted by the base64 tool (API enforces the same). */
const BASE64_MAX_BYTES = 25 * 1024 * 1024;

/** Build the PostSider MCP server bound to `client`. */
export function createPostSiderMcpServer(
  client: PostsiderClient,
  options: PostSiderServerOptions = {}
): McpServer {
  const maxBase64Bytes = Math.min(
    options.maxBase64Bytes ?? BASE64_MAX_BYTES,
    BASE64_MAX_BYTES
  );
  const maxBase64Mb = Math.floor((maxBase64Bytes / 1024 / 1024) * 10) / 10;

  const server = new McpServer(
    {
      name: POSTSIDER_MCP_SERVER_NAME,
      version: POSTSIDER_MCP_SERVER_VERSION,
    },
    {
      instructions:
        "Use PostSider for the authenticated user's social publishing workspace. Follow the user's explicit requested outcome. Resolve channel, post and customer ids from fresh read calls; never invent them. Before reporting a write as successful, read the created or changed record back. Treat delete and organization-wide pause as destructive actions.",
    }
  );

  registerPostSiderSkills(server);

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
        'List posts scheduled or published within a date range (UTC), newest page first as stored. Filter with `state` (e.g. ERROR to find failed posts, DRAFT, QUEUE for scheduled, APPROVAL, PUBLISHED) and `channelId`. Returns `{posts, total, page, hasMore}`; when `hasMore` is true, call again with the next `page`. Useful for reviewing the content calendar before scheduling more and for finding what needs fixing.',
      inputSchema: {
        startDate: isoDate.describe('Range start, ISO 8601 (e.g. 2026-06-01T00:00:00Z).'),
        endDate: isoDate.describe('Range end, ISO 8601 (e.g. 2026-06-30T23:59:59Z).'),
        customer: nonEmptyId
          .optional()
          .describe('Optional customer id to filter by.'),
        state: z
          .enum(['QUEUE', 'DRAFT', 'PUBLISHED', 'ERROR', 'APPROVAL'])
          .optional()
          .describe('Only posts in this state. ERROR = failed to publish.'),
        channelId: nonEmptyId
          .optional()
          .describe('Only posts for this channel (id from postsider_list_channels).'),
        page: z.number().int().positive().default(1).describe('Page number, starting at 1.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .default(50)
          .describe('Posts per page (default 50, max 200).'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ startDate, endDate, customer, state, channelId, page, limit }) => {
      try {
        return ok(
          await client.get('/posts', {
            startDate,
            endDate,
            customer,
            state,
            integration: channelId,
            page,
            limit,
          })
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_get_channel_rules',
    {
      title: 'Get channel rules and required settings',
      description:
        'For one channel, return its platform rules, the maximum post length, the provider-specific `settings` schema (required fields and allowed values) and any helper tools. Call this before postsider_create_post or postsider_update_post for a channel you have not posted to yet, so `settings` and the text length are right the first time.',
      inputSchema: {
        channelId: nonEmptyId.describe('Channel (integration) id, from postsider_list_channels.'),
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
        return ok(
          await client.get(`/integration-settings/${encodeURIComponent(channelId)}`)
        );
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
        'Download an image or video from a public URL and store it in the PostSider media library. Accepts images (jpeg, png, gif, webp, avif, bmp, tiff; up to 10 MB) and MP4 video (up to 500 MB). Returns a media object `{id, path, ...}`; pass it inside `images` to postsider_create_post or postsider_update_post. If you only have a file, use postsider_upload_media_base64 (small files) or postsider_upload_media_from_file (local server).',
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
    'postsider_upload_media_base64',
    {
      title: 'Upload media from base64',
      description:
        'Store an image or MP4 video you hold as bytes (no public URL needed). `data` is the base64 of the file (a data: URL is accepted too); the file type is detected from the content, not from `filename`. Limit on this connection: ' + maxBase64Mb + ' MB decoded (images also 10 MB), so use this for images and short clips; for bigger files use postsider_upload_media_from_url (a public link) or, where available, postsider_upload_media_from_file. Returns a media object `{id, path, ...}`; pass it inside `images` to postsider_create_post or postsider_update_post.',
      inputSchema: {
        data: z
          .string()
          .min(1)
          .describe('Base64-encoded file content (optionally a data: URL).'),
        filename: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe('Original file name, shown in the media library.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ data, filename }) => {
      try {
        const approxBytes = (data.length * 3) / 4;
        if (approxBytes > maxBase64Bytes) {
          throw new Error(
            `File is larger than the ${maxBase64Mb} MB limit of this connection for base64 uploads. Use postsider_upload_media_from_url (a public link) or, where available, postsider_upload_media_from_file instead.`
          );
        }
        return ok(await client.post('/upload-base64', { data, filename }));
      } catch (e) {
        return fail(e);
      }
    }
  );

  if (options.allowLocalFiles) {
    server.registerTool(
      'postsider_upload_media_from_file',
      {
        title: 'Upload media from a local file',
        description:
          'Upload an image or MP4 video from a file path on the machine running this MCP server (your own computer). Supports large videos (up to 500 MB; images up to 10 MB). Returns a media object `{id, path, ...}`; pass it inside `images` to postsider_create_post or postsider_update_post.',
        inputSchema: {
          path: z
            .string()
            .min(1)
            .describe('Absolute path of the image or MP4 file on this machine.'),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ path }) => {
        try {
          if (!LOCAL_MEDIA_EXTENSIONS.has(extname(path).toLowerCase())) {
            throw new Error(
              `Only image and video files can be uploaded (${[...LOCAL_MEDIA_EXTENSIONS].join(', ')}). "${basename(path)}" was not read.`
            );
          }
          // Judge the file that will actually be read: a symlink named photo.png
          // that points at a key or config file must not pass the extension check.
          const real = await realpath(path).catch(() => null);
          if (!real) {
            throw new Error(`No file found at "${path}".`);
          }
          if (!LOCAL_MEDIA_EXTENSIONS.has(extname(real).toLowerCase())) {
            throw new Error(
              `"${basename(path)}" resolves to a file that is not an image or video, so it was not read.`
            );
          }
          const info = await stat(real).catch(() => null);
          if (!info || !info.isFile()) {
            throw new Error(`No file found at "${path}".`);
          }
          if (info.size > LOCAL_FILE_MAX_BYTES) {
            throw new Error(
              `File is ${Math.round(info.size / 1024 / 1024)} MB; the limit is ${
                LOCAL_FILE_MAX_BYTES / 1024 / 1024
              } MB.`
            );
          }
          const bytes = await readFile(real);
          return ok(await client.upload('/upload', bytes, basename(path)));
        } catch (e) {
          return fail(e);
        }
      }
    );
  }

  server.registerTool(
    'postsider_list_media',
    {
      title: 'List media library',
      description:
        'Browse files already in the PostSider media library (newest first, 18 per page) so they can be reused without uploading again. Each item has `id` and `path`; pass `{id, path}` inside `images` to postsider_create_post or postsider_update_post. `search` filters by original file name.',
      inputSchema: {
        page: z.number().int().positive().default(1).describe('Page number, starting at 1.'),
        search: z.string().optional().describe('Filter by original file name.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ page, search }) => {
      try {
        return ok(await client.get('/media', { page, search }));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_create_post',
    {
      title: 'Create / schedule / publish a post',
      description:
        'Create a post across one or more channels. `type`: "schedule" books it for `date`; "now" publishes immediately; "draft" saves without publishing. Get channel ids from postsider_list_channels, per-channel required `settings` and length limits from postsider_get_channel_rules, and a free slot from postsider_find_slot. Attach media by uploading first (postsider_upload_media_from_url, postsider_upload_media_base64, postsider_upload_media_from_file) or by reusing postsider_list_media, then pass the media objects as `images`. To change a post later use postsider_update_post.',
      inputSchema: {
        type: z
          .enum(['draft', 'schedule', 'now'])
          .default('schedule')
          .describe('draft = save only; schedule = book for `date`; now = publish immediately.'),
        date: isoDate
          .optional()
          .describe(
            'Publish date, ISO 8601 UTC (e.g. 2026-07-01T10:00:00Z). Required for "schedule". Optional for "draft" (defaults to now, and can be changed later with postsider_update_post). Ignored for "now".'
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
                .describe('Optional media objects from an upload tool or postsider_list_media.'),
              settings: z
                .record(z.any())
                .optional()
                .describe(
                  'Provider-specific settings. Required fields: X: who_can_reply_post (everyone, following, mentionedUsers, subscribers, or verified). Instagram: post_type (post or story). YouTube: title and type (public, private, or unlisted). TikTok: privacy_level (PUBLIC_TO_EVERYONE, MUTUAL_FOLLOW_FRIENDS, FOLLOWER_OF_CREATOR, or SELF_ONLY); duet, stitch, comment, brand_content_toggle, and brand_organic_toggle (booleans); autoAddMusic (yes or no); and content_posting_method (DIRECT_POST or UPLOAD). Other providers may impose additional requirements; preserve settings returned by postsider_get_post when replacing an existing post.'
                ),
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
        if (type === 'schedule' && !date) {
          throw new Error('`date` is required to schedule a post. Use postsider_find_slot for the next free time.');
        }
        const body = buildCreatePostBody({
          type,
          date: date ?? new Date().toISOString(),
          shortLink,
          posts,
          tags,
        });
        return ok(await client.post('/posts', body, idempotencyKey));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_update_post',
    {
      title: 'Edit an existing post',
      description:
        'Edit a post in place instead of deleting and recreating it. Send only what changes: `content`, `images` (REPLACES the post\'s media list with the given media objects), `date` (ISO 8601 UTC), `settings`, `firstComment` (empty string clears it). Everything else is kept. Use the id of the first post of the thread. Published posts and posts pending approval cannot be edited. A scheduled post is re-armed for its (new) date; a draft stays a draft. Read the post with postsider_get_post first and verify the change afterwards.',
      inputSchema: {
        postId: nonEmptyId.describe('Id of the post to edit.'),
        content: z.string().optional().describe('New post text (replaces the current text).'),
        images: z
          .array(mediaItem)
          .optional()
          .describe(
            'Complete new media list from the upload tools or postsider_list_media. Use [] to remove all media. Omit to keep current media.'
          ),
        date: isoDate.optional().describe('New publish date, ISO 8601 UTC. Must not be in the past for scheduled posts.'),
        settings: z
          .record(z.any())
          .optional()
          .describe('Provider-specific settings; replaces the current settings object entirely, so start from postsider_get_post.'),
        firstComment: z
          .string()
          .optional()
          .describe('New first comment. Empty string removes it.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ postId, content, images, date, settings, firstComment }) => {
      try {
        const body: Record<string, unknown> = {
          ...(content !== undefined ? { content } : {}),
          ...(images !== undefined ? { images } : {}),
          ...(date !== undefined ? { date } : {}),
          ...(settings !== undefined ? { settings } : {}),
          // The API reads null as "clear"; an empty string means the same here.
          ...(firstComment !== undefined
            ? { firstComment: firstComment === '' ? null : firstComment }
            : {}),
        };
        if (Object.keys(body).length === 0) {
          throw new Error(
            'Nothing to update. Provide at least one of content, images, date, settings, firstComment.'
          );
        }
        return ok(await client.put(`/posts/${encodeURIComponent(postId)}`, body));
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

  // ───────────────────────────────────────────────────────────────────────────
  // Channels: connect, switch on/off, queue plan, clients
  // ───────────────────────────────────────────────────────────────────────────

  server.registerTool(
    'postsider_connect_channel',
    {
      title: 'Connect or reconnect a channel',
      description:
        'Get the one-time sign-in link that connects a social account to PostSider. The user must open the link and approve access on the platform (an agent cannot do that step). Pass `reconnectChannelId` (from postsider_list_channels, where `refreshNeeded` is true) to renew an existing channel instead of adding a duplicate. Platforms that need extra input (an instance URL or API key) are not supported here and must be added in the dashboard. After the user confirms, call postsider_list_channels to verify the channel appeared.',
      inputSchema: {
        platform: z
          .string()
          .regex(/^[a-z0-9-]+$/, 'Lowercase platform identifier, e.g. x, linkedin, instagram.')
          .describe('Platform identifier, e.g. x, linkedin, linkedin-page, instagram, facebook, tiktok, youtube, threads, pinterest, bluesky.'),
        reconnectChannelId: nonEmptyId
          .optional()
          .describe('Existing channel id to renew.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ platform, reconnectChannelId }) => {
      try {
        return ok(
          await client.get(`/social/${encodeURIComponent(platform)}`, {
            refresh: reconnectChannelId,
          })
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_set_channel_enabled',
    {
      title: 'Enable or disable a channel',
      description:
        'Switch a channel off (no posts are published to it, its slot is released) or back on. Enabling can fail when the plan\'s channel limit is reached. Needs an admin or owner role.',
      inputSchema: {
        channelId: nonEmptyId.describe('Channel id from postsider_list_channels.'),
        enabled: z.boolean().describe('true to enable, false to disable.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channelId, enabled }) => {
      try {
        return ok(
          await client.post(
            `/integrations/${encodeURIComponent(channelId)}/${enabled ? 'enable' : 'disable'}`
          )
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_disconnect_channel',
    {
      title: 'Disconnect a channel',
      description:
        'Disconnect a channel from PostSider. Its unpublished posts are kept as drafts (not deleted) and published history stays, but nothing is published to it until it is connected again. Confirm with the user first.',
      inputSchema: {
        channelId: nonEmptyId.describe('Channel id from postsider_list_channels.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channelId }) => {
      try {
        await client.del(`/integrations/${encodeURIComponent(channelId)}`);
        return ok({ disconnected: true, channelId });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_get_queue_plan',
    {
      title: 'Get a channel\'s posting times',
      description:
        'Read the recurring posting slots of a channel (the queue that postsider_find_slot draws from) and the timezone they are expressed in. Each slot time is minutes from midnight in that timezone.',
      inputSchema: {
        channelId: nonEmptyId.describe('Channel id from postsider_list_channels.'),
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
        return ok(await client.get(`/integrations/${encodeURIComponent(channelId)}/queue-plan`));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_set_queue_plan',
    {
      title: 'Set a channel\'s posting times',
      description:
        'Replace the recurring posting slots of a channel. Each slot is `{time, days?}`: `time` in minutes from midnight in `timezone` (09:00 = 540, 18:30 = 1110) and optional `days` (0 = Sunday .. 6 = Saturday; omit for every day). This REPLACES the whole plan, so call postsider_get_queue_plan first and send back the slots you are keeping, including their `days`, or the day restrictions are lost. Needs an admin or owner role.',
      inputSchema: {
        channelId: nonEmptyId.describe('Channel id from postsider_list_channels.'),
        slots: z
          .array(
            z.object({
              time: z.number().int().min(0).max(1439),
              days: z
                .array(z.number().int().min(0).max(6))
                .max(7)
                .optional()
                .describe('Weekdays 0 (Sunday) to 6 (Saturday). Omit for every day.'),
            })
          )
          .max(48)
          .describe('The complete list of slots. An empty list clears the plan.'),
        timezone: z
          .string()
          .min(1)
          .optional()
          .describe('IANA timezone, e.g. Europe/Warsaw. Omit to keep the current one.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channelId, slots, timezone }) => {
      try {
        return ok(
          await client.put(`/integrations/${encodeURIComponent(channelId)}/queue-plan`, {
            time: slots,
            ...(timezone ? { timezone } : {}),
          })
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_get_smart_slots',
    {
      title: 'Suggest the best times to post',
      description:
        'Suggest the best upcoming publish times for a channel, scored from platform peak hours and the channel\'s own posting rhythm, avoiding times that are already booked. Each item has `datetime` and `score`. Use a `datetime` as the `date` of postsider_create_post.',
      inputSchema: {
        channelId: nonEmptyId.describe('Channel id from postsider_list_channels.'),
        count: z.number().int().min(1).max(10).default(3).describe('How many suggestions (1-10).'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channelId, count }) => {
      try {
        return ok(await client.get(`/integrations/${encodeURIComponent(channelId)}/smart-slots`, { count }));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_set_channel_customer',
    {
      title: 'Assign a channel to a client',
      description:
        'Assign a channel to a client (customer) by name; the client is created if it does not exist. Pass an empty name to remove the assignment. Clients are what postsider_list_groups returns and what reports and filters use. Needs an admin or owner role.',
      inputSchema: {
        channelId: nonEmptyId.describe('Channel id from postsider_list_channels.'),
        customerName: z
          .string()
          .max(100)
          .describe('Client name, or an empty string to unassign.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ channelId, customerName }) => {
      try {
        return ok(
          await client.put(`/integrations/${encodeURIComponent(channelId)}/customer`, {
            name: customerName,
          })
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Content library, duplication, AI checks, media cleanup
  // ───────────────────────────────────────────────────────────────────────────

  server.registerTool(
    'postsider_get_content_library',
    {
      title: 'Get saved hashtag groups, captions and UTM presets',
      description:
        'List the reusable content the workspace has saved: hashtag groups (`hashtags`, optional `platform`), caption templates (`content`) and UTM presets. Use them to build posts in the team\'s own style instead of inventing hashtags or tracking parameters.',
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
        return ok(await client.get('/library'));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_save_library_item',
    {
      title: 'Create or update a library item',
      description:
        'Create (no `id`) or update (with `id`) a hashtag group, caption template or UTM preset. Updating REPLACES the item, so read it with postsider_get_content_library first. Fields by kind: hashtag-groups needs `name` and `hashtags` (optional `platform`); caption-templates needs `name` and `content`; utm-presets needs `name`, `utmSource`, `utmMedium`, `utmCampaign` (optional `utmContent`, `utmTerm`).',
      inputSchema: {
        kind: z.enum(['hashtag-groups', 'caption-templates', 'utm-presets']),
        id: nonEmptyId.optional().describe('Item id to update. Omit to create.'),
        name: z.string().min(1),
        hashtags: z.array(z.string()).optional().describe('hashtag-groups only, e.g. ["#launch", "#saas"].'),
        platform: z.string().optional().describe('hashtag-groups only.'),
        content: z.string().min(1).optional().describe('caption-templates only.'),
        utmSource: z.string().optional(),
        utmMedium: z.string().optional(),
        utmCampaign: z.string().optional(),
        utmContent: z.string().optional(),
        utmTerm: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ kind, id, ...fields }) => {
      try {
        // Send only what belongs to this kind, so a stray field is never sent
        // to a DTO that does not know it.
        const allowed: Record<string, string[]> = {
          'hashtag-groups': ['name', 'hashtags', 'platform'],
          'caption-templates': ['name', 'content'],
          'utm-presets': ['name', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'],
        };
        const body = Object.fromEntries(
          Object.entries(fields).filter(
            ([key, value]) => allowed[kind].includes(key) && value !== undefined
          )
        );
        return ok(
          id
            ? await client.put(`/library/${kind}/${encodeURIComponent(id)}`, body)
            : await client.post(`/library/${kind}`, body)
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_delete_library_item',
    {
      title: 'Delete a library item',
      description:
        'Permanently delete a hashtag group, caption template or UTM preset. Posts already created from it are not affected. Confirm with the user first.',
      inputSchema: {
        kind: z.enum(['hashtag-groups', 'caption-templates', 'utm-presets']),
        id: nonEmptyId.describe('Item id from postsider_get_content_library.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ kind, id }) => {
      try {
        await client.del(`/library/${kind}/${encodeURIComponent(id)}`);
        return ok({ deleted: true, kind, id });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_duplicate_post',
    {
      title: 'Duplicate a post',
      description:
        'Copy a post (text, media, first comment) as a NEW DRAFT, optionally onto another channel (`channelId`) and/or a date. The original is untouched. Use it to repurpose one post for several channels, then adjust each copy with postsider_update_post.',
      inputSchema: {
        postId: nonEmptyId.describe('Id of the post to copy.'),
        channelId: nonEmptyId.optional().describe('Target channel. Omit to copy onto the same channel.'),
        date: isoDate.optional().describe('Date for the copy, ISO 8601 UTC. Omit for the next free slot.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ postId, channelId, date }) => {
      try {
        return ok(
          await client.post(`/posts/${encodeURIComponent(postId)}/duplicate`, { channelId, date })
        );
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_check_post',
    {
      title: 'Check a post before publishing',
      description:
        'Run PostSider\'s AI check on draft text for up to 3 platforms: length, tone, hashtags, links and platform-specific problems, with suggestions. Counts against the plan\'s monthly AI allowance. Fails with a clear message if no AI is configured or the allowance is used up.',
      inputSchema: {
        content: z.string().min(1).max(4000),
        platforms: z
          .array(z.string().min(1))
          .min(1)
          .max(3)
          .describe('Platform identifiers, e.g. ["x", "linkedin"].'),
        hasMedia: z.boolean().default(false),
        mediaType: z.enum(['image', 'video', 'mixed']).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ content, platforms, hasMedia, mediaType }) => {
      try {
        return ok(await client.post('/posts/check', { content, platforms, hasMedia, mediaType }));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_rewrite_post',
    {
      title: 'Rewrite a post',
      description:
        'Get up to 5 alternative versions of a post text in a chosen tone, optionally tuned to one platform. Returns suggestions only; nothing is saved. Counts against the plan\'s monthly AI allowance.',
      inputSchema: {
        content: z.string().min(1).max(4000),
        tone: z.enum(['rephrase', 'shorten', 'formal', 'casual', 'punchy']).optional(),
        count: z.number().int().min(1).max(5).default(3),
        platform: z.string().max(64).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ content, tone, count, platform }) => {
      try {
        return ok(await client.post('/posts/rewrite', { content, tone, count, platform }));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'postsider_delete_media',
    {
      title: 'Delete a media file',
      description:
        'Permanently delete a file from the media library and storage. Posts that still use it will lose the image or video, so check where it is used first and confirm with the user.',
      inputSchema: {
        mediaId: nonEmptyId.describe('Media id from postsider_list_media.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ mediaId }) => {
      try {
        await client.del(`/media/${encodeURIComponent(mediaId)}`);
        return ok({ deleted: true, mediaId });
      } catch (e) {
        return fail(e);
      }
    }
  );

  return server;
}
