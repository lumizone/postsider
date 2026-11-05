# Control Plane Phase 5: Approvals and distribution

Date: 2026-11-05
Branch: `feat/control-plane-p5-approvals-distribution` (off `origin/main` at 5189e53, which contains Phases 1 to 4)
Plan: `docs/superpowers/plans/2026-11-05-control-plane-phase5-approvals-distribution.md`
Rulings: `docs/superpowers/plans/2026-11-05-control-plane-phase5-controller-rulings.md` (every open question below is answered there; the rulings are binding)

## 1. Problem

Phases 1 to 4 made automation reliable, attributable, governable and visible. Approvals are still the weak link:

- Only a logged-in ADMIN can approve or reject, through the dashboard. A pipeline, an agent with a deliberately granted key, or an approver on a phone who only has an email cannot decide.
- There is one approval stage. An agency cannot say "a reviewer first, then the owner".
- A REQUIRE_APPROVAL policy cannot say which approval flow it wants.
- A known security bug: `GET /approval/pending` and `GET /approval/post/:postId` return the whole `PostApproval` row to every organization member, including `guestToken`. Any member can open `/review/<token>` and approve a post as a "guest", which bypasses the admin-only approve rule.
- Notifications are plain emails to approvers. There is no Slack message, no Make or Zapier starting point, and the n8n node cannot request or read approvals beyond one status call.
- There is no way to create or archive a customer (workspace) through the API.

## 2. Goals and non-goals

Goals: scope-gated approve and reject for API keys and the local MCP server; signed, expiring, single-use approver links in email; multi-stage approvals tied to policy rules; Slack notifications through the existing webhook outbox; a small customer (workspace) provisioning API; Make and Zapier starting assets; an extended, publish-ready n8n node; the `guestToken` exposure fix with hashed storage.

Non-goals (binding, with the rulings Q1 to Q20):
- No change to publishing internals: `post.workflow.v1.0.*.ts` files, `publicApiRetentionWorkflow`, providers and billing stay untouched. The publish-time guard (`PublishPolicyGuard`) is not edited; its reading of `PostApproval.status === 'APPROVED'` stays the contract (section 3 fact 8).
- Every API change is additive. No existing route, field, scope, MCP tool name or webhook event name changes or disappears. Response objects only gain keys.
- Open-source architecture is kept: one env-gated repository, no cloud-only code path. Every new behaviour that sends data outside the instance, or changes who can decide, is off until configured.
- Nothing is published: no `npm publish`, no Zapier or Make app submission, no tag, no push.

Dropped or deferred, with the reason:
- Interactive Slack buttons (approve from inside Slack): needs a Slack-user to member mapping (bot token plus `users:read.email`), per-organization secret storage and the 3 second acknowledgement. Phase 5 ships Slack notifications with a link to the login-gated approval page. The decision service already records `via`, so a later phase adds `SLACK` as a value.
- Approval reminders and automatic approval expiry: need an orchestrator cron and a product decision on what an expired approval does to the post. Only link tokens expire in Phase 5.
- A new webhook event for stage changes: the four event names are frozen (`PUBLIC_WEBHOOK_EVENTS`). Stage progress travels inside the existing `approval.requested` and `approval.resolved` payloads.
- A new audit event type: the eleven names are frozen (`AUDIT_EVENT_TYPES`). Stage and channel go into `post.approval_resolved` metadata.
- A native n8n trigger node and a Make custom app: an example workflow and documentation instead (R7, R6).
- Organization-level provisioning (creating organizations, inviting members, billing seats) and connecting a channel without a human OAuth step: product decisions, see ruling Q9.
- Gating CSV import with policies (listed in the roadmap follow-ups) is not part of the seven items and stays a follow-up.
- Approval decisions from hosted MCP (OAuth) connections: OAuth consents carry only `posts:read`, `posts:write`, `channels:write`; a new consent scope is a separate product decision. The local stdio server gets the tool, off by default.

## 3. Verified facts about the code (this worktree)

