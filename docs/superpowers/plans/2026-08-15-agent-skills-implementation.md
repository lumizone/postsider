# PostSider Agent Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new public repo, `lumizone/postsider-agent-skills`, containing a shared "core" playbook for driving PostSider through an AI agent plus thin, provider-native adapters for Claude, Cursor, OpenCode, Gemini CLI, OpenAI/ChatGPT, and Hermes — and fix/link it from `docs.postsider.com`.

**Architecture:** `core/` holds the facts (tool list, auth model, task workflows), each `providers/<name>/` holds only "how to wire this into that specific client." A small Node script guards `core/tools-manifest.json` against drift from the real MCP server source (`apps/mcp/src/index.ts` in `lumizone/postsider`), run in CI on a schedule and on every push to this repo.

**Tech Stack:** Plain Markdown/JSON/YAML content repo, Node.js (no framework) for the one sync script, GitHub Actions for CI, `gh` CLI for repo creation, Astro/Starlight (`docs_site`, already in place) for the docs pages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-15-agent-skills-design.md` (in `postsider_app`).
- Source of truth for tool names/schemas is `apps/mcp/src/index.ts` in `lumizone/postsider` — never `docs_site/src/content/docs/cloud/mcp.mdx` (currently stale, fixed in Task 13).
- `core/` is written once; `providers/*` must not restate workflow content, only link to `core/` + connection specifics.
- No em/en-dashes in any rendered copy (repo-wide brand rule, same as `postsider_app`/`docs_site`).
- Agent tokens (`agt_...`) are the recommended credential in all provider docs; the org API key is mentioned only as the fallback/full-access option.
- New repo default visibility: **public** (mirrors `lumizone/postsider`). License: MIT (content-only repo, no code being relicensed from the AGPL-3.0 app).

---

### Task 1: Scaffold the `postsider-agent-skills` repo

**Files:**
- Create (local working copy): `/Users/lukasz/APP and DEV Project/PostSider _Project/postsider-agent-skills/` (new git repo, sibling to `postsider_app`, `docs_site`, `landing_page`)
- Create: `postsider-agent-skills/.gitignore`
- Create: `postsider-agent-skills/LICENSE`
- Create: `postsider-agent-skills/README.md` (placeholder, replaced with real content in Task 12)

**Interfaces:**
- Produces: the repo root that every later task writes into. All later task paths are relative to `postsider-agent-skills/`.

- [ ] **Step 1: Create the local repo**

```bash
cd "/Users/lukasz/APP and DEV Project/PostSider _Project"
mkdir postsider-agent-skills
cd postsider-agent-skills
git init -b main
```

- [ ] **Step 2: Add `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 3: Add `LICENSE`** (MIT, current year owner line)

```
MIT License

Copyright (c) 2026 Lumi Zone Łukasz Blania

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 4: Add placeholder `README.md`**

```markdown
# PostSider Agent Skills

Work in progress. See `docs/superpowers/specs/2026-08-15-agent-skills-design.md`
in `lumizone/postsider` for the design.
```

- [ ] **Step 5: First commit**

```bash
git add .gitignore LICENSE README.md
git commit -m "chore: scaffold repo"
```

- [ ] **Step 6: Create the GitHub repo and push**

```bash
gh repo create lumizone/postsider-agent-skills --public --source=. --remote=origin --push \
  --description "Provider-native AI agent skill packages for PostSider (Claude, Cursor, OpenCode, Gemini, OpenAI, Hermes)."
```

Expected: command prints the new repo URL; `git remote -v` shows `origin` pointing at `github.com/lumizone/postsider-agent-skills`.

- [ ] **Step 7: Verify**

```bash
git log --oneline -1
git ls-remote origin
```

Expected: one commit, remote listing matches local `main`.

---

### Task 2: `core/tools-manifest.json` and `core/tools-reference.md`

**Files:**
- Create: `postsider-agent-skills/core/tools-manifest.json`
- Create: `postsider-agent-skills/core/tools-reference.md`

**Interfaces:**
- Produces: `core/tools-manifest.json` — the machine-readable list `[{ "name": string, "title": string, "description": string, "readOnly": boolean }]` for all 17 MCP tools, consumed by Task 5's sync script and by Task 4/6-11's provider docs (they reference tool names from here).

- [ ] **Step 1: Write `core/tools-manifest.json`**

Transcribed verbatim from `apps/mcp/src/index.ts` in `lumizone/postsider` (tags/descriptions trimmed to one line where the source wraps):

```json
[
  { "name": "postsider_list_channels", "title": "List channels", "readOnly": true,
    "description": "List the social channels (integrations) connected to this PostSider organization. Returns each channel id, name and platform. Call this first to get the channel ids needed by postsider_create_post." },
  { "name": "postsider_get_agency_overview", "title": "Get agency overview", "readOnly": true,
    "description": "Get an organization-wide operational overview for an agency: clients, channels, queued posts, drafts, published posts, errors, recent errors and pending approvals. Useful for morning checks and client reporting. Input: days (int, default 30)." },
  { "name": "postsider_get_customer_report", "title": "Get customer report", "readOnly": true,
    "description": "Get a customer-scoped agency report with channels, queued, draft, published, error and pending approval counts. Input: customerId (from postsider_list_groups), days (int, default 30)." },
  { "name": "postsider_list_groups", "title": "List channel groups", "readOnly": true,
    "description": "List configured channel groups (sets of channels that are published to together)." },
  { "name": "postsider_find_slot", "title": "Find next free time slot", "readOnly": true,
    "description": "Return the next free scheduling date-time (UTC) for a channel, based on its configured posting queue. Use the returned value as the date for postsider_create_post when scheduling into the queue. Input: channelId." },
  { "name": "postsider_list_posts", "title": "List posts", "readOnly": true,
    "description": "List posts scheduled or published within a date range (UTC). Input: startDate, endDate (ISO 8601), customer (optional)." },
  { "name": "postsider_get_post_missing_fields", "title": "Check post for missing fields", "readOnly": true,
    "description": "Return per-channel validation problems / missing required fields for a post, so they can be fixed before publishing. Input: postId." },
  { "name": "postsider_get_post", "title": "Get post details", "readOnly": true,
    "description": "Get the full organization-scoped post group, including current state, scheduled time, media, channel and publish error. Input: postId." },
  { "name": "postsider_get_post_analytics", "title": "Get post analytics", "readOnly": true,
    "description": "Get performance analytics for a single post over the last N days (where the provider supports it). Input: postId, days (default 7)." },
  { "name": "postsider_get_channel_analytics", "title": "Get channel analytics", "readOnly": true,
    "description": "Get account-level analytics for a connected channel (where the provider supports it). Input: channelId, date (optional, provider-specific)." },
  { "name": "postsider_get_notifications", "title": "Get notifications", "readOnly": true,
    "description": "List recent notifications for the organization (e.g. publish failures, channels needing reconnection)." },
  { "name": "postsider_upload_media_from_url", "title": "Upload media from URL", "readOnly": false,
    "description": "Download an image or video from a public URL and store it in the PostSider media library. Returns a media object; pass it (or its array) as images to postsider_create_post. Input: url." },
  { "name": "postsider_create_post", "title": "Create / schedule / publish a post", "readOnly": false,
    "description": "Create a post across one or more channels. type: schedule books it for date; now publishes immediately; draft saves without publishing. Get channel ids from postsider_list_channels and a free slot from postsider_find_slot. Attach media via postsider_upload_media_from_url first. Input: type, date, shortLink, posts[] (channelId, content, firstComment?, images?, settings?), tags?, idempotencyKey?." },
  { "name": "postsider_update_post_status", "title": "Update post status", "readOnly": false,
    "description": "Change the status of an existing post (e.g. move between draft and queue). Input: postId, status." },
  { "name": "postsider_delete_post", "title": "Delete a post", "readOnly": false,
    "description": "Permanently delete a scheduled or draft post by id. Input: postId." },
  { "name": "postsider_request_approval", "title": "Send a draft for approval", "readOnly": false,
    "description": "Push a draft post into the human approval queue for review, instead of publishing or scheduling it directly. The post must already exist as a draft. Input: postId." },
  { "name": "postsider_get_approval_status", "title": "Get a post's approval status", "readOnly": true,
    "description": "Check whether a post submitted via postsider_request_approval has been approved, rejected (with the reviewer's note, if any), or is still pending. Returns NONE if never submitted. Input: postId." }
]
```

- [ ] **Step 2: Validate the JSON parses and has 17 entries**

```bash
node -e "const m=require('./core/tools-manifest.json'); if(m.length!==17) throw new Error('expected 17, got '+m.length); console.log('OK', m.length)"
```

Expected: `OK 17`.

- [ ] **Step 3: Write `core/tools-reference.md`** rendering the manifest as a table (grouped read-only vs write, matching the source file's own section comments):

```markdown
# Tool reference

All 17 tools PostSider's MCP server (`apps/mcp`) exposes, generated from
[`tools-manifest.json`](./tools-manifest.json) — the source of truth is
`apps/mcp/src/index.ts` in [`lumizone/postsider`](https://github.com/lumizone/postsider).
If you are not using MCP (see `providers/openai` or `providers/hermes`), the
same operations are available directly over the `/public/v1` REST API; each
row below notes the REST path it wraps.

## Read-only

| Tool | What it does |
|---|---|
| `postsider_list_channels` | List connected channels (integrations). Call first to get channel ids. |
| `postsider_get_agency_overview` | Org-wide overview: clients, channels, queue, drafts, errors, pending approvals. |
| `postsider_get_customer_report` | Same overview, scoped to one customer/group. |
| `postsider_list_groups` | List channel groups (customers). |
| `postsider_find_slot` | Next free scheduling slot for a channel, per its posting queue. |
| `postsider_list_posts` | List posts in a date range. |
| `postsider_get_post_missing_fields` | Per-channel validation problems for a post. |
| `postsider_get_post` | Full post details, including publish error if any. |
| `postsider_get_post_analytics` | Performance analytics for one post. |
| `postsider_get_channel_analytics` | Account-level analytics for a channel. |
| `postsider_get_notifications` | Recent org notifications (failures, reconnect needed). |
| `postsider_get_approval_status` | Approval status of a draft sent for review. |

## Write

| Tool | What it does |
|---|---|
| `postsider_upload_media_from_url` | Import an image/video into the media library from a URL. |
| `postsider_create_post` | Create a post: draft, scheduled, or immediate, across one or more channels. |
| `postsider_update_post_status` | Move a post between statuses (e.g. draft to queue). |
| `postsider_delete_post` | Permanently delete a post. |
| `postsider_request_approval` | Send a draft into the human approval queue. |

Full input schemas: read `tools-manifest.json`, or ask your MCP client to list
tools (every client does this automatically on connect).
```

- [ ] **Step 4: Commit**

```bash
git add core/tools-manifest.json core/tools-reference.md
git commit -m "docs(core): add tools manifest and reference"
```

---

### Task 3: `core/auth.md`

**Files:**
- Create: `postsider-agent-skills/core/auth.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the auth guidance every `providers/*` page links to instead of restating.

- [ ] **Step 1: Write `core/auth.md`**

```markdown
# Authentication

Use an **agent token**, not your organization's API key, when connecting an
AI agent to PostSider. This page explains why and how.

## Agent tokens vs. the org API key

| | Agent token (`agt_...`) | Org API key |
|---|---|---|
| Scope | Configurable subset of channels + capabilities | Full organization access |
| Rate limits | Per-token, per-minute and per-day | None |
| Human review (HITL) | Optional — can force every post to draft | Not available |
| Expiry | Optional | Never |
| Best for | AI agents, automation pipelines | Your own server-side code |

Create one in PostSider under **Settings > Developers > Agent Tokens > New
Token**. The token value is shown once; store it in your agent's config
(never paste it into a prompt or commit it to a repo).

## Capabilities

Grant only what the agent needs:

- `PUBLISH` — create and schedule posts (implies `SCHEDULE`).
- `ANALYTICS` — read engagement/performance metrics.
- `SOURCE` — pull inbound content from source-capable connectors (Reddit,
  Discord, Gmail, and others).

A request outside the token's granted capabilities or connector scope
returns HTTP 200 with an `error.code` body (`capability_not_allowed`,
`connector_not_authorized`) rather than a 4xx — check the response body, not
just the status code, when calling the REST API directly.

## Human-in-the-loop (HITL) mode

Turn on **Require human approval** on the token (or organization-wide) to
force every post the agent creates into `draft` status regardless of what it
requested. A person reviews and publishes from the dashboard. This is the
recommended setting the first time you connect a new agent, or for any agent
that is not fully trusted yet — combine it with `postsider_request_approval`
so the agent explicitly signals "ready for review."

## Using the token

Send it as the raw `Authorization` header value (no `Bearer` prefix), the
same as an API key:

```
Authorization: agt_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0
```

For MCP-native providers (Claude, Cursor, OpenCode, Gemini CLI), set this as
`POSTSIDER_API_KEY` in the MCP server's environment — the bundled MCP server
(`apps/mcp` in `lumizone/postsider`, published as `@postsider/mcp`) accepts
any valid credential in that variable, agent token or org API key alike.

## Base URL

- PostSider Cloud: `https://api.postsider.com`
- Self-hosted: your instance's public API base, typically `https://<your-domain>/api`

Full reference: [Agent Bridge docs](https://docs.postsider.com/self-hosted/public-api/agent-bridge).
```

- [ ] **Step 2: Commit**

```bash
git add core/auth.md
git commit -m "docs(core): add auth guide"
```

---

### Task 4: `core/workflows.md`

**Files:**
- Create: `postsider-agent-skills/core/workflows.md`

**Interfaces:**
- Consumes: tool names from `core/tools-manifest.json` (Task 2).
- Produces: the task playbook every provider adapter points at.

- [ ] **Step 1: Write `core/workflows.md`**

```markdown
# Workflows

Concrete tool-call sequences for the tasks a PostSider agent is asked to do
most often. Tool names are MCP tool names (see `tools-reference.md`); when
using a non-MCP provider (OpenAI, Hermes), replace each step with the
matching REST call noted in that provider's adapter.

## Schedule a post

1. `postsider_list_channels` — get channel ids (cache these per conversation,
   they rarely change).
2. `postsider_find_slot` with the target `channelId` — get the next free
   queue slot, or use a specific date the user gave you.
3. `postsider_upload_media_from_url` for each image/video, if any — do this
   BEFORE creating the post, and pass the returned media objects as `images`.
4. `postsider_create_post` with `type: "schedule"` and the `date` from step 2
   (or the user's date). Use `idempotencyKey` if you might retry the same
   request (e.g. after a timeout) — reusing it returns the original result
   instead of creating a duplicate.
5. `postsider_get_post_missing_fields` on the returned post id — surface any
   validation problems to the user before considering the task done.

## Publish immediately

Same as above with `type: "now"` at step 4 and no `postsider_find_slot` call.

## Save a draft for human review

1-3 as above.
4. `postsider_create_post` with `type: "draft"`.
5. `postsider_request_approval` with the returned post id.
6. Tell the user it is pending; do not report it as published. Optionally
   poll `postsider_get_approval_status` if the user asks for the outcome
   later in the same session.

## Check how a post performed

1. `postsider_get_post` to confirm it published (state, not just that it was
   created).
2. `postsider_get_post_analytics` with the post id.

## Morning / status check for an agency account

1. `postsider_get_agency_overview` (or `postsider_get_customer_report` for a
   single client) — this alone answers "what's queued, what failed, what
   needs approval" without further calls.
2. Only drill into `postsider_get_notifications` or `postsider_get_post` for
   items the overview flagged as errored.

## Pull content from an inbound source (Reddit, Discord, Gmail, ...)

MCP does not expose this yet — inbound sources are REST-only. See
`core/auth.md` for the token capability required (`SOURCE`) and call
`GET /public/v1/connectors` then `GET /public/v1/inbound/:source` directly
(full shapes: [Agent Bridge docs](https://docs.postsider.com/self-hosted/public-api/agent-bridge)).

## Error handling

- MCP tool calls return `isError: true` with a plain-text message on
  failure — surface that message to the user rather than retrying blindly.
- REST calls under `/public/v1` return HTTP 200 with a structured
  `{ "error": { "code", "message" } }` body for scope/rate-limit problems
  (`capability_not_allowed`, `connector_not_authorized`, `rate_limited`,
  `analytics_not_supported`) — check the body even on a 200. Genuine auth
  failures (bad/revoked token) are a real HTTP 401.
- On `rate_limited`, back off for `error.retryAfter` seconds before retrying,
  do not immediately retry.
- Never invent a channel id, post id, or media object — always obtain them
  from a prior tool call in the same task.
```

- [ ] **Step 2: Commit**

```bash
git add core/workflows.md
git commit -m "docs(core): add task workflows"
```

---

### Task 5: `scripts/check-tools-sync.mjs` + test + CI workflow

**Files:**
- Create: `postsider-agent-skills/scripts/check-tools-sync.mjs`
- Create: `postsider-agent-skills/scripts/check-tools-sync.test.mjs`
- Create: `postsider-agent-skills/.github/workflows/check-tools-sync.yml`
- Create: `postsider-agent-skills/package.json` (minimal, `"type": "module"`, test script)

**Interfaces:**
- Consumes: `core/tools-manifest.json` (Task 2), a path to `apps/mcp/src/index.ts` content.
- Produces: `diffTools(indexTsSource, manifest)` exported from `check-tools-sync.mjs`, returning `{ missing: string[], extra: string[] }` — `missing` = tool names present in the real source but absent from the manifest, `extra` = manifest names not found in the source.

- [ ] **Step 1: Write the failing test**

```javascript
// scripts/check-tools-sync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffTools } from './check-tools-sync.mjs';

const manifest = [
  { name: 'postsider_list_channels' },
  { name: 'postsider_create_post' },
];

test('reports no drift when source and manifest match', () => {
  const source = `
    server.registerTool('postsider_list_channels', {}, async () => {});
    server.registerTool('postsider_create_post', {}, async () => {});
  `;
  const result = diffTools(source, manifest);
  assert.deepEqual(result, { missing: [], extra: [] });
});

test('reports a tool present in source but missing from manifest', () => {
  const source = `
    server.registerTool('postsider_list_channels', {}, async () => {});
    server.registerTool('postsider_create_post', {}, async () => {});
    server.registerTool('postsider_delete_post', {}, async () => {});
  `;
  const result = diffTools(source, manifest);
  assert.deepEqual(result, { missing: ['postsider_delete_post'], extra: [] });
});

test('reports a manifest entry no longer in source', () => {
  const source = `
    server.registerTool('postsider_list_channels', {}, async () => {});
  `;
  const result = diffTools(source, manifest);
  assert.deepEqual(result, { missing: [], extra: ['postsider_create_post'] });
});
```

- [ ] **Step 2: Run it to confirm it fails** (module doesn't exist yet)

```bash
node --test scripts/check-tools-sync.test.mjs
```

Expected: FAIL — `Cannot find module './check-tools-sync.mjs'` or similar.

- [ ] **Step 3: Write `scripts/check-tools-sync.mjs`**

```javascript
#!/usr/bin/env node
/**
 * Diffs the PostSider MCP tool manifest (core/tools-manifest.json) against
 * the real tool registrations in apps/mcp/src/index.ts (from
 * lumizone/postsider), so this repo's docs cannot silently go stale.
 *
 * Usage: node scripts/check-tools-sync.mjs <path-to-index.ts>
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REGISTER_TOOL_RE = /registerTool\(\s*['"]([a-zA-Z0-9_]+)['"]/g;

/**
 * @param {string} indexTsSource
 * @param {Array<{name: string}>} manifest
 * @returns {{missing: string[], extra: string[]}}
 */
