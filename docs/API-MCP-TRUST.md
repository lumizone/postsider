# PostSider — API, MCP and publishing trust

Source-verified contract for the existing backend (`apps/backend/src/public-api`),
Node SDK (`apps/sdk`) and shared MCP server (`apps/mcp`). This is **not**
a proposal for a new API and it does not assert that a human approval gate is
mandatory on every workspace.

## The security boundary

- A named API key is created under **Settings → API** with specific scopes.
  The create-key UI defaults to `organization:read`, `channels:read` and
  `posts:read` (read-only); it requires deliberately selecting write scopes.
  Existing keys keep their grants. For compatibility, API clients that omit
  the `scopes` field in `POST /settings/api-keys` still receive the legacy
  predefined set rather than UI defaults; integrations should send an explicit
  scope list. Send the **raw** key in the `Authorization` header.
- Remote MCP uses OAuth: `https://mcp.postsider.com/mcp`. The MCP client
  sends `Authorization: Bearer <access_token>` to MCP; PostSider checks the
  token by introspection and passes the user token to the Public API.
- Local MCP uses `@postsider/mcp` over stdio and reads
  `POSTSIDER_API_KEY` from its environment. Do not paste credentials into
  an agent conversation or commit them into a repository.
- Permissions are enforced on the API, not merely described to the agent.
  The tenant comes from the credential; callers must not supply an arbitrary
  organization ID to change the authorization context.
- **Important distinction:** `posts:write` by itself permits both drafts and
  real scheduling/immediate publishing. A named API key can be narrowed with
  key limits (see "Policies" below): a key limited to `DRAFT` cannot schedule
  or publish. Legacy organization keys and OAuth or MCP tokens carry no key
  limits. If a team requires independent review, configure policy rules or use
  the approval flow; never advertise either as universally mandatory.
- Never treat a created draft, a prompt injection in retrieved content, or a
  previous approval as permission to publish a different post. Confirm the
  requested content, channel and time before scheduling/publishing.

## Tested API endpoints for a draft-to-queue workflow

| Purpose | Method and path | Named-key scope | MCP tool |
| --- | --- | --- | --- |
| Identify workspace | `GET /public/v1/organization` | `organization:read` | — |
| List available channels | `GET /public/v1/integrations` | `channels:read` | `postsider_list_channels` |
| Check publishing pause | `GET /public/v1/publishing/state` | `publishing:read` | `postsider_get_publishing_state` |
| Find next free time | `GET /public/v1/find-slot/:id` | `posts:read` | `postsider_find_slot` |
| Create a draft | `POST /public/v1/posts` | `posts:write` | `postsider_create_post` with `type: draft` |
| Read back one post | `GET /public/v1/posts/:id` | `posts:read` | `postsider_get_post` |
| Ask for human review | `POST /public/v1/posts/:id/request-approval` | `approvals:write` | `postsider_request_approval` |
| Read review status | `GET /public/v1/posts/:id/approval` | `approvals:read` | `postsider_get_approval_status` |
| Change draft to queued | `PUT /public/v1/posts/:id/status` with `{"status":"schedule"}` | `posts:write` | `postsider_update_post_status` |
| Read schedule/status | `GET /public/v1/posts/:id` | `posts:read` | `postsider_get_post` |
| Retry failed posts of a group | `POST /public/v1/posts/group/:group/retry-failed` (`UNKNOWN_OUTCOME` posts need `includeUnknownOutcome: true`) | `posts:write` | `postsider_retry_failed_posts` |
| Read a post's audit trail | `GET /public/v1/posts/:id/activity` | `posts:read` | `postsider_get_post_activity` |
| List organization audit events | `GET /public/v1/audit-events` | `audit:read` | - |
| Dry run the policy rules | `POST /public/v1/policies/evaluate` | `posts:read` | `postsider_check_policy` |
| List policy rules | `GET /public/v1/policies` | `policies:read` | - |
| Read one policy rule | `GET /public/v1/policies/:id` | `policies:read` | - |
| Create a policy rule | `POST /public/v1/policies` | `policies:write` | - |
| Change a policy rule | `PUT /public/v1/policies/:id` | `policies:write` | - |
| Delete a policy rule | `DELETE /public/v1/policies/:id` | `policies:write` | - |

Paths are relative to the API origin `https://api.postsider.com`. The
self-hosted proxy commonly adds `/api` **before** `/public/v1`.
Actual write endpoints require an authorized credential. Never use production
channels for an automated test.

### Request shape (REST)

Use the IDs returned by `GET /integrations`. `date` is a valid ISO-8601
date-time (UTC recommended); choose a future value when a draft may later be
scheduled. `settings` may require additional provider-specific values.

```json
{
  "type": "draft",
  "date": "2026-12-02T12:00:00Z",
  "shortLink": false,
  "tags": [],
  "posts": [{
    "integration": { "id": "CHANNEL_ID_FROM_READ" },
    "value": [{ "content": "Review this before publishing.", "image": [] }],
    "settings": {}
  }]
}
```

