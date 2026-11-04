# Control Plane Phase 2: Agent identity and audit trail

Date: 2026-11-04
Branch: `feat/control-plane-p2-identity` (stacked on `feat/control-plane-p1-reliability` at 0166b32, which is PR #43 to `main`)
Plan: `docs/superpowers/plans/2026-11-04-control-plane-phase2-identity-audit.md`

## 1. Problem

Agents (API keys, MCP OAuth clients, n8n flows) now create, edit, approve and trigger posts, but PostSider cannot say who did what:

- `Post` records only `creationMethod`, and for the public API that value is taken from the request body, so it can be spoofed and it never names a credential. MCP never sends it. Nothing records who last modified a post.
- `PublicAuthMiddleware` knows which API key or OAuth token made the call (`req.publicApiCredential`) and then throws that knowledge away. API-key calls run with a synthetic SUPERADMIN membership.
- API/MCP-requested approvals are attributed to the organization's SUPERADMIN, and a guest reviewer's decision is stored with `approverId = null` and no name.
- `request-approval` is an upsert that, on every retry, resets the approval to PENDING, clears the guest link, re-sends notifications and re-emits the webhook. A retrying agent (or the n8n node) spams reviewers and invalidates a link the client already holds.
- `AuditLog` only holds security and sign-in events, has no read API and no UI.
- There is no way for a client to attach its own context (workflow name, run id) to a post, so an operator cannot tie a post back to the automation that produced it.

## 2. Goals and non-goals

Goals: a verified, server-derived actor on every post write and approval; clearly separated client-claimed provenance; an idempotent approval request with real attribution and guest identity; lifecycle audit events; a read API for them; additive exposure through API, webhooks and MCP.

Non-goals (binding, decision D7): no billing changes, no change to MCP OAuth flows beyond reading the client id and user id that are already on the grant row, no audit UI (Agent Inbox UI is Phase 4), no backfill of old rows. Explicit, scoped exception to D7 (controller ruling): the frontend changes of R7 (guest review inputs, `audit:read` checkbox) and nothing else in `apps/frontend`.

## 3. Verified facts about the code (this worktree)

CORRECTION marks where the brief was wrong or incomplete.

1. `Post.creationMethod` (`CreationMethod { UNKNOWN WEB API CLI CSV }`) is written only on create (`createOrUpdatePost`, `type === 'create'`). CORRECTION (nuance): public `POST /posts` accepts only `'CLI'` or `'API'` from the body (anything else becomes `'API'`); public `PUT /posts/:id` always passes `'API'`; dashboard passes `'WEB'`, CSV import `'CSV'`. MCP never sends it. Confirmed.
2. `PublicAuthMiddleware` sets `req.publicApiCredential`. CORRECTION: its `type` is `'legacy' | 'api-key' | 'oauth'`, not just "api key or oauth". A `legacy` credential is the organization-level `Organization.apiKey`, which has NO `ApiKey` row and therefore no id. Only `api-key` carries `id` (`ApiKey.id`). The `oauth` branch carries no id today.
3. Two OAuth token families reach the middleware through `OAuthService.getOrgByOAuthToken`: legacy `OAuthAuthorization` (row has `oauthAppId`) and MCP OAuth (`McpOAuthAccessToken -> McpOAuthGrant`, row has `mcpOAuthClientId`). `McpOAuthRepository.findActiveAccessForApi` returns `mcpOAuthGrantId` but not the client id; the scalar `grant.mcpOAuthClientId` is already loaded, so returning it is a one-line additive change and not an OAuth flow change. The id stored for an OAuth actor is the internal row id (`McpOAuthClient.id` or `OAuthApp.id`, uuids that cannot collide), not the public `clientId` string. The authorizing user is also available without an extra query: `grant.userId` (MCP) and `authorization.userId` (legacy) are scalars of the rows the middleware already loads; `findActiveAccessForApi` returns it next to the client id.
4. Dashboard sessions: `AuthMiddleware` sets `req.user`; with impersonation enabled it replaces `req.user` with the impersonated user, so the recorded actor is the impersonated user. The real caller is available there: the original super admin `user` is in scope before it is reassigned, so its id is kept in the ambient context and written to audit metadata as `impersonatedBy` (residual risk, see section 7).
5. `PostApproval.requestedById` is a NOT NULL foreign key to `User`, read by `notifyApproved` and `onRejected` (`requestedBy.email`). CORRECTION: "no SUPERADMIN fallback for attribution" cannot be done by dropping the column. Plan: `requestedById` keeps its current meaning (notification routing recipient, still resolved by `resolveApiRequester` for API calls) and attribution moves to the new `requestedBy*` columns. No nullability change, no behavior change for emails.
6. Guest review: `POST /public/approval-review/:token/resolve` (`public.controller.ts`) takes `{ action, note }`; the existing frontend (`apps/frontend/src/lib/guest-review-api.ts`, `guest-review-view.tsx`) sends exactly that. CORRECTION (conflict between D3 and D7), resolved by controller ruling: requiring `guestName` and `guestEmail` would make the shipped guest page fail with 400, so this phase also adds the two required inputs to the page (R7, an explicit exception to D7). The backend requires both fields by default as D3 says. The switch `GUEST_REVIEW_REQUIRE_IDENTITY` (default `true`) is kept only for deploy ordering, because backend and frontend deploy separately and the page must be live before the backend enforces; it is removed once both are live. Frontend i18n: `useT()` over `lib/i18n/messages/*.ts`; `en.ts` is the source and fallback, and only `en.ts` and `pl.ts` define a `guestReview` block, so the new keys go in those two and the other nine locales fall back to English as they do for the rest of the block.
7. `ApprovalService.requestApproval` (shared by `POST /approval/request` and `POST /public/v1/posts/:id/request-approval`) always upserts, always notifies and always emits. `assertRequestable` accepts posts in `DRAFT` or `APPROVAL`. CORRECTION: the current `requestApprovalFromApi` returns the full `PostApproval` row. Returning an existing PENDING row unchanged would expose `guestToken` to any `approvals:write` API key, so the public response becomes an explicit projection (no `guestToken`, no `guestTokenExpiresAt`).
8. NestJS answers `@Post` with 201 by default. D3 wants HTTP 200 for the unchanged existing approval, so the controller sets 200 only for `created: false` and keeps 201 for a new request.
9. Scopes: `PUBLIC_API_SCOPES` (14 values). CORRECTION: `LEGACY_PUBLIC_API_SCOPES` is "all scopes except `webhooks:*`", so simply appending `audit:read` would silently grant it to every legacy org key and to every `ApiKey` created without explicit scopes (`settings.controller.ts:211`). The legacy filter must also exclude `audit:read`. `CreateApiKeyDto` validates with `IsIn(PUBLIC_API_SCOPES)` so the new scope becomes grantable through the settings API automatically. CORRECTION: the Settings UI scope picker (`apps/frontend/src/app/settings/api/page.tsx`, `API_SCOPES`) is a hardcoded list, not data driven, and renders the raw scope strings (no label keys), so by controller ruling the plan adds `"audit:read"` to that array (R7); no i18n key is needed and it is never preselected. The DB default for `ApiKey.scopes` is unchanged.
10. MCP OAuth scope mapping (`public-api-oauth-scopes.ts`, `mcp-scope-policy.ts`): `grantedScopesForOAuth` maps only `posts:read`, `posts:write`, `channels:write`. No existing OAuth scope fits "read the audit trail", so MCP OAuth tokens get no `audit:read`. `tokenAllows` would classify `GET /audit-events` as `posts:read`, but the public scope guard then returns 403 because `audit:read` is not granted. `GET /posts/:id/activity` needs only `posts:read`, so MCP tokens and keys can use it.
11. Frozen contracts: `apps/mcp/src/__tests__/tool-inventory.ts` (`EXPECTED_TOOL_NAMES`, `EXPECTED_TOOL_COUNT = 38`, `EXPECTED_TOOL_ANNOTATIONS`), `apps/mcp/src/__tests__/http-transport.spec.ts:218` (`toHaveLength(38)`), `apps/mcp/README.md:139` ("38 tools (39 on the local stdio server)") plus the read table, `apps/mcp/server.json` (`toolCount: 38`), `apps/mcp/scripts/tarball-smoke.mjs` (`EXPECTED_TOOL_COUNT = 38`), `apps/mcp/chatgpt-app-submission.json`. Route scope contracts: `public.integrations.scopes.spec.ts` (every `PublicIntegrationsController` route must carry known scopes), `PublicWorkspaceController` is frozen at 14 handlers (so no new route goes there), `public-api.openapi.spec.ts`, `public.reliability.openapi.spec.ts`. `public-api.authorization-contract.spec.ts` exists only on PR #36.
12. MCP transport: stdio runs one long-lived `McpServer`, so the client name is available after `initialize` (`server.server.getClientVersion()`). The hosted HTTP transport is stateless (`sessionIdGenerator: undefined`, a new server per request, `initialize` never seen), so there the client name is NOT available and `agentName` is omitted. `PostsiderClient.request` builds every header in one place (`client.ts` ~269), which is where `X-Postsider-Source: mcp` goes.
13. `AuditLog` (`schema.prisma` ~1097): `operation`, `connectorId`, `actorUserId`, `correlationId` (required), `status` (required), `inputHash`, `type` (a category such as `"security"`), `organizationId` (FK, optional). Writer `AuditLogger.log` already swallows errors. `AuditLogger.query()` has no callers and filters only by connector. CORRECTION: the existing `type` column is a category, so the event name goes in `operation`, the category in `type = 'resource'`, and the public API field `type` is the `operation` value.
14. CORRECTION (affects "post's group" activity): `createOrUpdatePost` assigns a NEW `group` uuid on every write, including in-place updates (`group: uuid` in both branches), and row ids stay stable for updated rows. Group ids are therefore not stable identifiers across edits. Audit events are keyed by row id (`targetId`), and `GET /posts/:id/activity` resolves "the group" to the set of row ids currently in the same group as `:id`, INCLUDING soft-deleted rows, so activity stays readable after a delete.
15. Lifecycle hook points found: create/update in `PostsService.createPost` (after `createOrUpdatePost`); delete in `PostsService.deletePost`; status in `changePostStatus`, `changeDate` (action `schedule`), `setPostState` (approval transitions); retry in `retryFailedRow` (Phase 1); published in `PostActivity.sendWebhooks` (runs for both v1.0.8 and v1.0.9 workflows, next to the public `post.published` webhook); failed in `PostActivity._emitPostFailed` (reached from `changeState` ERROR on v1.0.8 and `markPublishFailed` on v1.0.9); approval in `ApprovalService.requestApproval`, `approve`, `reject`, `resolveGuestReview`. `PostsService`, `ApprovalService` and `PostActivity` already use or can use `@Optional()` trailing constructor parameters; `DatabaseModule` is `@Global` and exports all providers.
16. The Phase 1 webhook payloads: `post.published { post }` (array from `getPostByForWebhookId`), `post.failed { postId, error, errorCategory, errorRetryable, post }`, `approval.requested { approvalId, postId, status }`, `approval.resolved { approvalId, postId, status, note }`. Samples in `public-webhook-events.ts`.
17. Test infra, same as Phase 1: root specs `pnpm exec jest -c jest.config.ts <path> --coverage=false`; MCP `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs <path>`. The throwaway Postgres on port 55432 (`ps_cp`) is migrated to Phase 1 (29 migrations).

## 4. Requirements

Numbering follows decisions D1 to D8. All are binding.

### R1 Verified actor on posts (D1)

New Prisma enum `PostActorType { USER, API_KEY, OAUTH_CLIENT, SYSTEM }`. New `Post` columns, all nullable, no foreign keys:
`createdByType`, `createdByUserId`, `createdByApiKeyId`, `createdByOAuthClientId`, `lastModifiedByType`, `lastModifiedByUserId`, `lastModifiedByApiKeyId`, `lastModifiedByOAuthClientId`.

Decision on foreign keys (the brief allowed "FKs only if safe"): no FKs. Reasons: `Post` is the largest table and validating three new constraints locks it; `ApiKey` rows are soft deleted and `User` rows can disappear while the audit value of the id must remain; the OAuth id points at two different tables. Plain ids plus no new index on `Post` (identity lookups go through `AuditLog`).

R1.1 The actor is derived server-side only, from `req.user` (dashboard) or `req.publicApiCredential` (public API). Nothing from the request body or headers can set it. `creationMethod` stays accepted exactly as today and never influences the actor columns (a test sends spoofing bodies and headers).
R1.2 Mapping: dashboard session `USER` + `userId`; `api-key` credential `API_KEY` + `apiKeyId`; `legacy` organization key `API_KEY` with `apiKeyId = null`; `oauth` credential `OAUTH_CLIENT` + `oauthClientId` (internal row id) and, because it is already loaded, also the authorizing user id in the `*UserId` column (the type stays `OAUTH_CLIENT`; the same holds for `requestedByUserId` on approvals and `actorUserId` in audit rows); no request context (orchestrator, Temporal activities, cron, guest review) `SYSTEM`.
R1.3 Created rows get `createdBy*` and `lastModifiedBy*`. Every update or status change rewrites all four `lastModifiedBy*` columns together (unused ids set to null so the row never mixes identities). Paths covered: `createOrUpdatePost` (create and update branch), `changeState`, `changeDate`, `claimErrorForRetry`, `updateReleaseId`, `deletePost`, `updatePost` (publish success, always SYSTEM), `claimPostForPublish` HELD flip (SYSTEM), `resumePublishing`, `parkPostsForDeletedChannel`. Intentionally not covered (counters and housekeeping, not edits): `recordPublishAttempt`, `updateImages`, evergreen `markRecycled`/`setEvergreen`.
R1.4 The ambient actor is carried by an `AsyncLocalStorage` set in the two auth middlewares around `next()`; default is `SYSTEM`. The context also carries `impersonatedBy` (the real super admin id) for impersonating dashboard sessions; `logResourceEvent` copies it into `metadata.impersonatedBy`. Residual: a request-started fire-and-forget (`startWorkflow` failure marking the post ERROR) inherits the requester as `lastModifiedBy`.
R1.5 Existing rows stay null. No backfill.

### R2 Claimed provenance (D2)

New `Post` columns: `agentName`, `workflowId`, `runId`, `externalRef`, `source`, each `String?` mapped `@db.VarChar(255)`.
R2.1 Accepted on public `POST /posts` and `PUT /posts/:id` through a `provenance` object in the body and through headers `X-Postsider-Agent`, `X-Postsider-Workflow-Id`, `X-Postsider-Run-Id`, `X-Postsider-External-Ref`, `X-Postsider-Source`. Per field, the body wins over the header.
R2.2 Normalization: must be a string; trim; strip control characters (`U+0000-U+001F`, `U+007F-U+009F`); empty after cleaning means absent; more than 255 characters after cleaning is `400` naming the field (never truncated silently). A non-object `provenance` or a non-string field is `400`. Unknown keys inside `provenance` are ignored and never stored.
R2.3 On create the values go on every row created by the request. On update only the fields supplied change; fields not supplied keep their value. Dashboard writes never touch provenance.
R2.4 Provenance is claimed data: it is exposed under the names `provenance` / the raw columns and is never used for authorization or for the actor. Prompts and post content must never be placed in it (documented; the API does not inspect values beyond the rules above).
R2.5 MCP: every request carries `X-Postsider-Source: mcp`; `X-Postsider-Agent` carries the MCP client name when known (stdio only, see fact 12), sanitized to header-safe ASCII and 255 characters.

### R3 Approval attribution and idempotency (D3)

`PostApproval` gains `requestedByType PostActorType?`, `requestedByUserId String?`, `requestedByApiKeyId String?`, `requestedByOAuthClientId String?`, `decidedByType PostActorType?`, `guestName String? @db.VarChar(120)`, `guestEmail String? @db.VarChar(254)`.
R3.1 Requests record the real actor (`actorToColumns(currentActor(), 'requestedBy')`). `requestedById` keeps its notification-routing meaning (fact 5). A dashboard request is `USER`.
R3.2 In-app approve and reject set `decidedByType = USER` (the user id stays in `approverId`). A guest decision sets `decidedByType = null` and stores `guestName` and `guestEmail`.
R3.3 Guest resolve body requires `guestName` (trimmed, 1 to 120) and `guestEmail` (valid email, at most 254), unless `GUEST_REVIEW_REQUIRE_IDENTITY=false`. Both are stored on the approval row. They are returned only to authenticated callers (approval API and webhooks of the same organization), never on the public guest view.
R3.4 Idempotent request: `ApprovalRepository.openRequest` first re-opens a RESOLVED approval with a conditional `updateMany` (`status in (APPROVED, REJECTED)`), otherwise inserts, and on unique violation (`P2002`, a concurrent or earlier PENDING request) returns the existing row. Only the call that created or re-opened the row (`created: true`) sets the post to `APPROVAL`, sends notifications, emits the webhook and writes the audit event. A call that finds a PENDING approval returns it unchanged, with `created: false`, without resetting `guestToken`, `requestedAt` or `requestedBy*`, and without any side effect. Re-opening clears `decidedByType`, `approverId`, `note`, `guestName`, `guestEmail`, `resolvedAt`, `guestToken`, `guestTokenExpiresAt` and sets the new requester.
R3.5 Public response of `POST /public/v1/posts/:id/request-approval`: `{ id, postId, status, note, requestedAt, resolvedAt, requestedBy, created }` (`requestedBy` is the actor view, never `guestToken`), HTTP 201 when `created`, HTTP 200 when not. `GET /posts/:id/approval` adds `requestedBy` and `decidedBy` (actor view, or `{ type: 'GUEST', guestName, guestEmail }`) additively; its existing keys are unchanged. Dashboard `POST /approval/request` keeps its row response plus `created`.

### R4 Post lifecycle audit events (D4)

`AuditLog` gains `targetType String?`, `targetId String?`, `actorType PostActorType?`, `actorApiKeyId String?`, `actorOAuthClientId String?`, `metadata Json?`, plus indexes `(organizationId, targetType, targetId, createdAt)` and `(organizationId, createdAt)`. The existing `actorUserId` column carries the user id.
New writer method `AuditLogger.logResourceEvent(entry: ResourceAuditEntry): Promise<void>`. Best effort: any failure is logged and swallowed, and the wrapper that callers use also catches synchronous errors, so an audit failure can never break publishing, approval or an API call.
Events (exact names): `post.created`, `post.updated`, `post.deleted`, `post.status_changed`, `post.approval_requested`, `post.approval_resolved`, `post.published`, `post.failed`, `post.retry_requested`. `operation` = event name, `type = 'resource'`, `targetType = 'post'`, `targetId` = post row id.
Emission points and `metadata` (primitives only, at most 12 keys, strings at most 200 characters, never post content, error text or secrets):
- `post.created` / `post.updated`: one per channel row (the top-level row) in `createPost`; `{ state, integrationId, group, publishDate, creationMethod (created only) }`. Rows replaced by an edit are not reported as deleted.
- `post.deleted`: one per top-level row in `deletePost`; `{ group, integrationId }`.
- `post.status_changed`: `changePostStatus`, `changeDate` with action `schedule`, `setPostState`; `{ from, to }`. Publisher outcomes are `post.published`/`post.failed`, not status changes; pause and resume HELD transitions are not reported in this phase.
- `post.approval_requested` (only when `created`): `{ approvalId }`. `post.approval_resolved`: `{ approvalId, decision: 'APPROVED' | 'REJECTED' }`, with `by: 'guest'` and `actorType = null` for guests.
- `post.published`: in `PostActivity.sendWebhooks`; `{ integrationId, releaseUrl }`, actor `SYSTEM`. `post.failed`: in `_emitPostFailed`; `{ errorCategory, errorRetryable }`, actor `SYSTEM`, `status = 'error'`.
- `post.retry_requested`: per requeued row in `retryFailedRow`; `{ includeUnknownOutcome, previousErrorCategory }`.

### R5 Audit read API (D5)

New scope `audit:read` in `PUBLIC_API_SCOPES`; excluded from `LEGACY_PUBLIC_API_SCOPES` (fact 9) and from `grantedScopesForOAuth` (fact 10); not in the `ApiKey.scopes` DB default.
`GET /public/v1/audit-events` (`audit:read`, new `PublicAuditController`): filters `targetType`, `targetId`, `type` (one of the nine event names), `from`, `to` (ISO 8601, `from <= to`), `limit` 1 to 100 default 25, `cursor` (opaque). Newest first, ordered by `(createdAt desc, id desc)`. Organization scoped, and restricted to rows with `targetType` not null so security and sign-in rows never appear. Response `{ events: [...], nextCursor: string | null }`. Item: `{ id, type, createdAt, actor: { type, userId?, apiKeyId?, oauthClientId? }, target: { type, id }, metadata }` where `actor.type` is a `PostActorType`, or `GUEST` for guest decisions, or `SYSTEM` when unknown. Invalid filters or cursor are `400`.
`GET /public/v1/posts/:id/activity` (`posts:read`, in `PublicIntegrationsController`): same item shape and pagination, for the row ids of `:id`'s group (fact 14); `404` for an unknown id or another organization's id (same response).
MCP tool `postsider_get_post_activity` (read-only hints, inputs `postId`, `limit?`, `cursor?`) calls the second route. Tool count 39 (40 on stdio). MCP OAuth has no audit access (fact 10); the tool works for keys and tokens with `posts:read`.

### R6 Exposure (D6)

- `GET /public/v1/posts/:id` already returns whole rows: the 8 actor columns and 5 provenance columns appear (a test pins it, and that the integration token is still redacted). `GET /public/v1/posts` select adds them.
- Webhooks `post.published`, `post.failed`, `approval.requested`, `approval.resolved` gain `actor: { createdBy, lastModifiedBy }` (actor views or `null`) and `provenance: { agentName, workflowId, runId, externalRef, source }` (nulls included so the shape is stable), both describing the POST. The two approval events also gain `approval: { requestedBy, decidedBy }`. Existing keys are unchanged; `PUBLIC_WEBHOOK_EVENT_SAMPLES` updated.
- OpenAPI: docs-only DTOs `PublicPostIdentityFieldsDto`, `PublicAuditEventDto`, `PublicAuditEventsPageDto`; new operations documented.

### R7 Frontend exception, no billing, no OAuth flow change (D7)

Frontend, limited to these files: `lib/guest-review-api.ts` (sends `guestName`, `guestEmail`), `components/guest-review-view.tsx` (two required inputs with inline validation, shown before Approve and Reject), new `lib/guest-review-identity.ts` (pure validation, 120 and 254 limits, unit tested), `lib/i18n/messages/en.ts` and `pl.ts` (new `guestReview.*` keys, no em or en dashes), `app/settings/api/page.tsx` (`audit:read` added to `API_SCOPES`, unchecked by default). The frontend has no component test runner, so the component gets a written manual check and the logic a Jest spec under the root run. `GUEST_REVIEW_REQUIRE_IDENTITY` is the only new environment variable (deploy-ordering switch, default `true`).

### R7b Audit retention

The existing daily `publicApiRetentionWorkflow` already calls `purgeExpiredPublicApiRecords`; that activity additionally deletes `AuditLog` rows with `type = 'resource'` and `createdAt` older than 365 days, in batches of 5000. Rows of any other type (security, sign-in, null) are never deleted. The workflow code is not changed.

### R8 Docs (D8)

README sections (actor versus claimed provenance, audit events API, approval idempotency and guest identity, retention and the impersonation residual), `docs/API-MCP-TRUST.md` rows and a section, MCP skill `postsider-approval-workflow`, MCP README, CHANGELOG, `server.json`, ChatGPT submission file. No em or en dashes in any new prose.

## 5. Interaction with PR #36

Command run: `git diff feat/control-plane-p1-reliability...origin/feat/stage4-scoped-api-webhooks-20261103 --stat` reports 52 files changed (2160 insertions, 75 deletions), merge base `c593212`. Files in that list that this phase also modifies:

- `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (this phase: enum, `Post`, `PostApproval`, `AuditLog`; likely textual conflict, different hunks)
- `libraries/nestjs-libraries/src/database/prisma/database.module.ts` (provider list: add `AuditEventsService`; trivial)
- `libraries/nestjs-libraries/src/services/public-api-scopes.ts` (adds `audit:read`; HIGH: the PR also edits the scope list)
- `libraries/nestjs-libraries/src/services/public-api-oauth-scopes.ts` (legacy filter and OAuth mapping; HIGH)
- `apps/backend/src/services/auth/public.auth.middleware.ts` (this phase binds the actor and adds `oauthClientId`; HIGH)
- `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` (provenance, activity route, approval response; HIGH)
- `apps/backend/src/public-api/public.api.module.ts` (register `PublicAuditController`; trivial)
- `apps/backend/src/public-api/routes/v1/public.http.spec.ts`, `public.integrations.scopes.spec.ts` (contract specs)
- `apps/orchestrator/src/activities/post.activity.ts` and `.spec.ts` (audit hooks; HIGH, Phase 1 already conflicts here)
- `libraries/nestjs-libraries/src/database/prisma/approval/approval.service.ts` and `.spec.ts` (attribution, idempotency; HIGH)
- `libraries/nestjs-libraries/src/services/public-webhook-events.ts` (samples)

Files in the PR list this phase does not touch: `settings.controller.ts`, `organization.repository.ts`, the webhook delivery service and DTOs, the frontend settings page and i18n, the scope guard. Recommended order: merge PR #36, then PR #43 (Phase 1), then rebase this branch and resolve the scope list, middleware, controller, approval service and `post.activity.ts` by hand, re-running the scope contract specs and the authorization contract spec (which only exists once #36 lands) with the two new routes and the new scope.

## 6. Compatibility and rollout

- All API, webhook and MCP changes are additive. One migration, additive (new enum, nullable columns, two indexes on `AuditLog`); no data rewrite, no backfill. Adding nullable columns without defaults is a metadata-only change in PostgreSQL, so it does not rewrite `Post`.
- Deploy order: migration, then backend and orchestrator together (the orchestrator writes `post.published` and `post.failed` events and reads the new columns), then MCP. Old backend plus new schema is safe; new backend plus old schema is not.
- Behavior changes to announce: `request-approval` retries no longer reset the approval or re-notify; the public response gains `created` and loses nothing the API returned except it now omits the (previously always null) guest token fields; guest review requires name and email unless `GUEST_REVIEW_REQUIRE_IDENTITY=false`. Deploy the frontend (guest page with name and email) before or together with the backend; if the backend must go first, set `GUEST_REVIEW_REQUIRE_IDENTITY=false` until the page is live, then remove it.
- Existing API keys do not gain `audit:read`. To use the audit API an owner creates a key with `audit:read` (now selectable in Settings, API).
- Audit volume: one row per post event; resource events older than 365 days are purged daily by the Phase 1 retention workflow (R7b); security and sign-in rows are kept.

## 7. Risks and known residual issues

- Impersonation: with `isImpersonationEnabled()` the recorded actor is the impersonated user; the real super admin id is only in audit event metadata (`impersonatedBy`), not in the `Post` columns. Accepted residual: the post row itself cannot tell an impersonated edit from a real one.
- `lastModifiedBy` on a post whose workflow start fails inside a request is the requester, not SYSTEM (R1.4).
- The ambient actor relies on `AsyncLocalStorage` propagation through Nest handlers; covered by a middleware-to-service test, but a code path that detaches from the async context (a manually created worker) falls back to SYSTEM.
- Legacy organization API keys cannot be told apart from each other (`apiKeyId = null`), so audit rows say "an API key" only.
- Provenance is client claimed and can be wrong or malicious text (length and control characters are bounded, nothing else). It must never be rendered as trusted markup or used for decisions.
- Audit writes are best effort, so a database outage can drop events while the operation succeeds (by design, D4).
- Deploy order: backend enforcing guest identity before the new page is live rejects guest decisions (mitigated by the switch, fact 6).

## 8. Open questions

Resolved by controller ruling: guest page and `audit:read` checkbox ship in this phase (R7); OAuth actors also store the authorizing user (R1.2); audit retention 365 days for resource events (R7b); impersonation stays a documented residual with `impersonatedBy` in metadata.

1. Remove `GUEST_REVIEW_REQUIRE_IDENTITY` immediately after both deploys, or keep it for one release?
2. Should pause and resume HELD transitions emit `post.status_changed` (one event per held post) in a later phase?
