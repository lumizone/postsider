# @postsider/mcp

MCP (Model Context Protocol) server that gives AI agents selected access to a
PostSider instance through its public API. Works with Claude Code, Claude
Desktop, Codex, Cursor, and any MCP-compatible client. Talks to cloud
(`api.postsider.com`) or a self-hosted instance, authenticated with an
organization API key.

PostSider is a shared operational calendar: the agent prepares and schedules
work, and a human reviews what actually goes live.

## Install

### 1. Create an API key

In PostSider, open **Settings -> API** and generate an organization API key.

### 2. Connect your client

Claude Code:

```bash
claude mcp add postsider -e POSTSIDER_API_KEY=your_api_key -- npx -y @postsider/mcp
```

Codex CLI and its IDE extension share MCP configuration. Use **one** of
these options for a server named `postsider`.

Hosted MCP with OAuth (no organization key pasted into a config file):

```bash
codex mcp add postsider --url https://mcp.postsider.com/mcp
```

Complete the PostSider sign-in and permission flow in your client.

Alternatively, run the local MCP package over stdio with an organization API
key stored in your environment or secret manager:

```bash
codex mcp add postsider --env POSTSIDER_API_KEY=your_api_key -- npx -y @postsider/mcp
```

The local organization key has broad access to your workspace. Never commit it
to a repository or include it in an agent prompt. For a guided walkthrough and
a first safe draft, see https://postsider.com/developers/.

Claude Desktop or any generic MCP client:

```json
{
  "mcpServers": {
    "postsider": {
      "command": "npx",
      "args": ["-y", "@postsider/mcp"],
      "env": {
        "POSTSIDER_API_KEY": "your_api_key"
      }
    }
  }
}
```

### 3. Verify with a read-only prompt

Ask your agent, and confirm it answers without changing anything:

```text
List my connected PostSider channels. Do not create or modify anything.
```

Then:

```text
Show my PostSider calendar for the next 14 days. Do not create or modify anything.
```

### 4. Only then prepare a draft

The MCP create-post tool defaults to **draft**, not `schedule` or `now`.
`posts:write` is a powerful permission: it does not inherently require human
approval for each publication. An agent must **not** schedule or publish
without explicit authorization for the content, channel and timing. Use
`postsider_get_post` to verify a write before reporting success.

```text
Create one draft only for the selected channel. Show me the exact content first. Do not publish it.
```

### From source

```bash
pnpm --filter @postsider/mcp build
```

Then point your client at the built entrypoint:

```json
{
  "mcpServers": {
    "postsider": {
      "command": "node",
      "args": ["/absolute/path/to/apps/mcp/dist/index.js"],
      "env": {
        "POSTSIDER_API_KEY": "your_api_key",
        "POSTSIDER_API_URL": "https://api.postsider.com"
      }
    }
  }
}
```

### Claude Code plugin

The package directory is also a Claude Code plugin: `.claude-plugin/plugin.json`
declares the API key as a secret user setting, `.mcp.json` starts this server at
the pinned released version, and `skills/` contains focused workflows for calendar
review, content publishing, approvals, analytics, and agency operations. The
repository root is a plugin marketplace, so the plugin installs from the
repository directly:

> **Skill budget is full (5/5).** The remote server advertises the skills it
> bundles through OpenAI's skills extension, which supports **at most 5**. All
> five slots are taken, so adding a new skill requires retiring or merging an
> existing one (`loadSkillCatalog` fails closed above 5).

```bash
claude plugin marketplace add lumizone/postsider
claude plugin install postsider@postsider
```

Installation stores the key outside the plugin: pass it at install time with
`--config api_key=your_api_key`, or set it afterwards with
`/plugin configure postsider@postsider` inside Claude Code. The key is never
written into the plugin directory.

## What the agent can do

40 tools on the hosted server, 41 on the local stdio server, and 42 on the local
stdio server when you opt in to approval decisions (see Configuration), all
prefixed `postsider_`.

### Read