1. `model PostApproval` (schema.prisma ~1261): one row per post (`postId @unique`), `status ApprovalStatus` (`PENDING|APPROVED|REJECTED`), `requestedById` (required FK to User), `approverId?`, `requestedBy*` actor columns, `decidedByType?`, `guestName?`, `guestEmail?`, `guestToken? @unique`, `guestTokenExpiresAt?`, `note?`, `resolvedAt?`. There is no `decidedByApiKeyId`, so an automated decision cannot be attributed today.
2. `ApprovalService` (`database/prisma/approval/approval.service.ts`): `requestApproval(orgId, postId, requestedById, actor)`, `requestApprovalFromApi(orgId, postId)` (attributes to the org SUPERADMIN, falls back to ADMIN then any member), `approve(orgId, approvalId, approverId, role)` and `reject(..., note?)` guard with `assertCanApprove(role)` (ADMIN or SUPERADMIN only) and `assertPending`, resolve with the conditional `ApprovalRepository.resolve` (`updateMany where status PENDING`), approve then runs `scheduleApprovedPost` (`PostsService.changePostStatus(orgId, postId, 'schedule', true)` with a `revertApproved` rollback), reject runs `onRejected` (post back to DRAFT, in-app notification, email to requester). Both emit `approval.resolved` and the `post.approval_resolved` audit event. `getForPost` returns the whole row.
3. Guest review: `createGuestLink` (admin only) stores a random 24 byte token in plaintext in `guestToken` with a 7 day expiry and returns it once; the public routes are `GET /public/approval-review/:token` and `POST /public/approval-review/:token/resolve` in `PublicController` behind `AuthRateLimitGuard` (50 attempts per IP per 5 minutes in Redis); the page is `apps/frontend/src/app/review/[token]/page.tsx` plus `components/guest-review-view.tsx`; the identity fields are validated by `GuestReviewResolveDto` and are self-asserted.
4. THE BUG, confirmed: `ApprovalRepository.getPending` calls `findMany({ include: { post, requestedBy } })` with no top level `select`, so Prisma returns every `PostApproval` column, including `guestToken`, `guestTokenExpiresAt`, `requestedById` and `guestEmail`. `ApprovalController.pending` (`GET /approval/pending`) and `forPost` (`GET /approval/post/:postId`, `getApprovalByPost` is a bare `findFirst`) have no role check and are open to every role. The frontend type `PendingApproval` ignores the extra fields, so the leak is silent. `toPublicApproval` (Phase 2) already projects safely for the public API, so only the dashboard path leaks.
5. Public API scopes (`services/public-api-scopes.ts`): 17 scopes, `approvals:read` and `approvals:write` exist. `LEGACY_PUBLIC_API_SCOPES` (default for keys with no explicit scopes and for legacy OAuth) is every scope except `webhooks:*`, `policies:*` and `audit:read`, so `approvals:write` is granted by default and cannot be reused for deciding. `grantedScopesForOAuth(['posts:write'])` maps to `posts:write, media:write, approvals:write, publishing:write`. Pattern to copy: `policies:*` (never granted implicitly, guarded by `services/public-api-scopes.policies.spec.ts`). The API key UI list is `API_SCOPES` in `apps/frontend/src/app/settings/api/page.tsx`.
6. Public approval routes live in `PublicIntegrationsController`: `POST /posts/:id/request-approval` (201 with `created: true`, 200 with `created: false` on a repeat) and `GET /posts/:id/approval` (status, note, requestedAt, resolvedAt, requestedBy, decidedBy). There is no list route and no decide route.
7. Idempotency: `PublicApiIdempotencyService.claim(orgId, key, body)` returns `{kind:'new', id}` or `{kind:'replay', response}`, `complete(id, response)`, `release(id)`. A key reused with a different body is a 409. Used by `createPost` and `retryFailedByGroup`.
8. The write gate and the publish guard treat a post as approved only when `ApprovalService.getForPost(...).status === 'APPROVED'` (`post-policy-gate.service.ts` ~308 and ~340, `publish-policy.guard.ts` ~63). The evaluator skips REQUIRE_APPROVAL rules only when `ctx.approved` is true (`policy-evaluator.ts` ~81); BLOCK always applies.
9. `PolicyApprovalRouter.route(orgId, postId, { terminateWorkflow, onlyFromState? })` is the only caller of `requestApprovalFromApi` for policies. Call sites: `post-policy-gate.service.ts` lines ~126, ~198, ~342, ~364 and `publish-policy.guard.ts` ~85. Matches arrive priority sorted (`compareRules`: priority, createdAt, id).
10. `model PolicyRule` has no relation to approvals. `PolicyEffect` is `REQUIRE_APPROVAL | BLOCK`. `PolicyRulesService.create/update` validate filters and enforce caps (50 enabled, 200 stored).
11. Webhooks: `PUBLIC_WEBHOOK_EVENTS` is `post.published, post.failed, approval.requested, approval.resolved`; `PublicWebhookDeliveryService.send(row, target)` posts `JSON.stringify(row.payload)` with headers `X-Postsider-Event`, `-Event-Id`, `-Timestamp`, `-Signature` (`sha256=` HMAC over `<timestamp>.<body>`) through `ssrfSafeDispatcher`, `redirect: 'error'`; subscription URLs must be public HTTPS (`isSafePublicHttpsUrl`). Subscriptions are managed under `/public/v1/webhook-subscriptions` (scopes `webhooks:read|write`), including `GET /events` (samples), `POST /:id/test`, deliveries and replay. Failure text is stored in `lastError` as `String(error)` cut to 500.
12. Email: `NotificationService.notifyApprovers(orgId, subject, message, integrationId?)` sends one plain message per ADMIN or SUPERADMIN (narrowed by `ChannelAssignment`); `sendEmail(to, subject, html)` goes through `EmailService.sendEmail`, a Temporal `sendEmailWorkflow` signal, so the HTML body is part of workflow history. Providers are `EMAIL_PROVIDER=resend|nodemailer`. `AuthRateLimitGuard` (Redis) already protects the guest endpoints.
13. Customers: `model Customer { id, name, orgId, deletedAt?, integrations }` with `@@unique([orgId, name, deletedAt])`. Existing routes: `GET /public/v1/groups` (id, name), `PUT /public/v1/integrations/:id/customer { name }` (creates the customer by name if missing, empty name unassigns), `GET /public/v1/customers/:customerId/report`. `IntegrationRepository` has `customers(orgId)` (not deleted), `updateOnCustomerName`, `updateIntegrationGroup`. Nothing creates, renames or archives a customer directly; `deletedAt` exists but is never set by public code. Role check pattern: `assertAdmin(org)` in `public.workspace.controller.ts`.
14. MCP (`apps/mcp`): the public tool contract is frozen in `src/__tests__/tool-inventory.ts` (`EXPECTED_TOOL_NAMES`), 40 tools on the hosted server and 41 on stdio (`postsider_upload_media_from_file` is registered only when `allowLocalFiles`, asserted in `src/__tests__/stdio.spec.ts`). `postsider_request_approval` and `postsider_get_approval_status` exist. The remote scope guard (`src/http/scope-guard.ts`) and the API side (`oauth/mcp-scope-policy.ts`) treat every POST as `posts:write` except the policy dry run.
15. The n8n package is a separate git repository, `PostSider _Project/n8n-nodes-postsider` (version `0.1.0-bootstrap.1`, branch `main`). Resources: approval (only `getStatus`), channel, group (`getMany`), media, post, scheduling. Pure request builders in `nodes/PostSider/shared/operations.ts` (`buildOperationRequest`), field definitions in `nodes/PostSider/resources/descriptions.ts`, parameter plumbing in `PostSider.node.ts` (`getParameters`), tests `test/*.test.ts` run with `tsx --test`, `npm run verify` = lint + typecheck + test + build, `.github/workflows/publish.yml` publishes on a `*.*.*` tag with provenance. Authentication header is `Authorization: <api key>`.
16. `AUDIT_EVENT_TYPES` has eleven names; timeline metadata is allow-listed in `agent-activity.view.ts` (`TIMELINE_METADATA_KEYS`); `sanitizeAuditMetadata` drops keys named `content, text, error, token, secret, password, email`.
17. Roles are `SUPERADMIN, ADMIN, USER` (`enum Role`). `OrganizationRepository.getUserOrgLink(orgId, userId)` returns the membership with `role` and `disabled`. `JWT_SECRET` is always configured; `ENCRYPTION_KEY` is optional.
18. A post in state APPROVAL cannot be edited (`PostsService.assertMutable`), so the content a reviewer saw is the content that is approved; stage 2 therefore sees the same content as stage 1.

