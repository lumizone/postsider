/**
 * The expected public tool contract of the PostSider MCP server.
 *
 * This list is written independently of the registration code on purpose: it is
 * the assertion target, so a tool that is silently added, renamed or dropped
 * fails the suite instead of quietly changing the agent-facing surface.
 *
 * Keep in sync with `apps/mcp/README.md` and the published tool inventory.
 */
export const EXPECTED_TOOL_NAMES = [
  'postsider_create_post',
  'postsider_delete_post',
  'postsider_find_slot',
  'postsider_get_agency_overview',
  'postsider_get_approval_status',
  'postsider_get_channel_analytics',
  'postsider_get_customer_report',
  'postsider_get_notifications',
  'postsider_get_post',
  'postsider_get_post_analytics',
  'postsider_get_post_missing_fields',
  'postsider_get_publishing_state',
  'postsider_list_channels',
  'postsider_list_groups',
  'postsider_list_posts',
  'postsider_pause_publishing',
  'postsider_request_approval',
  'postsider_update_post_status',
  'postsider_upload_media_from_url',
] as const;

export const EXPECTED_TOOL_COUNT = 19;

/**
 * The expected risk annotations of every tool.
 *
 * All four MCP hints are stated explicitly (including `false`) so that no tool
 * depends on a default the agent cannot see. `openWorldHint` is true everywhere
 * because every tool talks to the PostSider API over the network.
 *
 * `readOnlyHint: false` + `destructiveHint: true` is reserved for operations
 * that cannot be undone through the API: deleting a post, and pausing all
 * publishing (whose resume is human-only).
 */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const read: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export const EXPECTED_TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  postsider_list_channels: read,
  postsider_get_agency_overview: read,
  postsider_get_customer_report: read,
  postsider_list_groups: read,
  postsider_find_slot: read,
  postsider_list_posts: read,
  postsider_get_post_missing_fields: read,
  postsider_get_post: read,
  postsider_get_post_analytics: read,
  postsider_get_channel_analytics: read,
  postsider_get_notifications: read,
  postsider_get_publishing_state: read,
  postsider_get_approval_status: read,
  postsider_pause_publishing: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  postsider_upload_media_from_url: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  postsider_create_post: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  postsider_update_post_status: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  postsider_delete_post: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  postsider_request_approval: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};
