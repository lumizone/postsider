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

> **RELEASE_NOT_VERIFIED**: the commands below assume `@postsider/mcp` is
> published on npm. Until the first release is confirmed, use the
> [from source](#from-source) path instead.

Claude Code:

```bash
claude mcp add postsider -e POSTSIDER_API_KEY=your_api_key -- npx -y @postsider/mcp
```

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
the pinned released version, and `skills/postsider-workflow/SKILL.md` teaches the
read-first, draft-first workflow. The repository root is a plugin marketplace, so
the plugin installs from the repository directly:

```bash
claude plugin marketplace add lumizone/postsider
claude plugin install postsider@postsider
```

Installation stores the key outside the plugin: pass it at install time with
`--config api_key=your_api_key`, or set it afterwards with
`/plugin configure postsider@postsider` inside Claude Code. The key is never
written into the plugin directory.

## What the agent can do

19 tools, all prefixed `postsider_`.

### Read

| Tool | Action |
|------|--------|
| `postsider_list_channels` | List connected social channels (ids, names, platforms). Call this first to get channel ids. |
| `postsider_get_agency_overview` | Org-wide overview: clients, channels, queued, drafts, published, errors, pending approvals. |
| `postsider_get_customer_report` | The same report scoped to one customer. |
| `postsider_list_groups` | List channel groups. |
| `postsider_find_slot` | Next free queue slot for a channel, in UTC. |
| `postsider_list_posts` | List posts in a date range. |
| `postsider_get_post` | Full post details, including the publish error if any. |
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
| `postsider_update_post_status` | Move a post between `draft` and `schedule`. | Reversible |
| `postsider_request_approval` | Send a draft into the human approval queue. | Reversible |
| `postsider_upload_media_from_url` | Import media into the library from a public HTTPS URL. | Creates media |
| `postsider_delete_post` | Permanently delete a post **and every other channel version of it** (one group). Read the post first. | Destructive |
| `postsider_pause_publishing` | Emergency stop for the whole organization. Resuming is human-only. | Destructive |

Every tool declares `readOnlyHint`, `destructiveHint`, `idempotentHint` and
`openWorldHint` explicitly, so a client can tell a read from a kill switch.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTSIDER_API_KEY` | yes | - | Organization API key (Settings -> API) |
| `POSTSIDER_API_URL` | no | `https://api.postsider.com` | Instance base URL |

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