## 4. Requirements

### R1 Approve and reject through the public API and MCP

R1.1 New scope `approvals:decide`, appended to `PUBLIC_API_SCOPES` after `policies:write`. It is excluded from `LEGACY_PUBLIC_API_SCOPES`, never produced by `grantedScopesForOAuth`, accepted by `CreateApiKeyDto` when requested explicitly, and added to the key dialog scope list (unchecked by default). A spec mirrors `public-api-scopes.policies.spec.ts`.

R1.2 New `PublicApprovalsController` at `/public/v1` (registered in `public.api.module.ts`):
- `GET /approvals?status=PENDING|APPROVED|REJECTED&limit=1..100&cursor=&since=<ISO>` (scope `approvals:read`): newest first by `requestedAt`, cursor pagination (`nextCursor`), `since` filters `requestedAt >= since`. Item shape (the explicit projection `toPublicApproval` extended, never `guestToken`, never `requestedById`): `{ id, postId, status, note, requestedAt, resolvedAt, requestedBy, decidedBy, stage: { position, total, name } | null, stages: [{ position, name, status, decidedBy, decidedAt }] , flow: { id, name } | null, channel: { id, name, providerIdentifier } | null }`.
- `GET /approvals/:id` (scope `approvals:read`): same item plus `preview` (post text cut to 500 characters, plain text) so a deciding agent can see what it is deciding. 404 for unknown or foreign ids.
- `POST /approvals/:id/approve` and `POST /approvals/:id/reject` (scope `approvals:decide`), body `{ note?: string (<= 500) }`, optional header `Idempotency-Key`.

R1.3 Decision rules for a non-human caller (API key or OAuth client; OAuth tokens never have the scope in v1, so in practice an API key):
- The stage being decided must have `allowAutomation = true`. The implicit stage of an approval with no flow has it true (backward compatible: `approvals:decide` is the explicit grant). Stages created by flows default to false.
- A key cannot decide an approval it requested or whose post it created: the decider actor key (`apiKeyId`, or `oauthClientId`) must differ from `requestedBy*` and from the post `createdBy*`. This rule is always on for automation, independent of the flow flags (ruling Q3). A legacy organization key (`apiKeyId` null) counts as one shared identity.
- Key limits (Phase 3 `checkKeyPermission`) apply: approving schedules the post, so the key needs the `SCHEDULE` action on the post's channel (`allowedActions`, `allowedIntegrationIds`). A refusal is the existing 403 `key_action_not_allowed` or `key_channel_not_allowed`.
- Org policy still applies to what happens next: approving skips REQUIRE_APPROVAL rules only; a BLOCK rule still blocks at the publish-time guard.

