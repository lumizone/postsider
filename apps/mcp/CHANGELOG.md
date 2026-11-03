# Changelog

Notable changes to `@postsider/mcp`. This file begins with the first released
version: earlier internal iterations were never published, so they are not
recorded here.

## 1.1.0 - 2026-10-13

### Fixed

- API errors no longer collapse to "Bad Request". Per-channel validation
  errors (`{provider, name, message}`) and Nest validation errors (`message` as
  a string or list) are now reported with their text, prefixed by the channel
  name.

### Changed

- `postsider_create_post`: `date` is optional for drafts (defaults to now);
  still required to schedule.
- `postsider_list_posts` filters by `state` and `channelId` and is paged
  (`page`, `limit`, default 50) so failed or draft posts are one call away.
- Tool results over 100,000 characters are cut with an instruction to narrow
  the request instead of flooding the agent's context.

### Added

- Run the workspace from the agent: `postsider_connect_channel`,
  `postsider_set_channel_enabled`, `postsider_disconnect_channel`,
  `postsider_get_queue_plan`, `postsider_set_queue_plan`,
  `postsider_get_smart_slots`, `postsider_set_channel_customer`,
  `postsider_get_content_library`, `postsider_save_library_item`,
  `postsider_delete_library_item`, `postsider_duplicate_post`,
  `postsider_check_post`, `postsider_rewrite_post`, `postsider_delete_media`.
  Backed by new `/public/v1` routes (`/integrations/:id/{enable,disable,
  queue-plan,smart-slots,customer}`, `/library`, `/posts/:id/duplicate`,
  `/posts/check`, `/posts/rewrite`, `DELETE /media/:id`).
- New OAuth scope `channels:write` for channel configuration. Existing remote
  connections keep working for everything else and must be reconnected to use
  the channel tools. `DELETE /integrations/:id` through the remote server now
  needs it too.
- `GET /public/v1/integrations` also returns `refreshNeeded` and
  `inBetweenSteps`, so a channel that needs a reconnect is visible.
- `GET /public/v1/social/:platform?refresh=` now accepts the PostSider channel
  id (it is translated to the platform id, like the dashboard does).
- `postsider_get_channel_rules`: platform rules, length limit and required
  `settings` for a channel (`GET /public/v1/integration-settings/:id`).
- `postsider_update_post`: edit an existing post (text, media, date, settings,
  first comment) instead of deleting and recreating it. Backed by the new
  `PUT /public/v1/posts/:id`.
- `postsider_upload_media_base64`: upload an image or MP4 from bytes, no public
  URL needed. Backed by the new `POST /public/v1/upload-base64` (25 MB cap).
- `postsider_upload_media_from_file` (local stdio server only): upload from a
  file path on the user's machine via the existing multipart `/upload`.
- `postsider_list_media`: browse the media library to reuse uploaded files.
  Backed by the new `GET /public/v1/media`.
- `createPostSiderMcpServer(client, { allowLocalFiles })`. The shared remote
  server leaves local-file access off.

## 1.0.0 - 2026-09-24

Initial release.

### Server

- Local `stdio` MCP server built on `@modelcontextprotocol/sdk`.
- Configured through `POSTSIDER_API_KEY` (required) and `POSTSIDER_API_URL`
  (optional, defaults to `https://api.postsider.com`).
- A single server factory, `createPostSiderMcpServer(client)`, owns all tool
  registrations so future transports cannot drift from the stdio surface.

### Tools

19 tools, all prefixed `postsider_`: 13 read-only tools covering channels,
groups, calendar posts, approvals, notifications, publishing state, agency and
customer reporting, and analytics, plus 6 tools that change state (create or
schedule a post, import media from a URL, update post status, request approval,
delete a post, and the organization-wide pause publishing kill switch).

### Safety and input handling

- `POSTSIDER_API_URL` must be HTTPS. Plain HTTP is accepted only on loopback
  (`localhost`, `127.0.0.1`, `[::1]`) for local development and self-hosting.
- Credentials embedded in the API URL are rejected, and no error message echoes
  the URL or the API key.
- Redirects are refused instead of followed, so an authenticated request can never
  be pushed to another origin by a redirect. The failure names
  `POSTSIDER_API_URL`, which is what a self-hosted user has to fix.
- Requests time out after 30 seconds, and a failing response body is read up to
  8 KB before being reported, so a broken server cannot stream unbounded data.
- Tool arguments are validated before any network call: ids must be non-empty,
  dates must be real ISO 8601 dates (`2026-02-30` and `2026-13-45` are refused
  locally instead of becoming an opaque API 400), post status is limited to
  `draft` or `schedule`, and media imports require a public HTTPS URL.
- Tool results are compact JSON, because every result is injected into the
  agent's context.
- Every tool declares `readOnlyHint`, `destructiveHint`, `idempotentHint` and
  `openWorldHint` explicitly instead of relying on protocol defaults.
- `postsider_delete_post` documents that one post id deletes the post and every
  other channel version in its group, matching what the API does.
- A missing API key exits 1 with an explanatory message on stderr and nothing on
  stdout, which is reserved for the protocol.

### Distribution

- A Claude Code plugin in the package (`plugin.json`, `.mcp.json`, and five
  focused PostSider workflow skills), installable from the repository marketplace:
  `claude plugin marketplace add lumizone/postsider` and
  `claude plugin install postsider@postsider`.
- `server.json` metadata for the MCP Registry, validated against the registry
  schema by `pnpm --filter @postsider/mcp validate:registry`.
- `version:gate` reconciles every place a version is stated (package.json,
  plugin, registry metadata, the reported server version, the pinned npx version
  and the release tag) and blocks a tagged release that still ships the
  `RELEASE_NOT_VERIFIED` banner.
