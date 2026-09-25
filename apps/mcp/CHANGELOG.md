# Changelog

Notable changes to `@postsider/mcp`. This file begins with the first released
version: earlier internal iterations were never published, so they are not
recorded here.

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

- A Claude Code plugin in the package (`plugin.json`, `.mcp.json`, the
  `postsider-workflow` skill), installable from the repository marketplace:
  `claude plugin marketplace add lumizone/postsider` and
  `claude plugin install postsider@postsider`.
- `server.json` metadata for the MCP Registry, validated against the registry
  schema by `pnpm --filter @postsider/mcp validate:registry`.
- `version:gate` reconciles every place a version is stated (package.json,
  plugin, registry metadata, the reported server version, the pinned npx version
  and the release tag) and blocks a tagged release that still ships the
  `RELEASE_NOT_VERIFIED` banner.