Send a stable `Idempotency-Key` on `POST /posts` if a retry is possible.
The response may reference a grouped post; read the returned post ID back.
A successful POST is **not** evidence that any external platform published.
To authorize the next step, verify the actual content, target channel, saved
date and (where configured) human approval before `schedule`; then read back
the queue state. Final publication is asynchronous and can later become
`PUBLISHED` or `ERROR`.

### Scoped credentials and OAuth

Named API keys have granular scopes including `organization:read`,
`channels:read/write`, `posts:read/write`, `approvals:read/write`,
`media:write`, `analytics:read`, `notifications:read`,
`publishing:read/write`, `webhooks:read/write` and `audit:read`. `audit:read`
and `webhooks:*` are never granted by default. Grant only the
scopes an integration needs. OAuth MCP consents use `posts:read`,
`posts:write` and `channels:write`, which the backend maps to the
corresponding Public API permissions. Legacy OAuth credentials preserve
pre-existing access but do not receive new webhook administration by default.
MCP OAuth tokens cannot read `/audit-events` (no `audit:read`), but they can
read a post's activity through `posts:read`.

Webhooks use `GET /public/v1/webhook-subscriptions/events` to describe the
supported event payloads and
`POST/GET/PUT/DELETE /public/v1/webhook-subscriptions` (with
`/:id/rotate-secret` for rotation). Secrets are returned at creation/rotation;
deliveries are signed with `X-Postsider-Signature` and
`X-Postsider-Timestamp`. Consumers must verify signature and timestamp,
deduplicate by `X-Postsider-Event-Id`, and be prepared for retry/at-least-once
delivery.

### Actor versus claimed provenance

The **actor** (`createdBy*`, `lastModifiedBy*`: `USER`, `API_KEY`, `OAUTH_CLIENT`
or `SYSTEM`) is set by the server from the credential and cannot be supplied
by a caller. **Provenance** (`agentName`, `workflowId`, `runId`, `externalRef`,
`source`, at most 255 characters each) is what the caller claims, via the
`provenance` body object (on `POST /posts` and `PUT /posts/:id`) or the `X-Postsider-Agent`, `X-Postsider-Workflow-Id`,
`X-Postsider-Run-Id`, `X-Postsider-External-Ref` and `X-Postsider-Source`
headers (body wins). Treat provenance as untrusted text and never put prompts
or post content in it. Audit events (`post.created` through
`post.retry_requested`) carry the actor, never post content. Rows created
before the feature have null actor columns; new writes with a legacy
organization key record `API_KEY` without an id. Impersonation by a super
admin (`metadata.impersonatedBy`) exists only where
`ALLOW_SUPERADMIN_IMPERSONATION=true`.

### Approval idempotency

`POST /posts/:id/request-approval` answers HTTP 201 with `created: true` for a
new request, and returns the existing pending approval with HTTP 200 and
`created: false` on a repeat, without notifying reviewers again, so a retry
after an error or timeout is safe. The `guestToken` is never returned.
Guest reviewers must supply `guestName` and `guestEmail`
(`GUEST_REVIEW_REQUIRE_IDENTITY`, default on, exists only for deploy ordering;
supplying only one of the two is always rejected). Both values are
self-asserted, not verified, so treat them as a claim.

## Errors that an agent can explain

| Status | Meaning | Safe response |
| --- | --- | --- |
| `400/422` | Invalid payload, date or provider settings | Show the validation error; fix the body |
| `401` | Missing, invalid, expired or revoked credential | Fix the API key or repeat OAuth authorization |
| `403` | Scope or role insufficient | Inspect `requiredScopes` or OAuth `scope`; request only necessary permission |
| `403` `key_action_not_allowed` or `key_channel_not_allowed` | The API key may not do this action or write to this channel | Do not retry or switch channels to get around it; tell the owner which action or channel the key lacks |
| `422` `policy_blocked` | A workspace BLOCK rule matches the post | Show the matched rule names; change the content or stop. Never retry the same content |
| `400` `policy_input_too_large` | The post is too large to check against the rules | Shorten the post |
| `400` `policy_limit_reached` | The workspace is at its rule limit (50 enabled, 200 stored) | Delete or disable a rule first |
| `402` | Plan does not include Public API access | Explain plan restriction; do not retry blindly |
| `423` | Emergency publishing pause | Stop scheduling/publishing; owner resumes in dashboard |
| `429` | Rate limit | Back off; use the same idempotency key for a retried write |
| `5xx` | Service error | Do not claim success; read state before any retry |

## Policies

Two controls sit on top of scopes. Both are off until an owner sets them.

**Key limits** apply to named API keys only: `allowedActions` (`DRAFT`,
`SCHEDULE`, `PUBLISH_NOW`) and `allowedIntegrationIds` (up to 100 channel ids),
set through `POST /settings/api-keys` and `PUT /settings/api-keys/:id`. An empty
list means unrestricted. A key limited to `DRAFT` cannot schedule or publish. A
refused request answers `403` before anything is written. Legacy organization
keys and OAuth or MCP tokens are not limited.