R1.4 Idempotency and conflicts:
- With `Idempotency-Key`: `PublicApiIdempotencyService.claim(org.id, key, { approvalId, decision, note })`, `complete` on success, `release` on error.
- Without a key the call is naturally idempotent: deciding the same way an already resolved approval was decided returns 200 with `changed: false`; the opposite decision returns 409 `{ error: 'approval_already_resolved', status }`. A pending approval whose current stage was already decided and moved on is treated as "pending, deciding the next stage".
- Success body: `{ approvalId, postId, status, changed, stage: { position, total } , final: boolean }`. `status` is the approval status (`PENDING` after a non final approve).
- `ApprovalController` (dashboard) behaviour does not change: it keeps answering 400 for an already resolved approval.

R1.5 Audit: every decision writes `post.approval_resolved` (existing type) with an explicit actor (the verified key or user, `null` only for guests) and metadata `{ approvalId, decision, via, stage, stageCount, final }` where `via` is one of `DASHBOARD`, `API`, `EMAIL_LINK`, `GUEST`, `BULK`. Allow-list `via`, `stage`, `stageCount`, `final` in `TIMELINE_METADATA_KEYS`. Decisions are stored on the approval row (R3.3) so the existing `decidedBy` view in the public status route shows `API_KEY` deciders.

R1.6 MCP: one new tool `postsider_decide_approval` (input `approvalId`, `decision: 'approve' | 'reject'`, optional `note`), registered only on the local stdio server and only when `POSTSIDER_MCP_ALLOW_APPROVAL_DECISIONS=true` (same optional-registration pattern as `allowLocalFiles`). Hosted tool count stays 40; stdio is 41 by default and 42 with both opt-ins. The tool description says it needs the `approvals:decide` scope, that a key cannot decide its own posts, and that it must only be used when the user asked for that decision. `postsider_get_approval_status` description gains the stage fields.

### R2 Approver links from email and the `guestToken` fix

R2.1 `guestToken` model (fixes fact 4):
- New dashboard projection `toDashboardApproval(row, { isAdmin })` in `approval.projection.ts`. `GET /approval/pending`, `GET /approval/post/:postId` and the controller `request` response return it. Never present: `guestToken`, `guestTokenHash`, `guestTokenExpiresAt`, `requestedById`, `approverId`, `guestEmail` (non admins). Present: `id, postId, status, note, requestedAt, resolvedAt, requestedBy { name, email }`, the existing `post` block for pending, `stage`/`stages` (R3), `hasGuestLink: boolean` and `guestLinkExpiresAt` (admins only).
- Hashed storage: new column `guestTokenHash` (SHA-256 hex, unique). Lookups hash the presented token. `createGuestLink` writes the hash and returns the plaintext once, as today. The migration backfills `guestTokenHash` from existing plaintext and then sets `guestToken = NULL`, so a database dump or a future leak no longer yields working links. The plaintext column stays for one release so a rollback of the application does not hit a missing column (old code then finds no token and the link answers "invalid", which is safe).
- Guest links are minted by admins only (unchanged) and now also require the current stage to allow guests (R3.2); the admin who minted a link for a stage they could not decide themselves cannot launder a self-approval.
- Regression tests: no key of `guestToken*` in any dashboard approval response for a USER member; a member cannot approve through a token they never received; old tokens (migrated by hash) still resolve once.

R2.2 Approver links (off unless `APPROVAL_EMAIL_LINKS=true`, ruling Q1):
- When a stage opens, the service mints one `ApprovalActionToken` per eligible human approver (R3.2) and sends one email per approver containing two buttons, "Review and approve" and "Review and reject", linking to `${FRONTEND_URL}/approve/<token>?intent=approve|reject`. The email HTML is built by a pure template function that HTML-escapes every interpolated value; it contains the channel name, the stage name, who requested, and at most 200 characters of post text. No media, no `<img>`.
- Token: 32 random bytes, base64url, 43 characters. Only `sha256(token)` is stored (`ApprovalActionToken.tokenHash`). TTL `APPROVAL_LINK_TTL_HOURS` (default 48, allowed 1 to 168). One live token per `(approvalId, stagePosition, userId)`; minting again replaces it. Tokens are deleted when the approval resolves, when the stage advances, and when the approval is reopened.
- Public endpoints, unauthenticated, in `PublicController`, both behind `AuthRateLimitGuard`:
  - `GET /public/approver-links/:token` returns the review data and never mutates anything (no state, no `usedAt`, no counters beyond the rate limiter): `{ post: { text, media: [{ path, type }], publishDate }, channel: { name, providerIdentifier }, requester: { name }, stage: { position, total, name }, approver: { name }, selfApprovalBlocked, expiresAt, challenge }`, with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
  - `POST /public/approver-links/:token/decision` with JSON `{ decision: 'approve'|'reject', note?, challenge }`.