export function diffTools(indexTsSource, manifest) {
  const sourceNames = new Set();
  for (const match of indexTsSource.matchAll(REGISTER_TOOL_RE)) {
    sourceNames.add(match[1]);
  }
  const manifestNames = new Set(manifest.map((t) => t.name));

  const missing = [...sourceNames].filter((n) => !manifestNames.has(n)).sort();
  const extra = [...manifestNames].filter((n) => !sourceNames.has(n)).sort();

  return { missing, extra };
}

async function main() {
  const indexPath = process.argv[2];
  if (!indexPath) {
    process.stderr.write('Usage: check-tools-sync.mjs <path-to-index.ts>\n');
    process.exit(2);
  }

  const indexTsSource = readFileSync(indexPath, 'utf8');
  const manifestPath = new URL('../core/tools-manifest.json', import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const { missing, extra } = diffTools(indexTsSource, manifest);

  if (missing.length === 0 && extra.length === 0) {
    console.log(`OK: manifest matches ${manifest.length} tools in ${indexPath}`);
    process.exit(0);
  }

  if (missing.length > 0) {
    console.error('Tools in source but missing from core/tools-manifest.json:');
    for (const name of missing) console.error(`  - ${name}`);
  }
  if (extra.length > 0) {
    console.error('Tools in core/tools-manifest.json but no longer in source:');
    for (const name of extra) console.error(`  - ${name}`);
  }
  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
node --test scripts/check-tools-sync.test.mjs
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Run the script against the real, current source to confirm it's clean today**

```bash
curl -s https://raw.githubusercontent.com/lumizone/postsider/main/apps/mcp/src/index.ts -o /tmp/postsider-mcp-index.ts
node scripts/check-tools-sync.mjs /tmp/postsider-mcp-index.ts
```

Expected: `OK: manifest matches 17 tools in /tmp/postsider-mcp-index.ts`.

- [ ] **Step 6: Add minimal `package.json`**

```json
{
  "name": "postsider-agent-skills",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test scripts/",
    "check-tools-sync": "node scripts/check-tools-sync.mjs"
  }
}
```

- [ ] **Step 7: Add the CI workflow**

```yaml
# .github/workflows/check-tools-sync.yml
name: check-tools-sync
on:
  push:
  pull_request:
  schedule:
    - cron: '0 6 * * 1' # weekly, catches drift even with no PR here
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm test
      - name: Fetch current postsider MCP source
        run: |
          curl -sf https://raw.githubusercontent.com/lumizone/postsider/main/apps/mcp/src/index.ts \
            -o /tmp/postsider-mcp-index.ts
      - run: node scripts/check-tools-sync.mjs /tmp/postsider-mcp-index.ts
```

- [ ] **Step 8: Commit**

```bash
git add scripts/ package.json .github/workflows/check-tools-sync.yml
git commit -m "chore: add tools-manifest sync check + CI"
```

---

### Task 6: `providers/claude/SKILL.md`

**Files:**
- Create: `postsider-agent-skills/providers/claude/SKILL.md`
- Create: `postsider-agent-skills/providers/claude/README.md`

**Interfaces:**
- Consumes: `core/auth.md`, `core/workflows.md`, `core/tools-reference.md` (linked, not restated).

- [ ] **Step 1: Write `providers/claude/SKILL.md`**

```markdown
---
name: postsider
description: Use when the user wants to schedule, publish, or review social media posts through PostSider, check post/channel analytics, or manage connected channels. Trigger phrases: "schedule a post", "post this to X/LinkedIn/...", "check my PostSider analytics", "what's in my queue".
---

# PostSider

PostSider is a social media scheduling platform. This skill connects to a
user's PostSider organization over MCP and drives it through natural
language requests.

## Setup (one time)

1. In PostSider: **Settings > Developers > Agent Tokens > New Token**. Grant
   `PUBLISH` (and `ANALYTICS` if the user wants analytics questions
   answered). See the auth guide below for what each capability unlocks.
2. Add the MCP server to your Claude config (Claude Desktop
   `claude_desktop_config.json`, or Claude Code `.mcp.json`):

```json
{
  "mcpServers": {
    "postsider": {
      "command": "npx",
      "args": ["-y", "@postsider/mcp"],
      "env": {
        "POSTSIDER_API_KEY": "agt_...",
        "POSTSIDER_API_URL": "https://api.postsider.com"
      }
    }
  }
}
```

For a self-hosted instance, set `POSTSIDER_API_URL` to
`https://<your-domain>/api`.

## How to use PostSider tools

Full auth model: `../../core/auth.md`
Tool reference: `../../core/tools-reference.md`
Task playbooks (schedule, publish now, draft + approval, analytics, agency
overview, error handling): `../../core/workflows.md`

Follow `workflows.md` step by step for the task the user asked for. Do not
skip the "get channel ids" / "get a free slot" steps even if you think you
remember them from earlier in the conversation — channels and queues change.

## What NOT to do

- Do not publish (`type: "now"` or `type: "schedule"`) without the user
  having stated or approved the content and target channel(s) in this
  conversation.
- Do not delete a post (`postsider_delete_post`) without explicit
  confirmation of which post.
- If the organization has HITL mode on, posts you create will land as
  drafts regardless of the `type` you pass — tell the user that, don't
  claim it was published.
```

- [ ] **Step 2: Write `providers/claude/README.md`**

```markdown
# Claude (claude.ai / Claude Code)

`SKILL.md` in this directory is a standard [Anthropic
Skill](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) —
Claude discovers and loads it automatically once installed.

**Install:** copy this directory to your skills folder (`~/.claude/skills/postsider/`
for Claude Code, or upload via claude.ai skill settings), and add the MCP
server config from `SKILL.md` to your Claude config.
```

- [ ] **Step 3: Validate the frontmatter YAML parses**

```bash
python3 -c "
import re, yaml
text = open('providers/claude/SKILL.md').read()
fm = text.split('---')[1]
data = yaml.safe_load(fm)
assert 'name' in data and 'description' in data, data
print('OK', data['name'])
"
```

Expected: `OK postsider`.

- [ ] **Step 4: Commit**

```bash
git add providers/claude/
git commit -m "docs(claude): add SKILL.md provider adapter"
```

---

### Task 7: `providers/cursor/`

**Files:**
- Create: `postsider-agent-skills/providers/cursor/mcp.json`
- Create: `postsider-agent-skills/providers/cursor/postsider.mdc`
- Create: `postsider-agent-skills/providers/cursor/README.md`

- [ ] **Step 1: Write `providers/cursor/mcp.json`**

```json
{
  "mcpServers": {
    "postsider": {
      "command": "npx",
      "args": ["-y", "@postsider/mcp"],
      "env": {
        "POSTSIDER_API_KEY": "agt_...",
        "POSTSIDER_API_URL": "https://api.postsider.com"
      }
    }
  }
}
```

- [ ] **Step 2: Write `providers/cursor/postsider.mdc`** (Cursor project rule)

```markdown
---
description: PostSider social media scheduling — when the user asks to schedule, publish, or review posts, or check channel/post analytics
alwaysApply: false
---

Use the `postsider` MCP tools for any request about scheduling, publishing,
or reviewing social media posts, or PostSider analytics.

Task playbooks and error handling: see
`postsider-agent-skills/core/workflows.md` (this repo, vendored or linked —
if not present locally, fetch
https://github.com/lumizone/postsider-agent-skills/blob/main/core/workflows.md).

Do not publish or delete a post without the user confirming the content and
target channel in this conversation.
```

- [ ] **Step 3: Write `providers/cursor/README.md`**

```markdown
# Cursor

**Install:**
1. Copy `mcp.json`'s `postsider` entry into your `.cursor/mcp.json` (project)
   or global MCP settings, filling in your agent token.
2. Copy `postsider.mdc` into `.cursor/rules/postsider.mdc` in your project.

Auth, tool reference, and workflows: `../../core/`.
```

- [ ] **Step 4: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('providers/cursor/mcp.json','utf8')); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add providers/cursor/
git commit -m "docs(cursor): add MCP config and project rule"
```

---

### Task 8: `providers/opencode/`

**Files:**
- Create: `postsider-agent-skills/providers/opencode/opencode.json`
- Create: `postsider-agent-skills/providers/opencode/AGENTS.md`
- Create: `postsider-agent-skills/providers/opencode/README.md`

- [ ] **Step 1: Write `providers/opencode/opencode.json`**

```json
{
  "mcp": {
    "postsider": {
      "type": "local",
      "command": ["npx", "-y", "@postsider/mcp"],
      "environment": {
        "POSTSIDER_API_KEY": "agt_...",
        "POSTSIDER_API_URL": "https://api.postsider.com"
      }
    }
  }
}
```

- [ ] **Step 2: Write `providers/opencode/AGENTS.md`**

```markdown
# PostSider

When asked to schedule, publish, or review social media posts, or to check
PostSider analytics, use the `postsider` MCP tools.

- Auth and capabilities: `core/auth.md`
- Tool reference: `core/tools-reference.md`
- Task playbooks: `core/workflows.md`

Follow the matching playbook in `core/workflows.md` step by step. Never
publish or delete a post without the user confirming content and target
channel in this session.
```

- [ ] **Step 3: Write `providers/opencode/README.md`**

```markdown
# OpenCode

**Install:**
1. Merge the `mcp.postsider` entry from `opencode.json` into your project's
   `opencode.json`, filling in your agent token.
2. Append the contents of `AGENTS.md` to your project's own `AGENTS.md` (or
   copy it in as-is if you don't have one).

Auth, tool reference, and workflows: `../../core/`.
```

- [ ] **Step 4: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('providers/opencode/opencode.json','utf8')); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add providers/opencode/
git commit -m "docs(opencode): add MCP config and AGENTS.md"
```

---

### Task 9: `providers/gemini/`

**Files:**
- Create: `postsider-agent-skills/providers/gemini/settings.json`
- Create: `postsider-agent-skills/providers/gemini/README.md`

- [ ] **Step 1: Write `providers/gemini/settings.json`** (Gemini CLI `mcpServers` block)

```json
{
  "mcpServers": {
    "postsider": {
      "command": "npx",
      "args": ["-y", "@postsider/mcp"],
      "env": {
        "POSTSIDER_API_KEY": "agt_...",
        "POSTSIDER_API_URL": "https://api.postsider.com"
      }
    }
  }
}
```

- [ ] **Step 2: Write `providers/gemini/README.md`**

```markdown
# Gemini CLI

**Install:** merge the `mcpServers.postsider` entry from `settings.json`
into `~/.gemini/settings.json` (or your project's `.gemini/settings.json`),
filling in your agent token.

Gemini CLI loads MCP tool descriptions directly, so no separate instructions
file is required — but read `../../core/workflows.md` yourself first so you
can prompt it well (e.g. "use PostSider to schedule..." rather than assuming
it infers the tool from a vague request).

Auth and tool reference: `../../core/`.

If you use Gemini through a surface without MCP support (the Gemini app, the
API without a tool-use harness), use the `providers/openai/` adapter's
OpenAPI file instead — it works with any REST-capable tool-calling setup,
Gemini function calling included, since the request/response shapes are not
provider-specific.
```

- [ ] **Step 3: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('providers/gemini/settings.json','utf8')); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add providers/gemini/
git commit -m "docs(gemini): add MCP config for Gemini CLI"
```

---

### Task 10: `providers/openai/actions-openapi.yaml`

**Files:**
- Create: `postsider-agent-skills/providers/openai/actions-openapi.yaml`
- Create: `postsider-agent-skills/providers/openai/README.md`

**Interfaces:**
- Consumes: the exact `POST /public/v1/posts` body shape from
  `apps/mcp/src/post-body.ts` (`buildCreatePostBody`) in `lumizone/postsider`:
  `{ type, date, shortLink, tags, posts: [{ integration: { id }, value: [{ content, image }], firstComment?, settings }] }`.
- Consumes: the exact Agent Bridge REST shapes documented in
  `docs_site/src/content/docs/self-hosted/public-api/agent-bridge.mdx`
  (connectors catalog, connector authorize, connector analytics, inbound
  list, inbound subscriptions).

- [ ] **Step 1: Write `providers/openai/actions-openapi.yaml`**

```yaml
openapi: 3.1.0
info:
  title: PostSider Agent Bridge
  description: >
    Scheduling, connector, and inbound-content endpoints for AI agents.
    Authenticate with an agent token (Settings > Developers > Agent Tokens).
  version: "1.0.0"
servers:
  - url: https://api.postsider.com
    description: PostSider Cloud
security:
  - agentToken: []
components:
  securitySchemes:
    agentToken:
      type: apiKey
      in: header
      name: Authorization
      description: >
        Raw agent token value, e.g. "agt_...". No "Bearer " prefix.
  schemas:
    PostBody:
      type: object
      required: [type, date, shortLink, tags, posts]
      properties:
        type:
          type: string
          enum: [draft, schedule, now]
        date:
          type: string
          format: date-time
          description: ISO 8601 UTC. Required even for drafts.
        shortLink:
          type: boolean
        tags:
          type: array
          items:
            type: object
            properties:
              value: { type: string }
              label: { type: string }
        posts:
          type: array
          minItems: 1
          items:
            type: object
            required: [integration, value, settings]
            properties:
              integration:
                type: object
                required: [id]
                properties:
                  id: { type: string }
              value:
                type: array
                items:
                  type: object
                  required: [content, image]
                  properties:
                    content: { type: string }
                    image:
                      type: array
                      items:
                        type: object
                        properties:
                          id: { type: string }
                          path: { type: string }
              firstComment: { type: string }
              settings:
                type: object
                additionalProperties: true
    Connector:
      type: object
      properties:
        identifier: { type: string }
        label: { type: string }
        iconUrl: { type: string }
        capabilities:
          type: array
          items: { type: string, enum: [PUBLISH, SCHEDULE, ANALYTICS, SOURCE] }
        requiredScopes:
          type: array
          items: { type: string }
        authorized: { type: boolean }
    ErrorBody:
      type: object
      properties:
        error:
          type: object
          properties:
            code: { type: string }
            message: { type: string }
            retryAfter: { type: integer }
paths:
  /public/v1/posts:
    post:
      operationId: createPost
      summary: Create, schedule, or immediately publish a post across one or more channels
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/PostBody' }
      responses:
        '200':
          description: Post created.
          content:
            application/json:
              schema: { type: object, additionalProperties: true }
    get:
      operationId: listPosts
      summary: List posts in a date range
      parameters:
        - name: startDate
          in: query
          required: true
          schema: { type: string, format: date-time }
        - name: endDate
          in: query
          required: true
          schema: { type: string, format: date-time }
        - name: customer
          in: query
          required: false
          schema: { type: string }
      responses:
        '200':
          description: Matching posts.
          content:
            application/json:
              schema: { type: array, items: { type: object, additionalProperties: true } }
  /public/v1/connectors:
    get:
      operationId: listConnectors
      summary: Full connector catalog with authorization status for this workspace
      responses:
        '200':
          description: Connector list.
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/Connector' }
  /public/v1/connectors/{id}/authorize:
    post:
      operationId: authorizeConnector
      summary: Start the OAuth flow for a connector, or confirm it is already authorized
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
      responses:
        '200':
          description: Either { authorized: true } or { authorized: false, url }.
          content:
            application/json:
              schema:
                type: object
                properties:
                  authorized: { type: boolean }
                  url: { type: string }
  /public/v1/connectors/{id}/analytics:
    get:
      operationId: getConnectorAnalytics
      summary: Analytics for a connector (requires ANALYTICS capability and the connector to support it)
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
        - name: date
          in: query
          required: false
          schema: { type: string, format: date }
      responses:
        '200':
          description: Analytics data, or an ErrorBody if unsupported/unauthorized.
          content:
            application/json:
              schema:
                oneOf:
                  - { type: object, additionalProperties: true }
                  - { $ref: '#/components/schemas/ErrorBody' }
  /public/v1/inbound/{source}:
    get:
      operationId: pullInboundContent
      summary: Pull a page of content from a SOURCE-capable connector (requires SOURCE capability)
      parameters:
        - name: source
          in: path
          required: true
          schema: { type: string }
        - name: cursor
          in: query
          required: false
          schema: { type: string }
        - name: limit
          in: query
          required: false
          schema: { type: integer, minimum: 1, maximum: 100, default: 25 }
      responses:
        '200':
          description: Page of inbound items.
          content:
            application/json:
              schema:
                type: object
                properties:
                  items:
                    type: array
                    items: { type: object, additionalProperties: true }
                  nextCursor: { type: string, nullable: true }
```

- [ ] **Step 2: Validate the YAML parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('providers/openai/actions-openapi.yaml')); print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Write `providers/openai/README.md`**

```markdown
# OpenAI / ChatGPT

`actions-openapi.yaml` is a Custom GPT Actions schema covering post
scheduling and the Agent Bridge (connectors, inbound content). Paste its
contents into the GPT Builder's Actions editor, set auth to **API Key**
under the `agentToken` scheme, and paste your agent token.

If your ChatGPT setup instead supports MCP connectors directly (Developer
Mode, at the time of writing), use `providers/gemini/settings.json`'s config
shape as a template — the connection details are the same MCP server, only
the config file location differs per client.

Task playbooks: `../../core/workflows.md` — since GPT Actions calls the REST
API directly rather than MCP tools, translate each step: `postsider_list_channels`
becomes `GET /public/v1/connectors`, `postsider_create_post` becomes
`POST /public/v1/posts` with the body shape in `actions-openapi.yaml`, etc.
Add the workflow steps as instructions in the GPT's configuration, not just
the schema — the schema alone does not teach call order.
```

- [ ] **Step 4: Commit**

```bash
git add providers/openai/
git commit -m "docs(openai): add GPT Actions OpenAPI schema"
```

---

### Task 11: `providers/hermes/`

**Files:**
- Create: `postsider-agent-skills/providers/hermes/tools.json`
- Create: `postsider-agent-skills/providers/hermes/system-prompt.md`
- Create: `postsider-agent-skills/providers/hermes/README.md`

- [ ] **Step 1: Write `providers/hermes/tools.json`** (OpenAI-compatible function-calling tool array, covering the same operations as Task 10's OpenAPI)

```json
[
  {
    "type": "function",
    "function": {
      "name": "postsider_list_connectors",
      "description": "List connected social channels and their authorization/capability status.",
      "parameters": { "type": "object", "properties": {} }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "postsider_create_post",
      "description": "Create, schedule, or immediately publish a post across one or more channels.",
      "parameters": {
        "type": "object",
        "required": ["type", "date", "posts"],
        "properties": {
          "type": { "type": "string", "enum": ["draft", "schedule", "now"] },
          "date": { "type": "string", "description": "ISO 8601 UTC." },
          "shortLink": { "type": "boolean", "default": false },
          "posts": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["channelId", "content"],
              "properties": {
                "channelId": { "type": "string" },
                "content": { "type": "string" },
                "firstComment": { "type": "string" }
              }
            }
          }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "postsider_list_posts",
      "description": "List posts scheduled or published within a date range (UTC).",
      "parameters": {
        "type": "object",
        "required": ["startDate", "endDate"],
        "properties": {
          "startDate": { "type": "string" },
          "endDate": { "type": "string" },
          "customer": { "type": "string" }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "postsider_get_connector_analytics",
      "description": "Get analytics for a connected channel (requires the ANALYTICS token capability).",
      "parameters": {
        "type": "object",
        "required": ["id"],
        "properties": {
          "id": { "type": "string" },
          "date": { "type": "string" }
        }
      }
    }
  }
]
```

- [ ] **Step 2: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('providers/hermes/tools.json','utf8')); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Write `providers/hermes/system-prompt.md`**

```markdown
# System prompt addition

Paste this into the system prompt of your Hermes (or any OpenAI-compatible,
function-calling) deployment, alongside `tools.json` as the `tools`
parameter of your chat completion request.

---

You can manage a PostSider social media scheduling account using the
provided tools. Always call `postsider_list_connectors` before
`postsider_create_post` if you do not already know the target channel's id
in this conversation — never invent a channel id.

For scheduling, publishing, drafts, analytics, and error-handling patterns,
follow the playbooks at
https://github.com/lumizone/postsider-agent-skills/blob/main/core/workflows.md
(fetch and read this once at the start of a session if your harness allows
retrieving URLs, otherwise treat the tool descriptions as the guide and ask
the operator for the workflows document if you need more detail).

Never publish or delete a post without the user confirming the exact
content and target channel earlier in this conversation.

---
```

- [ ] **Step 4: Write `providers/hermes/README.md`**

```markdown
# Hermes (self-hosted / open-weight models)

For Hermes and similar open-weight models run through an OpenAI-compatible
API (Ollama, vLLM, OpenRouter, LM Studio), there is no MCP client baked into
most harnesses. Use plain OpenAI-style function calling instead:

1. Pass `tools.json`'s array as the `tools` parameter of your chat
   completion request.
2. Add the contents of `system-prompt.md` to your system prompt.
3. In your harness's tool-execution loop, forward each function call to the
   matching `/public/v1` REST endpoint (see `../openai/actions-openapi.yaml`
   for exact request/response shapes) using your agent token.

Auth: `../../core/auth.md`. This adapter covers the same operations as
`providers/openai/`, just packaged as a raw tool-schema array instead of an
OpenAPI document, since most Hermes harnesses accept the former directly and
not the latter.
```

- [ ] **Step 5: Commit**

```bash
git add providers/hermes/
git commit -m "docs(hermes): add function-calling tool schema for self-hosted models"
```

---

### Task 12: Root `README.md`

**Files:**
- Modify: `postsider-agent-skills/README.md` (replace Task 1's placeholder)

- [ ] **Step 1: Write the real `README.md`**

```markdown
# PostSider Agent Skills

Provider-native packages that teach an AI agent how to drive
[PostSider](https://postsider.com) — schedule and publish social posts,
check analytics, manage channels — through its MCP server and public API.

## Pick your provider

| Provider | What you get |
|---|---|
| [Claude](./providers/claude/) | An Anthropic Skill (`SKILL.md`) for claude.ai / Claude Code |
| [Cursor](./providers/cursor/) | MCP config + a `.mdc` project rule |
| [OpenCode](./providers/opencode/) | MCP config + `AGENTS.md` |
| [Gemini CLI](./providers/gemini/) | MCP config |
| [OpenAI / ChatGPT](./providers/openai/) | GPT Actions OpenAPI schema |
| [Hermes / self-hosted models](./providers/hermes/) | OpenAI-compatible function-calling tool schema |

Every provider adapter is a thin "how to connect" layer over the shared
[`core/`](./core/) content:

- [`core/auth.md`](./core/auth.md) — agent tokens, capabilities, HITL mode
- [`core/tools-reference.md`](./core/tools-reference.md) — all 17 tools
- [`core/workflows.md`](./core/workflows.md) — step-by-step task playbooks

## Staying in sync

`core/tools-manifest.json` is checked in CI against the real MCP server
source in [`lumizone/postsider`](https://github.com/lumizone/postsider), so
this repo cannot silently drift from what PostSider actually exposes. See
`scripts/check-tools-sync.mjs`.

## License

MIT — see [LICENSE](./LICENSE).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: write real README with provider picker"
```

- [ ] **Step 3: Push everything so far**

```bash
git push -u origin main
```

Expected: push succeeds, `github.com/lumizone/postsider-agent-skills` shows all commits.

---

### Task 13: docs.postsider.com — new "AI Agents" section + fix the stale `cloud/mcp.mdx` tool list

**Files:**
- Modify: `docs_site/src/content/docs/cloud/mcp.mdx`
- Create: `docs_site/src/content/docs/cloud/ai-agents.mdx`
- Modify: `docs_site/astro.config.*` or its sidebar config (wherever the `cloud` sidebar group is declared) to add the new page — inspect the existing config to match its exact structure before editing (see Step 1).

- [ ] **Step 1: Inspect the current docs_site config to find the sidebar declaration**

```bash
cd "/Users/lukasz/APP and DEV Project/PostSider _Project/docs_site"
grep -rn "cloud/mcp" astro.config.* 2>/dev/null || grep -rln "sidebar" astro.config.*
```

Read the matched file/section before editing Step 4, so the new entry
follows the exact existing pattern (label/slug format) rather than guessing.

- [ ] **Step 2: Fix the stale tool table in `cloud/mcp.mdx`**

Replace the "Available tools" table (currently listing `integrationList`,
`groupList`, etc.) with the accurate 17-tool table from
`postsider-agent-skills/core/tools-reference.md` (Task 2), reusing its exact
tool names and one-line descriptions. Update the "PostSider exposes **16
tools**" sentence to **17 tools**.

- [ ] **Step 3: Write `docs_site/src/content/docs/cloud/ai-agents.mdx`**

```mdx
---
title: "AI agent skills"
description: "Provider-native setup packages for Claude, Cursor, OpenCode, Gemini, OpenAI, and Hermes."
---

Beyond a generic MCP connection (see [AI agents (MCP)](/cloud/mcp)),
PostSider publishes ready-to-use skill packages for the most common AI
coding and chat agents in
[`lumizone/postsider-agent-skills`](https://github.com/lumizone/postsider-agent-skills)
on GitHub.

Each package is a thin "how to connect" layer over a shared playbook
covering authentication (agent tokens, capabilities, human-in-the-loop
review), the full tool reference, and step-by-step task workflows
(schedule a post, publish now, draft plus approval, check analytics, agency
overview, error handling).

| Provider | Package |
|---|---|
| Claude (claude.ai / Claude Code) | [`providers/claude`](https://github.com/lumizone/postsider-agent-skills/tree/main/providers/claude) |
| Cursor | [`providers/cursor`](https://github.com/lumizone/postsider-agent-skills/tree/main/providers/cursor) |
| OpenCode | [`providers/opencode`](https://github.com/lumizone/postsider-agent-skills/tree/main/providers/opencode) |
| Gemini CLI | [`providers/gemini`](https://github.com/lumizone/postsider-agent-skills/tree/main/providers/gemini) |
| OpenAI / ChatGPT (GPT Actions) | [`providers/openai`](https://github.com/lumizone/postsider-agent-skills/tree/main/providers/openai) |
| Hermes / self-hosted models | [`providers/hermes`](https://github.com/lumizone/postsider-agent-skills/tree/main/providers/hermes) |

Each `README.md` in that repo has exact install steps for its provider.
```

- [ ] **Step 4: Add the page to the sidebar**, following the exact pattern found in Step 1 (do not guess the key names — copy the structure used by the neighboring `mcp` entry and change only the label/slug).

- [ ] **Step 5: Build docs_site to confirm no broken links/config errors**

```bash
cd "/Users/lukasz/APP and DEV Project/PostSider _Project/docs_site"
pnpm run build 2>&1 | tail -40
```

Expected: build succeeds, no "page not found in sidebar config" or MDX
parse errors.

- [ ] **Step 6: Commit**

```bash
git add src/content/docs/cloud/mcp.mdx src/content/docs/cloud/ai-agents.mdx astro.config.*
git commit -m "docs: fix stale MCP tool list, add AI agent skills section"
```

---

### Task 14: Final cross-check

- [ ] **Step 1: Confirm every `core/*` cross-reference from provider adapters resolves**

```bash
cd "/Users/lukasz/APP and DEV Project/PostSider _Project/postsider-agent-skills"
grep -rho '\.\./\.\./core/[a-zA-Z0-9_.-]*\.md' providers/ | sort -u | while read -r ref; do
  f="providers/claude/$ref" # relative path check only needs one provider depth
  target=$(echo "$ref" | sed 's#\.\./\.\./##')
  [ -f "$target" ] && echo "OK $target" || echo "MISSING $target"
done
```

Expected: every line prints `OK`, none `MISSING`.

- [ ] **Step 2: Run the full test suite one more time**

```bash
npm test
node scripts/check-tools-sync.mjs /tmp/postsider-mcp-index.ts
```

Expected: all green, sync check `OK: manifest matches 17 tools`.

- [ ] **Step 3: Push final commits and verify CI is green**

```bash
git push
gh run list --repo lumizone/postsider-agent-skills --limit 3
```

Expected: latest workflow run for `check-tools-sync` shows `success`.

- [ ] **Step 4: Push `docs_site` changes**

```bash
cd "/Users/lukasz/APP and DEV Project/PostSider _Project/docs_site"
git push
```

(Only after confirming with the user this is wanted — `docs_site` deploys
live to docs.postsider.com on push, per its own CLAUDE.md conventions; check
that file for the exact deploy trigger before pushing.)