| Tool | Action |
|------|--------|
| `postsider_list_channels` | List connected social channels (ids, names, platforms). Call this first to get channel ids. |
| `postsider_get_agency_overview` | Org-wide overview: clients, channels, queued, drafts, published, errors, pending approvals. |
| `postsider_get_customer_report` | The same report scoped to one customer. |
| `postsider_list_groups` | List channel groups. |
| `postsider_list_media` | Browse the media library (paged, searchable) to reuse files already uploaded. |
| `postsider_get_channel_rules` | Platform rules, max length and required `settings` schema for one channel. Call before posting to a new channel. |
| `postsider_get_queue_plan` | A channel's recurring posting slots and timezone. |
| `postsider_get_smart_slots` | Best upcoming times to post on a channel, avoiding booked slots. |
| `postsider_get_content_library` | Saved hashtag groups, caption templates and UTM presets. |
| `postsider_find_slot` | Next free queue slot for a channel, in UTC. |
| `postsider_list_posts` | List posts in a date range, filterable by `state` (e.g. `ERROR`) and channel, paged. |
| `postsider_get_post` | Full post details, including the publish error if any. |
| `postsider_get_post_activity` | Who did what to a post and when (verified actor, approvals, publish and retry events), newest first. |
| `postsider_get_post_missing_fields` | Per-channel validation problems, so they can be fixed before publishing. |
| `postsider_get_post_analytics` | Analytics for a single post. |
| `postsider_get_channel_analytics` | Account-level analytics for a channel. |
| `postsider_get_notifications` | Recent notifications: publish failures, channels needing reconnection. |
| `postsider_get_publishing_state` | Whether publishing is active or paused for the organization. |
| `postsider_get_approval_status` | Approval status of a draft, including a reviewer note when rejected. |

### Write

| Tool | Action | Risk |
|------|--------|------|
| `postsider_create_post` | Create a post as a draft, a scheduled post, or an immediate publish across channels. | Creates content and can publish |
| `postsider_update_post` | Edit an existing post in place: text, media, date, settings, first comment. Not for published or pending-approval posts. | Changes content, re-arms a scheduled post |
| `postsider_update_post_status` | Move a post between `draft` and `schedule`. | Reversible |
| `postsider_retry_failed_posts` | Re-queue only the failed destinations of a post group; unknown-outcome rows need explicit confirmation. | Re-publishes failed rows |
| `postsider_request_approval` | Send a draft into the human approval queue. | Reversible |
| `postsider_upload_media_from_url` | Import media into the library from a public HTTPS URL. | Creates media |
| `postsider_upload_media_base64` | Upload an image or MP4 you hold as bytes (base64: 25 MB on the local server, 2.5 MB over the remote connection). No public URL needed. | Creates media |
| `postsider_upload_media_from_file` | **Local stdio server only.** Upload an image or video (jpg, png, gif, webp, avif, bmp, tiff, mp4, mov, webm, mkv; up to 500 MB) from a file path on your own machine. Other file types are refused before being read. | Creates media |
| `postsider_decide_approval` | **Local stdio server only, opt-in.** Approve or reject the current stage of a pending approval as the API key. Registered only when `POSTSIDER_MCP_ALLOW_APPROVAL_DECISIONS=true`; never on the hosted server. Needs the `approvals:decide` scope on the key, which a key never has by default. A key cannot decide an approval it requested or whose post it created. | Schedules the post on a final approval |
| `postsider_connect_channel` | Get the sign-in link to connect or reconnect a social account (the user approves it on the platform). Needs `channels:write`. | Starts a connection |
| `postsider_set_channel_enabled` | Switch a channel on or off. Needs `channels:write` and an admin role. | Reversible |
| `postsider_disconnect_channel` | Disconnect a channel; unpublished posts become drafts. Needs `channels:write`. | Destructive |
| `postsider_set_queue_plan` | Replace a channel's posting slots (`{time, days?}`: minutes from midnight, optional weekdays 0-6). Read the plan first, it is replaced whole. Needs `channels:write` and an admin role. | Replaces settings |
| `postsider_set_channel_customer` | Assign a channel to a client by name. Needs `channels:write` and an admin role. | Reversible |
| `postsider_save_library_item` | Create or update a hashtag group, caption template or UTM preset. | Creates content |
| `postsider_delete_library_item` | Delete a library item. | Destructive |
| `postsider_duplicate_post` | Copy a post as a new draft, optionally onto another channel. | Creates a draft |
| `postsider_check_policy` | Dry run of the workspace policies for a post you are about to create: `effect` (ALLOW, REQUIRE_APPROVAL, BLOCK), matched rule names and whether this key may do it. Writes nothing. Needs `posts:read`. | Read only |
| `postsider_check_post` | AI check of draft text for up to 3 platforms (uses the monthly AI allowance). | Uses AI quota |
| `postsider_rewrite_post` | AI rewrites of a text in a chosen tone (uses the monthly AI allowance). | Uses AI quota |
| `postsider_delete_media` | Delete a media file from the library and storage. | Destructive |
| `postsider_delete_post` | Permanently delete a post **and every other channel version of it** (one group). Read the post first. | Destructive |
| `postsider_pause_publishing` | Emergency stop for the whole organization. Resuming is human-only. | Destructive |