- CSRF and prefetch safety (the two step rule): the decision is only possible with a `challenge` that the GET returned. `challenge = <issuedAtMs>.<hex hmac>` where `hmac = HMAC-SHA256(key, tokenHash + '.' + issuedAtMs)` and `key = HMAC-SHA256(JWT_SECRET, 'approver-link-challenge')`. It is stateless and valid when `2 s <= age <= 15 min`; a challenge replayed against a different token fails. A mail scanner or link previewer that only fetches the URL (or even renders the page without clicking) cannot decide. The request needs `Content-Type: application/json`, so a cross-site HTML form cannot submit it, and there is no cookie or ambient credential for a forged request to ride on.
- Single use: the token is consumed in the same transaction as the decision (`updateMany where tokenHash, usedAt null, expiresAt > now`; zero rows means the link is spent). A lost race is a generic "link no longer valid".
- Identity of the approver: the token row names a `userId` (the member the email went to). At decision time the service re-checks that this user is still a non disabled member with an eligible role and is allowed to decide the stage, then records the decision as `USER` with `approverId = userId` and `decidedVia = EMAIL_LINK`. The page states "You are deciding as <name>". A forwarded email lets the recipient act as that member for 48 hours at most; this is documented as the accepted trade-off of a no-login link (ruling Q2) and is why the feature is opt-in.
- Self-approval: a link whose member also created the post is refused when the flow forbids self-approval (R3.3), and the GET reports `selfApprovalBlocked: true` so the page shows the buttons disabled with the reason.
- Error shape: unknown, expired, spent and revoked tokens all answer the same `404 { error: 'link_invalid' }` (no oracle); eligible-no-longer answers `403 { error: 'link_not_allowed' }`; self-approval `403 { error: 'self_approval_blocked' }`; the approval already decided by someone else `409 { error: 'approval_already_resolved', status }`.
- Abuse limits: `AuthRateLimitGuard` per IP; a per token counter in Redis (key from the first 12 hex characters of the token hash): 5 failed decisions (bad or expired challenge, validation errors) revoke the token. Tokens and challenges are never logged; logs use `tokenHash.slice(0, 8)`.
- The frontend page `/approve/[token]` renders the data with React text nodes only, posts the decision, shows the outcome, and never stores the token anywhere except the URL.

R2.3 Notification path: `ApprovalService` calls a new `ApprovalLinkService.sendStageEmails(...)` when a stage opens, only when `APPROVAL_EMAIL_LINKS=true`; otherwise the current `notifyApprovers` plain email is unchanged. If sending fails the approval still stands; the in-app notification and the dashboard remain the fallback.

### R3 Multi-stage approvals

R3.1 Data model (migration `20261105100000_control_plane_approvals_distribution`, additive):
- `ApprovalFlow { id, organizationId, name VarChar(120), isDefault Boolean default false, preventSelfApproval Boolean default true, requireDistinctApprovers Boolean default true, createdAt, updatedAt, deletedAt? }`, `@@index([organizationId, deletedAt])`.
- `ApprovalFlowStage { id, flowId, position Int (1-based), name VarChar(80), minRole Role (ADMIN or SUPERADMIN only, validated), approverUserIds String[] default [], allowAutomation Boolean default false, allowGuest Boolean default false }`, `@@unique([flowId, position])`. At most 5 stages per flow, at most 20 live flows per organization.
- `PolicyRule.approvalFlowId String?` (FK `ApprovalFlow`, `onDelete: SetNull`).
- `PostApproval` gains `flowId String?`, `currentStage Int @default(1)`, `stageCount Int @default(1)`, `decidedVia String? @db.VarChar(20)`, `decidedByApiKeyId String?`, `decidedByOAuthClientId String?`, `guestTokenHash String? @unique`.
- `PostApprovalStage { id, approvalId, position, name, minRole, approverUserIds String[], allowAutomation, allowGuest, status ApprovalStatus default PENDING, decidedByType PostActorType?, decidedByUserId?, decidedByApiKeyId?, decidedByOAuthClientId?, decidedVia?, note VarChar(500)?, decidedAt? }`, `@@unique([approvalId, position])`, `@@index([approvalId])`. It is a snapshot of the flow taken when the approval is requested, so editing or archiving a flow never changes an approval in progress.
- `ApprovalActionToken { id, organizationId, approvalId, stagePosition, userId, tokenHash @unique, expiresAt, usedAt?, createdAt }`, `@@index([approvalId])`, `@@index([expiresAt])`.
- Legacy rows: an approval without `PostApprovalStage` rows is a single implicit stage (`stageCount` 1, `currentStage` 1, `minRole` ADMIN, `allowAutomation` true, `allowGuest` true, `preventSelfApproval` false, `requireDistinctApprovers` false). No backfill of stage rows is needed; the service synthesizes the implicit stage in memory.

R3.2 Who can decide a stage (pure module `approval-stage.rules.ts`, exhaustively table tested):
- Human: the member is not disabled, their role is at least `minRole` (`SUPERADMIN` satisfies `ADMIN`), and `approverUserIds` is empty or contains them. A SUPERADMIN bypasses the `approverUserIds` list (break-glass, ruling Q5) but never the self-approval and distinct-approver rules.
- Automation: R1.3.
- Guest: only when `allowGuest` is true and the link exists for that stage (R2.1).
- `preventSelfApproval` (flow flag, default true for flows): the decider is not the post creator and not the requester (user id equality; for OAuth clients with a `userId`, that user). `requireDistinctApprovers` (default true): an actor that decided an earlier stage of the same approval cannot decide a later one. The implicit stage enforces neither for humans, so a solo owner can still approve their own post (unchanged behaviour), ruling Q3.

R3.3 Flow resolution when an approval is requested (`ApprovalService.requestApproval` gains an optional `opts: { flowId?: string | null; ruleIds?: string[] }`): `flowId` explicit, else the flow of the first matched REQUIRE_APPROVAL rule that has one (`ruleIds` arrive priority sorted), else the organization's default flow, else the implicit stage. Stage rows are created with the approval; a reopen (new request after a rejection) deletes the old stage rows and tokens and snapshots the then current flow. A repeated request on a live approval changes nothing (idempotency unchanged).