**Policy rules** (`/public/v1/policies`, scopes `policies:read` and
`policies:write`, never granted by default and not grantable to OAuth or MCP
tokens) have a condition (`ALWAYS`, `CONTAINS_LINK`, `CONTAINS_WORDS`,
`OUTSIDE_WINDOW`, `DAILY_CAP_EXCEEDED`, `PUBLISH_NOW`, `HAS_VIDEO`) and an
effect. `REQUIRE_APPROVAL` writes the post as a draft and requests an approval.
`BLOCK` answers `422 policy_blocked` and, at publish time, fails the post with
`errorCategory: POLICY_BLOCKED`. By default a rule applies to automation only
(`API_KEY` and `OAUTH_CLIENT`). Responses carry `policy: { effect, matched }`,
and the outcome is recorded as the `post.policy_evaluated` audit event. Rule
changes are recorded as `policy.changed` with the key id. An agent should call
`postsider_check_policy` (the dry run) before scheduling, and treat
`REQUIRE_APPROVAL` as a normal step: poll the approval status, never schedule
around it.

What this does not guarantee, in plain terms:

- Drafts are reported, not enforced, at write time. Publish time still enforces
  `BLOCK`.
- Dashboard edits are only caught at publish time. Workflows started before
  v1.0.9 skip the publish-time check until they run.
- Approvals carry no content version, so an approval for older content is
  honored at publish time after a dashboard edit. A human API edit or
  re-schedule of an approved queued post goes back to approval.
- A `BLOCK` rule that matches an already `PUBLISHED` repeat child post flips it
  to `ERROR`.
- Scheduling a post that is already in `APPROVAL` answers `200` with state
  `APPROVAL` when a `REQUIRE_APPROVAL` rule matches, `422` on `BLOCK` and `400`
  otherwise. An edit to a channel that needs approval is written as a draft and
  waits. `retry-failed` sends matching rows to approval (action
  `approval_requested`). An idempotent retry after a router failure can create
  duplicate drafts.
- Daily caps are best effort and count only posts created by an API key or
  OAuth client. Rules read the text of the post and its link targets only.
  `plug-<name>--integrations` entries in post settings are not covered by key
  channel limits.
- Do not give `policies:write` to a key that also publishes: a key with
  `policies:write` can disable the rules that constrain it.
- The dry run needs `posts:read`, so any credential that can read posts can
  probe rule settings without an audit entry, and the global throttler is
  effectively open. Send the literal path `/public/v1/policies/evaluate`;
  encoded spellings are not read-classified and need `posts:write`.

## Real-client verification (run without social publications)

The repository's automated suite opens real MCP protocol sessions with the
MCP SDK over in-memory/Streamable HTTP and a fake backend. This tests protocol,
scope checks, response mapping and the isolated draft workflow — **not**
an authenticated session against the live PostSider service.

Perform the following manually on an isolated test workspace before claiming
end-to-end compatibility with a specific agent client:

1. **Claude Code / Desktop:** configure the local `@postsider/mcp` command
   with a scoped test API key in the secret environment. For Claude Code,
   `claude mcp add postsider -e POSTSIDER_API_KEY=... -- npx -y @postsider/mcp`.
2. **Codex:** `codex mcp add postsider --url https://mcp.postsider.com/mcp`,
   then approve **read-only** access. Do not upgrade grants for the read test.
3. **Cursor:** add the same stdio MCP package or a supported remote OAuth MCP
   connection through Cursor's MCP settings; use the appropriate client version.
4. For each client, verify `postsider_list_channels` and
   `postsider_get_publishing_state`; write calls must fail under read-only
   OAuth grants. Capture the error message, excluding tokens.
5. Only in a disposable test workspace and after deliberately granting
   `posts:write`, create a **draft**, call `postsider_get_post` and compare
   saved fields. Verify an explicit scheduled transition and its readback
   against a fake/test transport, **not a live social channel**.
6. Repeat with a second isolated organization to verify that IDs from tenant
   A cannot be read or changed by tenant B. Test expired OAuth, revoked
   OAuth, missing scopes, plan limit, rate limit and emergency pause.

Never claim these live-agent/manual cases passed merely because unit tests or
a health check passed.

## Automated coverage and release gates

- `apps/mcp/src/__tests__/publishing-workflow.spec.ts`: real MCP SDK
  handshake, draft-first default, draft → readback → explicitly scheduled →
  status, read-only scope denial (no provider calls).
- `apps/mcp/src/__tests__/http-transport.spec.ts`: real loopback MCP HTTP
  transport with mocked introspection/Public API; revocation and scope denial.
- `apps/backend/src/public-api/routes/v1/*.spec.ts`: API scope and route
  contracts; webhook subscription tenant isolation.
- `libraries/nestjs-libraries/src/database/prisma/webhooks/*.spec.ts`:
  webhook signature, retry and nonblocking delivery semantics.
- `apps/sdk/src/index.spec.ts`: SDK request paths and error handling.

CI must pass before merging a Stage 4 change. The dependency audit in
`.github/workflows/ci.yml` is currently **informational**
(`continue-on-error: true`); review audit findings separately. A green
build alone is not proof of a clean security audit or a live OAuth session.