### Access scopes (remote server)

| Scope | Allows |
|-------|--------|
| `posts:read` | Every read tool. |
| `posts:write` | Posts, media, library, duplication and AI checks. |
| `channels:write` | Connecting, enabling, disabling, re-timing, re-assigning and disconnecting channels. Granted separately so an agent that may only schedule posts cannot reconfigure the workspace. Connections made before this scope existed need to be reconnected to get it. |

Billing, team and roles, API keys, MFA, account deletion and resuming a paused
workspace are deliberately not available to agents; they stay in the dashboard.

Every tool declares `readOnlyHint`, `destructiveHint`, `idempotentHint` and
`openWorldHint` explicitly, so a client can tell a read from a kill switch.

For the exact API endpoint/scope matrix, a no-publication
`draft → readback → schedule → status` test and the Claude/Codex/Cursor
verification checklist, see
[API & MCP trust checklist](../../docs/API-MCP-TRUST.md).

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTSIDER_API_KEY` | yes | - | Organization API key (Settings -> API) |
| `POSTSIDER_API_URL` | no | `https://api.postsider.com` | Instance base URL |
| `POSTSIDER_MCP_ALLOW_APPROVAL_DECISIONS` | no | unset (off) | Local stdio server only. Exactly `true` registers `postsider_decide_approval`. Anything else leaves it out. |

`POSTSIDER_API_URL` must be HTTPS. Plain HTTP is accepted only on loopback
(`localhost`, `127.0.0.1`, `[::1]`) for local development.

For a self-hosted instance, point `POSTSIDER_API_URL` at where the public API is
served. Behind the bundled nginx the API lives under `/api`, so use your domain
plus `/api`, e.g. `https://social.example.com/api`. The server appends
`/public/v1` to whatever you set.

## Safety

- The API key is read from the environment and sent only to the configured
  PostSider API URL. It is never printed, logged, or included in an error.
- Credentials embedded in `POSTSIDER_API_URL` are rejected.
- Redirects are refused rather than followed: a redirect would move an
  authenticated request off the configured origin, so the client fails with an
  actionable message instead.
- Requests time out after 30 seconds, and a failing response body is read up to
  8 KB before being reported.
- Tool arguments are validated locally, before any network call: ids must be
  non-empty, dates must be real ISO 8601 dates (`2026-02-30` is refused, not sent
  to the API), post status `draft` or `schedule`, and media imports require a
  public HTTPS URL.
- Deciding an approval is opt-in and local only. `postsider_decide_approval` is
  absent unless you start the local stdio server with
  `POSTSIDER_MCP_ALLOW_APPROVAL_DECISIONS=true`, the hosted server never offers
  it (OAuth tokens cannot hold `approvals:decide`), and the API key itself must
  carry the `approvals:decide` scope. The API refuses a key that requested the
  approval or created the post, so an agent cannot approve its own work. The tool
  reads the approval first and ties its `Idempotency-Key` and an `expectStage`
  value to the current stage and request time, so a retry of the same decision
  is harmless and a stale call cannot decide a later stage (it gets a 409).
- A missing API key exits 1 with an explanatory message on stderr. stdout carries
  protocol frames only.

## Development

```bash
pnpm --filter @postsider/mcp typecheck
pnpm --filter @postsider/mcp typecheck:tests
pnpm --filter @postsider/mcp test
pnpm --filter @postsider/mcp build
pnpm --filter @postsider/mcp version:gate
pnpm --filter @postsider/mcp validate:registry
pnpm --filter @postsider/mcp smoke:tarball
claude plugin validate --strict apps/mcp
```

## Design

This server is a thin wrapper over selected `/public/v1` REST API endpoints,
authenticated with the raw API key. It has no dependency on the backend and
pulls in only `@modelcontextprotocol/sdk` and `zod`, so it stays lean and easy to
maintain. All tool registrations live in a single factory, so the stdio
transport today and any future transport share one agent-facing surface.