R3.4 Decision engine: one method `ApprovalService.decide(orgId, approvalId, decider, decision, opts)` where `decider = { actor: PostActor, userId?: string, role?: string, via: 'DASHBOARD'|'API'|'EMAIL_LINK'|'GUEST'|'BULK', guest?: {name,email} }`. `approve(...)` and `reject(...)` keep their signatures and become thin wrappers (so `AgentActivityActionsService.bulkResolve` and the controller are unchanged). Steps: load approval and stage rows, `assertPending`, pick the current stage, run R3.2, then in one transaction (`PrismaTransaction`): conditional update of the stage row (`status PENDING` to the decision, with `decidedBy*`), and
- reject at any stage: the approval becomes `REJECTED` (final, `approverId`/`decidedBy*` of the rejecter, `note`), later stages are left `PENDING` (`ApprovalStatus` has no skipped value; the approval status is the truth and every read surface shows stages after the rejected one as "not reached"); the post returns to DRAFT through the existing `onRejected`; the requester is notified as today.
- approve a non final stage: `currentStage + 1`, status stays `PENDING`, the post stays in APPROVAL, nothing is scheduled; the next stage's approvers are notified (in-app, and email or links per R2.3); a webhook is not emitted (ruling Q6) but `GET /approvals` shows the progress.
- approve the final stage: the approval becomes `APPROVED` with the final decider, then `scheduleApprovedPost` (existing, with the existing revert on failure; the revert also resets the last stage row), `notifyApproved`, `approval.resolved` webhook.
Because `PostApproval.status` is `APPROVED` only after the last stage, `getForPost(...).status === 'APPROVED'` keeps meaning "all stages approved" for the write gate and the publish guard with no change to them. A test pins this: a two stage approval with stage 1 approved reads `PENDING` in `getForPost`, the post is still in APPROVAL, and `PublishPolicyGuard` would route (not allow) a REQUIRE_APPROVAL post.

R3.5 Flow management:
- Dashboard (`ApprovalFlowsController`, `/approval-flows`, admin only): `GET`, `POST`, `PUT /:id`, `DELETE /:id` (archive: sets `deletedAt`; refused with 409 `flow_in_use` while an enabled rule references it; in-flight approvals are unaffected).
- Public API (`/public/v1/approval-flows`, scopes `policies:read` and `policies:write`, because choosing who approves is governance, ruling Q8): same four operations. The one default flow per organization is switched with `isDefault: true` in a transaction that clears the previous default.
- Validation (DTO plus service): positions are contiguous `1..n` in array order, names 1 to 80 characters, `minRole` in `ADMIN|SUPERADMIN`, `approverUserIds` are members of the organization (max 20 per stage), a flow must have 1 to 5 stages.
- Rules: `CreatePolicyRuleDto` and `UpdatePolicyRuleDto` get optional `approvalFlowId` (nullable to clear); the service accepts it only when `effect` is `REQUIRE_APPROVAL` and the flow exists in the organization and is live (400 `approval_flow_invalid`); `PublicPolicyRule` and the dashboard rule view include it. `PolicyApprovalRouter.route` takes `ruleIds` and passes `{ ruleIds }` to the approval request; the five call sites pass the matched REQUIRE_APPROVAL rule ids.

R3.6 Read surfaces gain `stage` and `stages` (dashboard pending list, `GET /posts/:id/approval`, `GET /approvals`, agent activity drawer approval block) and the `approval` object of the `approval.requested` and `approval.resolved` webhook payloads gains `stage: { position, total, name }`. Sample payloads in `public-webhook-events.ts` are updated and the existing webhook payload specs extended.

### R4 Slack notifications

R4.1 No new service, secret store or env. A Slack incoming webhook URL is registered as an ordinary webhook subscription (`POST /public/v1/webhook-subscriptions` or Settings > Webhooks) for the events the owner wants. `PublicWebhookDeliveryService.send` detects a Slack target (`https:` and hostname exactly `hooks.slack.com` and path starting `/services/`) and sends Slack's body instead of the envelope: `{ "text": "<fallback>", "blocks": [section, actions] }`. The signature and event headers are still sent (Slack ignores them).

