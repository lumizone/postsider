# @postsider/mcp

MCP (Model Context Protocol) server that gives AI agents full access to a
PostSider instance over its public API. Works with Claude Code, Claude Desktop,
Codex, and any MCP-compatible client. Talks to cloud (`api.postsider.com`) or a
self-hosted instance, authenticated with an organization API key.

## What the agent can do

| Tool | Action |
|------|--------|
| `postsider_list_channels` | List connected social channels (ids, names, platforms) |
| `postsider_list_groups` | List channel groups |
| `postsider_find_slot` | Next free queue slot for a channel (UTC) |
| `postsider_list_posts` | List posts in a date range |
| `postsider_create_post` | Create / schedule / publish a post across channels |
| `postsider_update_post_status` | Change a post's status |
| `postsider_delete_post` | Delete a post |
| `postsider_upload_media_from_url` | Import media into the library |
| `postsider_get_post_missing_fields` | Per-channel validation before publishing |
| `postsider_get_post_analytics` | Analytics for one post |
| `postsider_get_channel_analytics` | Account-level analytics for a channel |
| `postsider_get_notifications` | Recent notifications (failures, reconnect prompts) |
| `postsider_request_approval` | Send a draft to the approval queue |
| `postsider_get_approval_status` | Read a post's approval status |

## Setup

1. In PostSider, go to **Settings -> API** and generate an organization API key.
2. Build the server:

   ```bash
   pnpm --filter @postsider/mcp build
   ```

3. Add it to your MCP client config.

### Claude Code

```bash
claude mcp add postsider \
  --env POSTSIDER_API_KEY=your_api_key \
  --env POSTSIDER_API_URL=https://api.postsider.com \
  -- node /absolute/path/to/apps/mcp/dist/index.js
```

### Claude Desktop / generic MCP client

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

For a self-hosted instance, point `POSTSIDER_API_URL` at where the public API is
served. Behind the bundled nginx the API lives under `/api`, so use your domain
plus `/api`, e.g. `https://social.example.com/api`. The server appends
`/public/v1` to whatever you set.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POSTSIDER_API_KEY` | yes | - | Organization API key (Settings -> API) |
| `POSTSIDER_API_URL` | no | `https://api.postsider.com` | Instance base URL |

## Design

This server is a thin wrapper over the public `/public/v1` REST API: one MCP
tool per endpoint, authenticated with the raw API key. It has no dependency on
the backend and pulls in only `@modelcontextprotocol/sdk` and `zod`, so it stays
lean and easy to maintain.
