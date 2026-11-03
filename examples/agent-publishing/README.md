# Three controlled publishing demonstrations

These are reproducible examples, not claims of a production end-to-end test.
**All examples stop at a saved draft and read-back. None call publish-now.**
They use the existing PostSider API or hosted MCP server; no new vendor.

## Demo 1 — Claude Code, hosted MCP

1. Connect a test channel in PostSider.
2. Run:
   \`\`\`sh
   claude mcp add --transport http postsider https://mcp.postsider.com/mcp
   \`\`\`
3. Authenticate through the client's browser OAuth flow. Inspect granted
   scopes; grant write scopes only to create a draft.
4. Ask:
   > List my channels (name, platform, ID). Do not write or publish.
5. Choose ONE channel yourself. Then:
   > Show the exact proposed text for review. After I approve, create
   > ONE draft on channel [ID]. Explicitly use type=draft, do not
   > schedule or publish, then fetch the returned post ID and report
   > saved state, channel and content.
6. Compare the returned ID to the in-app calendar. Saved DRAFT != published.

The setup is a documented configuration, **not an executed OAuth session**.
See the website's \`/developers/#mcp-setup\` and documentation for MCP tool
parameters and OAuth scopes.

## Demo 2 — Codex, hosted MCP

1. Run:
   \`\`\`sh
   codex mcp add postsider --url https://mcp.postsider.com/mcp
   codex mcp list
   \`\`\`
2. Follow the remote OAuth sign-in flow if prompted; inspect scopes.
3. Use the same read-only channel enumeration and one-approved-draft
   prompt from Demo 1.
4. Verify the persisted draft by its returned post ID.

**Do not** substitute a local API key into a remote OAuth URL.

## Demo 3 — REST / n8n, multi-network draft-only

The executable CLI example below creates **at most 3 drafts**, one for each
explicitly selected connected channel. It never sends a schedule or publish
request. The corresponding importable n8n workflow is hosted at
\`https://postsider.com/n8n/verified-agent-drafts.json\`.

### Preview (safe: no network)

\`\`\`sh
node examples/agent-publishing/verified-draft.mjs
node --test examples/agent-publishing/verified-draft.spec.mjs
\`\`\`

### Actually save test drafts (requires explicit action)

1. In PostSider Settings → API, generate an organization key with
   \`channels:read\`, \`posts:read\`, \`posts:write\`. Store it in
   your local shell; never check it into GitHub or put it in browser JS.
2. Choose one or two explicitly connected **test** channel IDs.
3. Persist the **same** \`POSTSIDER_REQUEST_DATE\`, \`POSTSIDER_DRAFT_TEXT\`
   and \`POSTSIDER_JOB_ID\` across retries; the API hashes the entire JSON
   request for idempotency. The timestamp is required by the current DTO
   even for a draft. Never recalculate it on a retry.

\`\`\`sh
export POSTSIDER_CHANNEL_IDS="PASTE_REAL_CHANNEL_ID"
export POSTSIDER_REQUEST_DATE="2026-11-15T14:00:00.000Z"
export POSTSIDER_JOB_ID="first-safe-draft-demo-001"
export POSTSIDER_DRAFT_TEXT="Test draft only. A human will decide if it should ever be published."
# Set POSTSIDER_API_KEY as a secret in your shell or runner.
node examples/agent-publishing/verified-draft.mjs --create-draft
\`\`\`

The script first reads \`GET /public/v1/integrations\` to confirm selected IDs,
then posts a nested \`type=draft\` payload to \`POST /public/v1/posts\`
with \`Idempotency-Key\`, then calls \`GET /public/v1/posts/:id\` to
check ID, channel, content and \`DRAFT\` state. A failed validation halts.
It does **not** prove a later platform delivery.

For n8n, use the importable JSON, select your n8n Header Auth
credential (\`Authorization\` = raw PostSider key) and your chosen
channel ID, then execute **manually**. No automatic trigger, no live
publish or schedule; verify the resulting post ID yourself.

## Proof criteria and constraints

- A valid **dry-run** and mocked HTTP contract test is useful, but it is
  not a live verified publishing demo. Live OAuth, a connected social
  account, sandbox/real API read-back and human UI comparison must
  be completed separately before recording a public testimonial.
- Never paste or log API keys, OAuth access tokens, account email,
  scheduled-post content of customers or webhook signatures.
- Agent instructions are **not** enforceable server-side approval.
  Use scopes, approval workflows where the plan supports them,
  and explicit human decisions before any future schedule/publish.