R4.2 Message content (pure `slack-message.ts`, unit tested): a one line mrkdwn summary per event, with Slack special characters (`& < >`) escaped and every interpolated value cut to 200 characters:
- `approval.requested`: "A post is waiting for approval (stage 1 of 2: Reviewer)." and a "Review in PostSider" button to `${FRONTEND_URL}/approval`.
- `approval.resolved`: "A post was approved (or rejected)." plus the note (cut to 200) and a button to `${FRONTEND_URL}/agents`.
- `post.failed`: "A post failed to publish (<errorCategory>)." and a button to `${FRONTEND_URL}/agents`.
- `post.published`: "A post was published." with the `releaseURL` as the button when it is an `https` URL.
- Any other event (including `webhook.test`): a generic line with the event name.
No post text, media, ids or actor identifiers are placed in the message (privacy: the channel may have members who are not PostSider users). The buttons are plain URL buttons to login-gated pages, so no token is ever pasted into a Slack channel and approval identity stays the dashboard session (item 2's model, no shortcut).

R4.3 Safety: Slack answers non-200 with a text body (`invalid_payload`, `no_service`); `lastError` records `HTTP <status>` only. A redaction step guarantees that `lastError` and logs never contain the target URL (the Slack URL is itself a secret): `String(error)` is passed through a function that replaces any substring of the URL with `[url]`. The Slack webhook URL is not returned by the subscription list beyond what the existing API already returns (unchanged) and is not logged.

### R5 Workspace (customer) provisioning API

Small and honest: the codebase's workspace concept is `Customer` (a named group of channels in an organization). New public routes in `PublicCustomersController` (`/public/v1`), all requiring an ADMIN or SUPERADMIN caller (`assertAdmin` pattern):
- `GET /customers` (scope `channels:read`): `[{ id, name, channelCount, createdAt }]`, live customers only. `GET /groups` is unchanged.
- `POST /customers` `{ name }` (scope `channels:write`): trims, 1 to 100 characters, no control characters; creates the customer or returns the existing live one with the same name (HTTP 200, `created: false`; 201 with `created: true` otherwise); at most 200 live customers per organization (400 `customer_limit_reached`).
- `PUT /customers/:id` `{ name }` (scope `channels:write`): rename; 409 `customer_name_taken` when another live customer has the name; 404 for foreign or archived ids.
- `POST /customers/:id/archive` (scope `channels:write`): sets `deletedAt`, disconnects the customer's channels (their `customerId` becomes null; channels, posts and tokens are untouched), returns `{ id, archived: true, detachedChannels: n }`. Archiving twice returns 404. Idempotent from a client's point of view via `Idempotency-Key` on create only.
- `PUT /integrations/:id/customer` additionally accepts `{ customerId }` (a live customer of the organization, 404 otherwise); `{ name }` keeps its current meaning. Exactly one of the two, or neither to unassign.
Open question and scope cut: creating organizations, inviting members and connecting a channel without a human OAuth step need product decisions (billing seats, tenant isolation, consent); ruling Q9 records the smallest slice above and that these stay out. No MCP tool is added for provisioning (ruling Q9), the n8n node and Zapier scaffold use it.

### R6 Make and Zapier minimum

Webhooks and the REST API already carry what both need; Phase 5 adds only:
- `GET /public/v1/approvals` (R1.2) as the polling endpoint for "new approval request" and "approval decided" triggers (`status` and `since` filters, stable newest first order).
- `docs/automation/make.md` (HTTP module recipes with the `Authorization` header, a Custom webhook scenario, the signature verification formula, retries and dedupe by `X-Postsider-Event-Id`) and `docs/automation/zapier.md`.
- `examples/automation/zapier/`: a Zapier CLI app scaffold (`package.json`, `index.js`, `authentication.js`, triggers `approval_requested` and `approval_decided` as REST hook triggers using `POST /webhook-subscriptions` and `DELETE /webhook-subscriptions/:id` with a polling fallback on `GET /approvals`, creates `request_approval`, `decide_approval`, `create_draft`, sample data from `GET /webhook-subscriptions/events`), plus pure mapping modules with `node:test` specs that run without the Zapier SDK. It is a scaffold: `zapier validate` and submission are owner actions.
- Nothing is published or submitted. The Make section is documentation only (ruling Q10).

### R7 n8n node

In the separate repository `n8n-nodes-postsider` (branch `feat/approvals-policies-groups`, not pushed):
- Approval resource: `Request` (`POST /posts/{id}/request-approval`), `Get Status` (exists), `Get Many` (`GET /approvals` with status, since, limit), `Approve` and `Reject` (`POST /approvals/{id}/approve|reject`, note, header `Idempotency-Key: n8n:<executionId>:item:<index>`).
- New Policy resource: `Check` (`POST /policies/evaluate`; fields type, channel ids and content; this is the dry run, so it needs only `posts:read`), `Get Many Rules` (`GET /policies`, needs `policies:read`).
- Group resource gains `Create`, `Rename`, `Archive` (R5 routes).
- Package: version `0.2.0`, `CHANGELOG.md` entry, README operations and required scopes table (approve and reject need `approvals:decide`, never granted by default), unit tests for every new request builder and payload, an example workflow `examples/approval-notify-slack.json` (Webhook node + HMAC verification Code node + IF + the node's Approve/Reject) listed by `test/examples.test.ts`, `npm run verify` green. No change to `.github/workflows/publish.yml`. Publishing (tag `0.2.0`, `NPM_DIST_TAG`, `NPM_TOKEN`) is an owner action.
- The node keeps working against older PostSider servers for the operations that existed.

### R8 Frontend

- `/approve/[token]` page (public, no dashboard shell): loads the review data, shows content and media as text/images, stage, "You are deciding as <name>", a note field for reject, two buttons (the `?intent=` query only emphasizes one), disabled with a reason when `selfApprovalBlocked`, result and error states for each error code of R2.2. Black and white, Apple-minimal, existing CSS variables, no new color; works at 375 px.
- `/approval` (dashboard): shows stage progress per pending item ("Stage 2 of 3: Owner"), disables Approve/Reject with the reason when the signed-in member cannot decide the current stage, and no longer relies on any guest field. The guest link button is hidden when the stage does not allow guests.
- `/settings/approval-flows` (admin): list, create/edit modal (name, default switch, two flags, 1 to 5 stages with name, minimum role, optional approver members, automation and guest toggles), archive with the `flow_in_use` message.
- Policy rule form: an "Approval flow" select shown only when the effect is Require approval.
- API key dialogs: `approvals:decide` in the scope list with a short warning line.
- New i18n namespaces `approverLink` and `approvalFlows` in `en.ts` and `pl.ts` (other nine locales fall back to English, as in Phase 4); the few keys added to the existing `approval` namespace for stage labels go to `en.ts` and `pl.ts` too (ruling Q11). No U+2013 or U+2014 anywhere.

### R9 Tests and verification

Backend: unit specs beside the code and HTTP specs for every route, run with the root Jest config. Migration verified on the throwaway Postgres (`prisma validate`, `migrate deploy`, `migrate diff --exit-code`, plus a data check that old guest tokens still resolve by hash). Frontend: pure specs under `apps/frontend/src/lib/*.spec.ts` and `tsc`; a Playwright script update for the new pages if the existing script setup is present (skips when Playwright is missing, as Phase 4). MCP: inventory and stdio specs updated. n8n: `npm run verify` in its repo. Full verification in Task 16 repeats the Phase 4 final run plus the new suites.

### R10 Docs

README sections "Approvals" (stages, flows, links, API deciding), "Slack, Make and Zapier", env table additions (`APPROVAL_EMAIL_LINKS`, `APPROVAL_LINK_TTL_HOURS`, `POSTSIDER_MCP_ALLOW_APPROVAL_DECISIONS`); `docs/API-MCP-TRUST.md` updates (new scope, never default; the `guestToken` fix and the hashing migration; approver link threat model; self-approval rules; fix the stale "19 tools" count while there); `docs/automation/make.md`, `docs/automation/zapier.md`; `apps/mcp/README.md` and `CHANGELOG.md`; `.env.example`. No em or en dashes.

## 5. Compatibility and rollout

- One additive migration. Deploy order: `prisma migrate deploy`, backend, frontend (a new frontend against an old backend shows the new pages' error banner; an old frontend against a new backend is unaffected because every response only gains keys, and the removed `guestToken` fields were never read by the frontend).
- The migration nulls `guestToken` after copying its hash. Outstanding guest links keep working through the hash. Rolling the application back after the migration makes existing guest links answer "invalid" (safe), never leaks.
- Behaviour changes to announce: members no longer receive `guestToken` etc. from `/approval/pending`; `LEGACY_PUBLIC_API_SCOPES` is unchanged, so existing keys cannot decide (the new scope is explicit); rules without a flow and orgs without a default flow behave exactly as before (single implicit stage).
- `APPROVAL_EMAIL_LINKS` unset keeps today's plain emails.
- MCP `server.json` and package versions are not bumped here (owner release step, together with the existing 1.2.0 plan).

## 6. Risks and known residual issues

- Email links are bearer credentials for up to the TTL; forwarding or a compromised mailbox lets someone decide as that member. Mitigations: opt-in, 48 hour default, single use, two step with a challenge, self-approval rules, re-check of membership and role, rate limits. A login-required variant is a later option (ruling Q2).
- The email HTML (and the token inside it) is part of Temporal workflow history for the retention period of the Temporal namespace. Tokens are single use and expire, so a stale history entry is inert; operators who cannot accept that leave `APPROVAL_EMAIL_LINKS` off.
- An automation key that is granted `approvals:decide` and is not the creator can approve other agents' posts. That is the point of the scope, it is never default, it is audited with the key id, and R1.3 blocks self-approval.
- Stage notifications for a stage whose eligible set is empty (all listed members removed or disabled) would deadlock the approval; the flow validator checks members at save time and the service falls back to "any ADMIN or SUPERADMIN" for notification text only, while deciding still follows the stage rules, so a SUPERADMIN can always unblock (R3.2 bypass).
- A flow archived after an approval started does not affect it (snapshot). A flow edited after is not reflected in in-flight approvals by design.
- `Customer` name uniqueness is `@@unique([orgId, name, deletedAt])`, which PostgreSQL does not enforce for `deletedAt IS NULL`; the service therefore checks names itself and two concurrent creates can still race. Acceptable at the 200 customer cap; documented.
- Slack: a message cannot be recalled when a stage is later decided elsewhere; the text says "waiting for approval" at send time only.
- The MCP decide tool relies on the model honouring its description. The server-side protections (scope, no self-approval, key limits, opt-in env) are what hold.

## 7. Open questions

All answered in `docs/superpowers/plans/2026-11-05-control-plane-phase5-controller-rulings.md` (Q1 to Q20). Summary of the ones that most affect reviewers: email links default off (Q1); no-login links accepted with the documented trade-off (Q2); automation self-approval always blocked, human self-approval only when the flow says so (Q3); SUPERADMIN bypasses approver lists (Q5); no stage webhook event (Q6); Slack is notify-only (Q7); flows are governed by `policies:*` scopes (Q8); provisioning is customers only (Q9).
