# Control Plane Phase 5: Approvals and distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let API keys and the local MCP server approve or reject (scope-gated, never default), let approvers decide from signed single-use email links without logging in, support multi-stage approvals chosen by policy rules, notify Slack through the webhook outbox, add a small customer provisioning API, give Make and Zapier a starting point, extend the n8n node, and close the `guestToken` exposure bug with hashed storage.

**Architecture:** One migration adds approval flows, per-approval stage snapshots, link tokens and decision attribution columns. A pure stage-rules module and a single `ApprovalService.decide` engine serve every path (dashboard, bulk, public API, email link, guest link), so identity, self-approval and the "APPROVED means all stages approved" invariant live in one place. New thin controllers (public approvals, approval flows, customers, approver links) front the services. Slack is a payload formatter inside the existing webhook delivery. Integrations (MCP tool, n8n node, Zapier scaffold) consume the frozen contract in the spec. The frontend adds a public approver page, stage-aware approval UI and a flows settings page.

**Tech Stack:** NestJS, Prisma 6.5.0 (PostgreSQL), Jest 29 + ts-jest, class-validator; Next 15 / React 19 (CSS modules + inline styles, no Tailwind); n8n community node (TypeScript, `tsx --test`); MCP SDK server in `apps/mcp`.

**Spec:** `docs/superpowers/specs/2026-11-05-control-plane-phase5-approvals-distribution.md` (read first: verified facts, exact shapes, error codes). **Rulings:** `docs/superpowers/plans/2026-11-05-control-plane-phase5-controller-rulings.md` (binding; Q numbers are cited below).

## Global Constraints

Every task implicitly includes these.

- Git binary: `/Library/Developer/CommandLineTools/usr/bin/git` (`/usr/bin/git` exits 69 on this host). In commands below `GIT` means that path. Work only in the worktree `postsider-wt-control-plane-p5` on branch `feat/control-plane-p5-approvals-distribution`. Exception: Task 12 commits in the separate repository `PostSider _Project/n8n-nodes-postsider` (its own `.git`, branch `feat/approvals-policies-groups`). Never push, never force, never `git stash` without a unique tag, never publish (no `npm publish`, no tags, no Zapier or Make submission).
- Commit trailer on every commit message: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prisma: the only schema change is Task 1's migration (`libraries/nestjs-libraries/src/database/prisma/migrations/20261105100000_control_plane_approvals_distribution/migration.sql`), shipped as a migration file. Never `db push`. Schema path: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (`SCHEMA` below).
- No em dashes or en dashes (U+2013, U+2014) in any added line: copy, API messages, docs, comments, i18n values. Use `-`, a colon or rewrite.
- Exact names. Scope: `approvals:decide`. Env: `APPROVAL_EMAIL_LINKS`, `APPROVAL_LINK_TTL_HOURS`, `POSTSIDER_MCP_ALLOW_APPROVAL_DECISIONS`. Routes: public `/public/v1/approvals` (`/:id`, `/:id/approve`, `/:id/reject`), `/public/v1/approval-flows`, `/public/v1/customers` (`/:id`, `/:id/archive`); dashboard `/approval-flows`; unauthenticated `/public/approver-links/:token` (GET) and `/public/approver-links/:token/decision` (POST); frontend `/approve/[token]`, `/settings/approval-flows`. Error codes: `link_invalid`, `link_not_allowed`, `self_approval_blocked`, `approval_already_resolved`, `flow_in_use`, `approval_flow_invalid`, `guest_not_allowed_for_stage`, `customer_limit_reached`, `customer_name_taken`. Decision `via` values: `DASHBOARD API EMAIL_LINK GUEST BULK`. Limits: flow 1 to 5 stages, 20 live flows per org, stage name 80, flow name 120, approver list 20, note 500, customers 200 per org, link TTL 1 to 168 hours (default 48), challenge age 2 s to 15 min, 5 failed link attempts revoke a token.
- Invariant (never break): `PostApproval.status` is `APPROVED` only after the LAST stage is approved. `ApprovalService.getForPost(...).status === 'APPROVED'` (used by `PostPolicyGateService` and `PublishPolicyGuard`) must keep meaning "all stages approved". Do not edit `post-policy-gate.service.ts` or `publish-policy.guard.ts` except the call-site argument change in Task 6.
- Security rules: never return `guestToken`, `guestTokenHash`, `guestTokenExpiresAt`, `requestedById`, token plaintext or token hashes from any route; every DB query on tenant data includes `organizationId` (the link routes resolve the organization from the token row, never from the request); foreign or unknown ids answer like unknown ones (404 or `link_invalid`), never 403 and never data; tokens, challenges, Slack URLs and API keys never appear in logs or error text.
- Scope fence: no edit of `post.workflow.v1.0.*.ts`, `publicApiRetentionWorkflow`, providers, billing. Existing public routes, scopes, MCP tool names and webhook event names do not change; responses only gain keys.
- Conventions: imports in libraries and backend use `@postsider/*` aliases; new optional dependencies use a trailing `@Optional() private _x?: T`; Prisma access goes through `PrismaRepository<'model'>` and transactions through `PrismaTransaction`; pure modules import nothing from Nest, Prisma or React; DTOs follow the repo's class-validator style (the global ValidationPipe does not whitelist, so controllers pick known fields explicitly, see `RULE_FIELDS` in `public.policies.controller.ts`).
- Test commands (run from the worktree root): backend and pure specs `pnpm exec jest -c jest.config.ts <path> --coverage=false`; specs that import code touching `isomorphic-dompurify` start with `jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));`. Frontend specs are pure `.ts` files in `apps/frontend/src/lib` with RELATIVE imports only. Frontend typecheck: `pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json`. Backend build: `pnpm run build:backend`. MCP: `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --runInBand`.
- Brand and frontend conventions (Tasks 14, 15): black and white, Apple-minimal, color only inside `PlatformIcon`, status by label plus shape/weight, existing CSS variables only; reuse `ConfirmDialog`, `EmptyState`, `PlatformIcon`, settings `Card`/`PageHeader`/`Switch`; data loading with `useEffect` + `useState` + a cancellation flag; text from `useT()`; the frontend calls only the dashboard API except the two unauthenticated `/public/approver-links` routes.

## Preconditions (run before Task 1)

```
GIT log --oneline -1                      # must show 5189e53 or a descendant containing Phases 1 to 4
grep -n "approvals:write" libraries/nestjs-libraries/src/services/public-api-scopes.ts
grep -n "class ApprovalService" libraries/nestjs-libraries/src/database/prisma/approval/approval.service.ts
grep -n "class PolicyApprovalRouter" libraries/nestjs-libraries/src/database/prisma/policies/policy-approval-router.ts
grep -n "class PublicApiIdempotencyService" libraries/nestjs-libraries/src/database/prisma/idempotency/public-api-idempotency.service.ts
grep -n "class PublicWebhookDeliveryService" libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-delivery.service.ts
grep -n "AuthRateLimitGuard" apps/backend/src/api/routes/public.controller.ts
grep -n "class PrismaTransaction" libraries/nestjs-libraries/src/database/prisma/prisma.service.ts
grep -n "getUserOrgLink" libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository.ts
grep -n "allowLocalFiles" apps/mcp/src/server.ts
pg_isready -h localhost -p 55432          # throwaway Postgres, see the migration section
```
Every line must print a match. Dependencies must be installed: `until grep -q Done /private/tmp/claude-501/p5-install.log; do sleep 5; done`.

## Dependency table (for the controller)

| Task | Depends on | Tag | Parallel group | Shared files to watch |
|---|---|---|---|---|
| 1 Schema and migration | none | SEQUENTIAL FIRST | wave 0 | `schema.prisma` |
| 2 Scope and pure stage rules | none | INDEPENDENT | wave 0 | `public-api-scopes.ts`, new pure files |
| 9 Slack webhook format | none | INDEPENDENT | wave 0 | `public-webhook-delivery.service.ts`, new `slack-message.ts` |
| 10 Customer provisioning API | none | INDEPENDENT | wave 0 | `integration.repository.ts`, `public.api.module.ts`, `database.module.ts` |
| 12 n8n node (separate repo) | none (uses the spec contract) | INDEPENDENT | wave 0 | other repository |
| 13 Make and Zapier assets | none (uses the spec contract) | INDEPENDENT | wave 0 | `docs/automation/`, `examples/automation/` |
| 3 `guestToken` fix and hashed lookups | 1 | SEQUENTIAL | wave 1 | `approval.repository.ts`, `approval.projection.ts`, `approval.controller.ts` |
| 4 Approval flows service and API | 1, 2 | INDEPENDENT of 3 | wave 1 | `database.module.ts`, `api.module.ts`, `public.api.module.ts` |
| 5 Multi-stage `ApprovalService` core | 1, 2, 3, 4 | SEQUENTIAL | wave 2 | `approval.service.ts`, `approval.repository.ts` |
| 6 Policy rules link to flows | 4, 5 | INDEPENDENT of 7, 8 | wave 3 | `policies/*` |
| 7 Public approvals API | 2, 5 | INDEPENDENT of 6, 8 | wave 3 | new controller, `public.api.module.ts` |
| 8 Email approver links | 5 | INDEPENDENT of 6, 7 | wave 3 | new service, `public.controller.ts`, one hook in `approval.service.ts` |
| 11 MCP decide tool | 7 | INDEPENDENT of 14, 15 | wave 4 | `apps/mcp/*` |
| 14 Frontend: approver link page | 8 contract | INDEPENDENT of 11, 15 | wave 4 | `en.ts`, `pl.ts` (append) |
| 15 Frontend: stages, flows, key scope | 4, 5, 6 contracts | INDEPENDENT of 11, 14 | wave 4 | `en.ts`, `pl.ts` (append), `settings-shell.tsx` |
| 16 Docs and final verification | all | SEQUENTIAL LAST | wave 5 | README, docs |

Wave 0 (Tasks 1, 2, 9, 10, 12, 13) may run as parallel implementers because their files are disjoint; Tasks 12 and 13 can also run alongside any later wave because they code against the spec's frozen contract and only need the real server for an optional manual check at the end. `database.module.ts`, `public.api.module.ts`, `api.module.ts`, `en.ts` and `pl.ts` are append-only shared files: the controller resolves trivial merge conflicts and re-runs the owning task's tests.

## Review Focus

The failure modes a person is most likely to hit. Each has a test in the owning task.

1. The leak is closed: for a USER-role member, `GET /approval/pending`, `GET /approval/post/:postId` and the request response contain no `guestToken*`, `requestedById`, `approverId`; an old guest token (migrated by hash) still resolves exactly once; the plaintext column is NULL after the migration (Tasks 1, 3).
2. `APPROVED` means all stages: after stage 1 of 2 the post is still APPROVAL, `getForPost` says `PENDING`, nothing was scheduled, no `approval.resolved` webhook; after stage 2 the post is scheduled once; a failing schedule reverts the last stage only (Task 5).
3. Self-approval and distinct approvers: automation can never decide what it created or requested; a flow with `preventSelfApproval` refuses the creator; one actor cannot decide two stages; the implicit stage keeps solo-owner behaviour; guests never count as members (Tasks 2, 5, 7, 8).
4. Link safety: GET never mutates; a decision without a valid challenge, with a challenge younger than 2 s, older than 15 min, or minted for another token, fails; single use under a race (two parallel POSTs, one wins); all invalid states answer the same 404 body; five failed attempts revoke; no token or challenge in logs (Task 8).
5. Concurrency: two admins deciding the same stage, or a dashboard click racing an API call, produce one decision and one `changed: false` or 409, never two schedulings (Tasks 5, 7).
6. Scope hygiene: `approvals:decide` is absent from `LEGACY_PUBLIC_API_SCOPES` and from every OAuth grant mapping; a key with only `approvals:write` gets 403 on approve; a Draft-only key cannot approve (Tasks 2, 7).
7. Compatibility: no existing field removed; orgs with no flows and no env flags behave exactly as before (single implicit stage, plain emails, no Slack formatting); the four webhook event names and eleven audit types are unchanged (Tasks 5, 8, 9).
8. Slack: the Slack URL never appears in `lastError`, logs or responses; no post content in the message; special characters are escaped (Task 9).

## File Structure

New files (backend, `libraries/nestjs-libraries/src` unless noted):
- `database/prisma/migrations/20261105100000_control_plane_approvals_distribution/migration.sql`, `database/prisma/schema.control-plane-approvals.spec.ts`.
- `database/prisma/approval/approval-stage.rules.ts`, `approval-flow.service.ts`, `approval-flow.repository.ts`, `approval-link.service.ts`, `approval-link.template.ts`, `approval-link.crypto.ts`, `guest-token.ts` (+ `.spec.ts` each).
- `dtos/approval/approval-flow.dto.ts`, `public-approval.dto.ts`, `approver-link.dto.ts` (+ specs).
- `services/slack-message.ts` (+ spec), `database/prisma/webhooks/redact-url.ts` (+ spec).
- `dtos/customers/customer.dto.ts`, `database/prisma/integrations/customer.service.ts` (+ specs).
- `apps/backend/src`: `api/routes/approval-flows.controller.ts`, `public-api/routes/v1/public.approvals.controller.ts`, `public.customers.controller.ts`, `api/routes/public.controller.approver-links.spec.ts` (+ http specs).
- `apps/mcp/src/__tests__/decide-approval.spec.ts`.
- Frontend `apps/frontend/src`: `app/approve/[token]/page.tsx`, `components/approver-link-view.tsx`, `lib/approver-link-api.ts`, `lib/approver-link-model.ts`, `app/settings/approval-flows/page.tsx`, `components/approval-flows/flow-form.tsx`, `lib/approval-flows-api.ts`, `lib/approval-flows-model.ts`, `lib/approval-stage-model.ts` (+ `.spec.ts` for each lib file), `lib/approval-i18n.spec.ts`.
- Automation: `docs/automation/make.md`, `docs/automation/zapier.md`, `examples/automation/zapier/*`.
- n8n repository: see Task 12.

Modified (main ones): `schema.prisma`, `database.module.ts`, `api.module.ts`, `public.api.module.ts`, `public-api-scopes.ts`, `public-api-oauth-scopes.ts`, `approval.service.ts`, `approval.repository.ts`, `approval.projection.ts`, `approval.controller.ts`, `public.controller.ts`, `public-webhook-delivery.service.ts`, `public-webhook-events.ts`, `policy-approval-router.ts`, `post-policy-gate.service.ts` (call sites only), `publish-policy.guard.ts` (call site only), `policy-rule.dto.ts`, `public-policy.dto.ts`, `policy-rules.service.ts`, `agent-activity.view.ts` (allow-list), `integration.repository.ts`, `public.workspace.controller.ts`, `notification.service.ts` (no change expected, only called), `apps/mcp/src/server.ts`, `tool-inventory.ts`, `stdio.spec.ts`, `index.ts`, frontend `approval/page.tsx`, `lib/approval-api.ts`, `settings-shell.tsx`, `policy-rule-form.tsx`, `settings/api/page.tsx`, `lib/i18n/messages/en.ts` and `pl.ts`, `.env.example`, `README.md`, `docs/API-MCP-TRUST.md`.

## Validating the Prisma migration without production

The throwaway Postgres on port 55432 database `ps_cp` is migrated through Phase 4 (33 migrations). If it is gone, recreate it: `initdb --locale=C -U postgres -D <dir>`, `LC_ALL=en_US.UTF-8 pg_ctl -D <dir> -o "-p 55432 -k /tmp/pgsock55432" -l <dir>.log start`, `createdb -h localhost -p 55432 -U postgres ps_cp`, then `DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp pnpm exec prisma migrate deploy --schema $SCHEMA`.
1. `DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp pnpm exec prisma validate --schema $SCHEMA` must print `is valid`.
2. `pnpm exec prisma migrate deploy --schema $SCHEMA` applies only the new migration; `prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel $SCHEMA --exit-code` must exit 0.
3. `pnpm exec prisma generate --schema $SCHEMA`.

---

### Task 1: Schema and migration (flows, stage snapshots, tokens, attribution, hashed guest token)

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (`model PostApproval` ~1261, `model PolicyRule` ~1119, `model Organization` relations list)
- Create: `.../migrations/20261105100000_control_plane_approvals_distribution/migration.sql`
- Test: `libraries/nestjs-libraries/src/database/prisma/schema.control-plane-approvals.spec.ts`

**Interfaces:**
- Produces models/columns exactly as spec R3.1: `ApprovalFlow`, `ApprovalFlowStage` (`minRole Role`), `PostApprovalStage`, `ApprovalActionToken`; `PolicyRule.approvalFlowId String?` (FK `ApprovalFlow`, `onDelete: SetNull`); `PostApproval.flowId`, `currentStage Int @default(1)`, `stageCount Int @default(1)`, `decidedVia String? @db.VarChar(20)`, `decidedByApiKeyId`, `decidedByOAuthClientId`, `guestTokenHash String? @unique`. Relations: `Organization.approvalFlows`, `ApprovalFlow.stages/rules`, `PostApproval.stages`.
- Migration SQL: plain DDL for the above, then the backfill `UPDATE "PostApproval" SET "guestTokenHash" = encode(sha256(convert_to("guestToken", 'UTF8')), 'hex') WHERE "guestToken" IS NOT NULL;` then `UPDATE "PostApproval" SET "guestToken" = NULL WHERE "guestToken" IS NOT NULL;`. No other data rewrite. `sha256(bytea)` is built in from PostgreSQL 11.

- [ ] **Step 1: Write the failing test.** The spec reads `schema.prisma` and `migration.sql` as text and asserts: the four models and every column above exist; `PostApprovalStage` has `@@unique([approvalId, position])`; `ApprovalFlowStage` has `@@unique([flowId, position])`; `ApprovalActionToken.tokenHash` is `@unique`; `migration.sql` contains the two `UPDATE` statements in this order (hash before null) and contains no `DROP COLUMN`, no `DROP TABLE`, no `DELETE`.
- [ ] **Step 2: Run it to verify it fails.** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/schema.control-plane-approvals.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Edit `schema.prisma`, then generate the SQL** with `prisma migrate diff --from-migrations libraries/nestjs-libraries/src/database/prisma/migrations --to-schema-datamodel $SCHEMA --shadow-database-url <a scratch database on port 55432> --script` into the new migration file, and append the backfill statements by hand.
- [ ] **Step 4: Data check on the throwaway database.** Before `migrate deploy`, insert one fake `PostApproval` with `guestToken = 'abc123token'` (disable FKs with `SET session_replication_role = replica;` in that session), run `migrate deploy`, and verify with psql: `guestToken IS NULL` and `"guestTokenHash" = encode(sha256('abc123token'::bytea),'hex')`. Delete the fake row. Then run the validate/diff/generate commands of the migration section. Expected: valid, no drift, exit 0.
- [ ] **Step 5: Re-run Step 2.** Expected: PASS.
- [ ] **Step 6: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/schema.prisma libraries/nestjs-libraries/src/database/prisma/migrations/20261105100000_control_plane_approvals_distribution libraries/nestjs-libraries/src/database/prisma/schema.control-plane-approvals.spec.ts
GIT commit -m "feat(db): approval flows, stage snapshots, link tokens and hashed guest tokens"
```

---

### Task 2: `approvals:decide` scope and pure stage rules (TDD)

**Files:**
- Modify: `libraries/nestjs-libraries/src/services/public-api-scopes.ts`, `libraries/nestjs-libraries/src/services/public-api-oauth-scopes.ts`
- Create: `libraries/nestjs-libraries/src/services/public-api-scopes.approvals-decide.spec.ts`, `libraries/nestjs-libraries/src/database/prisma/approval/approval-stage.rules.ts` (+ `.spec.ts`)

**Interfaces:**
- Scope: append `'approvals:decide'` to `PUBLIC_API_SCOPES` after `'policies:write'`. In `public-api-oauth-scopes.ts` extend the `LEGACY_PUBLIC_API_SCOPES` filter with `&& scope !== 'approvals:decide'`. `grantedScopesForOAuth` is not changed (it only adds named scopes), but the spec proves it never yields the new scope.
- Produces `approval-stage.rules.ts` (imports only types from `actor/post-actor`):
```ts
export type StageDef = { position: number; name: string; minRole: 'ADMIN' | 'SUPERADMIN'; approverUserIds: string[]; allowAutomation: boolean; allowGuest: boolean };
export type FlowRules = { preventSelfApproval: boolean; requireDistinctApprovers: boolean };
export const IMPLICIT_STAGE: StageDef;       // position 1, name 'Approval', ADMIN, [], allowAutomation true, allowGuest true
export const IMPLICIT_RULES: FlowRules;      // both false
export type Decider =
  | { kind: 'member'; userId: string; role: 'USER' | 'ADMIN' | 'SUPERADMIN'; disabled?: boolean }
  | { kind: 'automation'; actor: Extract<PostActor, { type: 'API_KEY' | 'OAUTH_CLIENT' }> }
  | { kind: 'guest' };
export type Origin = { createdBy: ActorView | null; requestedBy: ActorView | null; earlierDeciders: ActorView[] };
export type StageVerdict = { ok: true } | { ok: false; reason: 'role' | 'not_listed' | 'disabled' | 'automation_not_allowed' | 'guest_not_allowed' | 'self_approval' | 'not_distinct' };
export function canDecideStage(stage: StageDef, rules: FlowRules, decider: Decider, origin: Origin): StageVerdict;
export function sameActor(a: ActorView | null | undefined, b: ActorView | null | undefined): boolean; // compares type plus the matching id; a legacy key (apiKeyId missing) equals another legacy key; null equals nothing
export function eligibleMemberIds(stage: StageDef, members: Array<{ userId: string; role: string; disabled?: boolean }>): string[]; // for notifications: humans who pass role/list/disabled (SUPERADMIN ignores the list)
export function nextStage(current: number, total: number): { final: boolean; next: number };
```
- Rules (R3.2 and Q3 to Q5): USER role never decides; `disabled` member refused; SUPERADMIN satisfies `minRole` ADMIN and bypasses `approverUserIds` but not self/distinct; automation needs `stage.allowAutomation` and is always refused when `sameActor(decider, createdBy|requestedBy)`; humans are refused for self-approval only when `rules.preventSelfApproval` and their `userId` equals the `userId` of `createdBy` or `requestedBy` (an OAuth actor's `userId` counts); `requireDistinctApprovers` refuses an actor present in `earlierDeciders`; guests need `allowGuest` and skip self/distinct checks.

- [ ] **Step 1: Write the failing tests.** Scope spec: `PUBLIC_API_SCOPES` contains the new scope after `policies:write`; `LEGACY_PUBLIC_API_SCOPES` does not; `grantedScopesForOAuth(['posts:read','posts:write','channels:write'])`, `(['approvals:decide'])` and `(undefined)` do not contain it; `plainToInstance(CreateApiKeyDto, { name: 'n', scopes: ['approvals:decide'] })` validates (copy `public-api-scopes.policies.spec.ts`). Rules spec: a table covering every `reason`, USER role, SUPERADMIN bypass of the list, SUPERADMIN still blocked by self-approval, a legacy key equals another legacy key, an OAuth actor with `userId` equal to the creator is self, automation refused when it created the post even with `allowAutomation`, guest allowed only with `allowGuest`, `eligibleMemberIds` drops disabled/USER/unlisted, `nextStage(2,2)` is final.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/services/public-api-scopes.approvals-decide.spec.ts libraries/nestjs-libraries/src/database/prisma/approval/approval-stage.rules.spec.ts libraries/nestjs-libraries/src/services/public-api-scopes.audit.spec.ts libraries/nestjs-libraries/src/services/public-api-scopes.policies.spec.ts --coverage=false`. Expected: FAIL (new specs), existing two PASS.
- [ ] **Step 3: Implement** the scope edits and the pure module.
- [ ] **Step 4: Re-run the Step 2 command.** Expected: all PASS. Also run `pnpm exec jest -c jest.config.ts apps/backend/src/services/auth --coverage=false` (auth middleware scope specs must still pass).
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/services libraries/nestjs-libraries/src/database/prisma/approval/approval-stage.rules.ts libraries/nestjs-libraries/src/database/prisma/approval/approval-stage.rules.spec.ts
GIT commit -m "feat(approvals): approvals:decide scope (never default) and pure stage eligibility rules"
```

---

### Task 3: `guestToken` fix: safe projection and hashed lookups

**Files:**
- Modify: `.../approval/approval.projection.ts`, `approval.repository.ts`, `approval.service.ts` (guest methods only), `apps/backend/src/api/routes/approval.controller.ts`, `apps/frontend/src/lib/approval-api.ts` (types only)
- Create: `.../approval/guest-token.ts` (+ spec), specs `approval.projection.dashboard.spec.ts`, `approval.repository.guest.spec.ts`, `apps/backend/src/api/routes/approval.controller.http.spec.ts`

**Interfaces:**
- `guest-token.ts`: `hashGuestToken(token: string): string` (sha256 hex of the UTF-8 token), `newGuestToken(): string` (24 random bytes base64url, as today).
- `toDashboardApproval(row, opts: { isAdmin: boolean }): DashboardApproval` in `approval.projection.ts`: picks `id, postId, status, note, requestedAt, resolvedAt, requestedBy {name,email}` (when present), `post` (when present), `stage` and `stages` (defaults `null`/`[]` until Task 5 fills them), `hasGuestLink: boolean` and `guestLinkExpiresAt` (admin only, derived from `guestTokenHash`/`guestTokenExpiresAt` being set and unexpired); never copies any other column.
- Repository: `getByGuestToken(token)` and `resolveByGuestToken`, `revertGuestApproval`, `setGuestToken` use `guestTokenHash` (the hash of the presented or new token; `setGuestToken(orgId, id, tokenHash, expiresAt)`); `revertGuestApproval` receives the hash. `getPending` keeps its shape but the controller maps it. The service computes hashes; the plaintext token is returned only by `createGuestLink`.
- Controller: `pending`, `forPost` and `request` return `toDashboardApproval(...)`; `isAdmin` from `roleOf(org)`.

- [ ] **Step 1: Write the failing tests.** Projection spec: a full DB-shaped row containing `guestToken`, `guestTokenHash`, `guestTokenExpiresAt`, `requestedById`, `approverId`, `guestEmail` yields an object whose `JSON.stringify` contains none of those key names or values, for `isAdmin` true and false; `hasGuestLink` true only for admins with an unexpired hash. Repository spec (mock Prisma): lookups query `guestTokenHash` equal to `hashGuestToken(token)` and never `guestToken`; `setGuestToken` writes the hash and sets `guestToken: null`. Service spec: `createGuestLink` returns a token whose hash equals what was stored; a token created by the OLD code path (hash computed from a plaintext) resolves via the same hash function (migration compatibility); `resolveGuestReview` still consumes once. Controller http spec (supertest with the controller and a service stub that returns a raw row with `guestToken`): `GET /approval/pending` and `GET /approval/post/x` as a USER role contain no token-like keys; as ADMIN contain `hasGuestLink` but still no token.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/approval apps/backend/src/api/routes/approval.controller.http.spec.ts apps/backend/src/api/routes/public.controller.guest.spec.ts --coverage=false`. Expected: new specs FAIL; the existing approval specs may need their guest fixtures moved to `guestTokenHash`: update them in this task.
- [ ] **Step 3: Implement.** Do not touch `approve/reject/requestApproval` yet (Task 5).
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm run build:backend`. Expected: PASS, exit 0. Run the Playwright-free frontend typecheck: `pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json`.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/approval apps/backend/src/api/routes apps/frontend/src/lib/approval-api.ts
GIT commit -m "fix(approvals): never expose guestToken to members; store guest tokens hashed"
```

---

### Task 4: Approval flows: repository, service, dashboard and public API

**Files:**
- Create: `.../approval/approval-flow.repository.ts`, `approval-flow.service.ts` (+ specs), `libraries/nestjs-libraries/src/dtos/approval/approval-flow.dto.ts` (+ spec), `apps/backend/src/api/routes/approval-flows.controller.ts` (+ `.http.spec.ts`), `apps/backend/src/public-api/routes/v1/public.approval-flows.controller.ts` (+ `.http.spec.ts`)
- Modify: `database.module.ts`, `apps/backend/src/api/api.module.ts` (authenticatedController), `apps/backend/src/public-api/public.api.module.ts`

**Interfaces:**
- DTOs: `ApprovalFlowStageDto { name (1..80), minRole: 'ADMIN'|'SUPERADMIN', approverUserIds?: string[] (<=20, distinct), allowAutomation?: boolean, allowGuest?: boolean }`; `CreateApprovalFlowDto { name (1..120), isDefault?: boolean, preventSelfApproval?: boolean, requireDistinctApprovers?: boolean, stages: ApprovalFlowStageDto[] (1..5, ValidateNested) }`; `UpdateApprovalFlowDto` = all optional (a supplied `stages` array replaces the list).
- Service `ApprovalFlowService(repo, OrganizationRepository)`: `list(orgId)`, `get(orgId, id)`, `create(orgId, dto)`, `update(orgId, id, dto)`, `archive(orgId, id)`, `getDefault(orgId): Promise<FlowWithStages | null>`, `getById(orgId, id)`, `resolveFlowForRules(orgId, ruleIds: string[]): Promise<FlowWithStages | null>` (flow of the first rule id, in the given order, whose rule has a live `approvalFlowId`; else the org default; else null), `snapshot(flow): { flowId, stageCount, stages: StageDef[], rules: FlowRules }` pure helper.
- Rules: positions are assigned from array order; every `approverUserIds` entry must be a member of the organization (`getAllUsersOrgs`), else 400 `approval_flow_invalid`; at most 20 live flows (400 `approval_flow_limit_reached`); `isDefault: true` clears the previous default in one transaction (`PrismaTransaction`); `archive` answers 409 `{ error: 'flow_in_use' }` while an enabled, non-deleted `PolicyRule.approvalFlowId` references it; soft delete only (`deletedAt`); reads exclude archived; foreign ids are 404.
- Routes: dashboard `GET/POST/PUT/DELETE /approval-flows[/:id]` with `@CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])` (copy the pattern in `policies.controller.ts`); public `GET /public/v1/approval-flows[/:id]` scope `policies:read`, `POST/PUT/DELETE` scope `policies:write`. Response is the flow with `stages` ordered by position; never `organizationId`/`deletedAt`. Controllers pick known DTO fields explicitly.

- [ ] **Step 1: Write the failing tests.** DTO spec: 0 and 6 stages invalid, name 81 chars invalid, `minRole: 'USER'` invalid, 21 approvers invalid, duplicate approvers invalid. Service spec (mock repo): positions renumbered 1..n; unknown member id rejected; default switch clears the previous default in the same transaction; 21st live flow rejected; archive blocked with `flow_in_use`; `resolveFlowForRules` order (first rule with a flow wins, then default, then null, archived flows ignored); foreign org id 404. Http specs: admin metadata present on the dashboard routes; public routes carry the right scopes (assert `RequirePublicApiScopes` metadata like `public.integrations.scopes.spec.ts`); no `organizationId` in responses; 409 body shape.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/approval/approval-flow libraries/nestjs-libraries/src/dtos/approval apps/backend/src/api/routes/approval-flows.controller.http.spec.ts apps/backend/src/public-api/routes/v1/public.approval-flows.controller.http.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement**; provide repository and service in `database.module.ts`; register controllers.
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src
GIT commit -m "feat(approvals): approval flows with up to five stages (dashboard and public API)"
```

---

### Task 5: Multi-stage `ApprovalService` core: `decide`, stage snapshots, attribution

**Files:**
- Modify: `.../approval/approval.service.ts`, `approval.repository.ts`, `approval.projection.ts`, `approval.rules.ts` (only if a guard moves), `libraries/nestjs-libraries/src/services/public-webhook-events.ts` (samples), `.../audit/` consumers via `recordPostEvent` metadata, `.../agent-activity/agent-activity.view.ts` (allow-list `via stage stageCount final`)
- Test: extend `approval.service.spec.ts`, `approval.service.audit.spec.ts`, `approval.service.webhook.spec.ts`, `approval.repository.spec.ts`, `approval.projection.spec.ts`; create `approval.service.stages.spec.ts`

**Interfaces:**
- Constructor gains trailing optional deps: `@Optional() private _flows?: ApprovalFlowService`, `@Optional() private _tx?: PrismaTransaction`, `@Optional() private _orgs` (reuse `OrganizationRepository` already injected as `_organizations`; use `getUserOrgLink`).
- `requestApproval(orgId, postId, requestedById, actor = currentActor(), opts: { flowId?: string | null; ruleIds?: string[] } = {})` and `requestApprovalFromApi(orgId, postId, opts?)`: after `openRequest`, when `created`, resolves the flow (`opts.flowId` via `getById`, else `resolveFlowForRules(opts.ruleIds ?? [])`), writes `flowId/stageCount/currentStage=1` on the approval and creates `PostApprovalStage` snapshot rows (none for the implicit stage). On reopen (existing behaviour: resolved approval returns to PENDING) the old stage rows and `ApprovalActionToken` rows of that approval are deleted first. Repeated requests on a live approval change nothing (idempotent, unchanged). After creation call the extension point `protected async onStageOpened(approval, stage)`: default behaviour = today's `notifyApprovers` plain email plus in-app notification (Task 8 overrides the email part when `APPROVAL_EMAIL_LINKS=true`).
- `export type Decider = { actor: PostActor; userId?: string; role?: string; via: 'DASHBOARD'|'API'|'EMAIL_LINK'|'GUEST'|'BULK'; guest?: { name: string; email: string } | null }` and
```ts
decide(orgId: string, approvalId: string, decider: Decider, decision: 'approve' | 'reject', opts?: { note?: string | null; expectStage?: number }):
  Promise<{ approvalId: string; postId: string; status: 'PENDING'|'APPROVED'|'REJECTED'; changed: boolean; stage: { position: number; total: number }; final: boolean }>;
```
  Behaviour per spec R3.4: load approval with stage rows (synthesize `IMPLICIT_STAGE`/`IMPLICIT_RULES` when none); if the approval is already resolved: same decision -> `changed:false`, different -> `ConflictException({ error: 'approval_already_resolved', status })`; build `Decider`/`Origin` for `canDecideStage` (members resolved through `getUserOrgLink`; origin from the approval `requestedBy*` and the post `createdBy*` columns plus `PostApprovalStage` deciders); map verdict reasons to `ForbiddenException({ error: 'self_approval_blocked' })` for `self_approval`/`not_distinct`, otherwise `ForbiddenException({ error: 'not_allowed_for_stage', reason })`; apply key limits for automation (`checkKeyPermission` for `SCHEDULE` on the post's integration using `currentKeyPermissions()`), throwing the existing 403 shapes; then one `PrismaTransaction` that conditionally updates the stage row (`approvalId, position = currentStage, status PENDING`; zero rows means lost race -> reload and return `changed:false` or the 409) and the approval row (`currentStage` increment, or final status with `resolve`-equivalent columns including `decidedVia`, `decidedByType`, `approverId` for members, `decidedByApiKeyId`/`decidedByOAuthClientId` for automation). After the transaction: reject -> `onRejected`; non final approve -> `onStageOpened(next)`; final approve -> `scheduleApprovedPost` (revert also resets the last stage row to PENDING) then `notifyApproved`. Webhook `approval.resolved` and the audit event only when final (a non final approve writes the audit event with `final:false` and no webhook). Audit metadata `{ approvalId, decision, via, stage, stageCount, final }`, actor = `decider.actor` (null for guests).
- `approve(orgId, approvalId, approverId, role)` / `reject(..., note?)` keep their signatures and error messages (400 "already been resolved" for the dashboard, `assertCanApprove(role)` first) and delegate to `decide` with `via: 'DASHBOARD'` and `actor: { type: 'USER', userId: approverId }`. The legacy 400 is preserved by mapping `approval_already_resolved` back to `BadRequestException('This approval has already been resolved')` inside these two wrappers only.
- `resolveGuestReview` delegates to `decide` with `via: 'GUEST'`, `Decider` guest kind, after verifying the stage allows guests; `createGuestLink` throws `BadRequestException({ error: 'guest_not_allowed_for_stage' })` when the current stage has `allowGuest` false.
- `getForPost` and a new `getStageView(approval)` return `stage: { position, total, name }` and `stages: [{ position, name, status, decidedBy, decidedAt }]` (stages after a rejection shown with `status 'NOT_REACHED'` in the view only). `toPublicApproval`/`approvalDecidedByView` read the new `decidedBy*` columns (an `API_KEY` decider yields `{ type: 'API_KEY', apiKeyId }`). Webhook `approval` object gains `stage`; update `PUBLIC_WEBHOOK_EVENT_SAMPLES` accordingly.

- [ ] **Step 1: Write the failing tests** (`approval.service.stages.spec.ts` plus extensions):
  - Single implicit stage regression: every existing `approve`/`reject` spec still passes unchanged (do not weaken them).
  - Two stage flow: request creates two snapshot stages; approve by ADMIN A moves `currentStage` to 2, status stays PENDING, `changePostStatus` NOT called, no `approval.resolved` webhook, audit written with `final:false`; approve by ADMIN B finishes: status APPROVED, `changePostStatus('schedule', true)` called once, webhook once, `getForPost().status === 'APPROVED'`; between the two, `getForPost().status === 'PENDING'`.
  - Rejection at stage 2: REJECTED, post to DRAFT, `onRejected` once, stage 1 keeps its APPROVED row; re-request after rejection recreates two fresh PENDING stages and deletes tokens (assert the repository calls).
  - Eligibility: USER role 403; stage listing only member X rejects member Y but accepts SUPERADMIN; `preventSelfApproval` refuses the post creator with `self_approval_blocked`; `requireDistinctApprovers` refuses A deciding stage 2; implicit stage lets the creator approve (solo owner); automation on a stage with `allowAutomation` false -> `not_allowed_for_stage`; automation equal to the creator key refused even with the implicit stage; a key limited to DRAFT refused with `key_action_not_allowed`.
  - Races: simulate the conditional stage update returning 0 -> `changed:false` for the same decision, 409 for the opposite; two concurrent `decide` calls (Promise.all with a repository stub that lets only the first win) schedule once.
  - Schedule failure on the final stage: `revertApproved`-equivalent restores PENDING and the last stage row; the error propagates.
  - Guests: `createGuestLink` on a stage with `allowGuest:false` throws `guest_not_allowed_for_stage`; guest resolve records `via GUEST`, `actor null`.
  - Flow resolution: explicit `flowId` wins over `ruleIds`; `ruleIds` first matching flow; default flow; none -> implicit; archived flow ignored.
  - Projection: API_KEY decider appears in `decidedBy`; stages after a rejection are `NOT_REACHED`; no token or `requestedById` keys.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/approval --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** repository methods first (`createStages`, `deleteStagesAndTokens`, `getWithStages`, `decideStageTx`), then the service. Keep `approval.service.ts` readable: put the stage/decision logic in a small private section or a helper class `approval-decision.ts` if the file passes 650 lines.
- [ ] **Step 4: Run the Step 2 command plus** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/agent-activity libraries/nestjs-libraries/src/database/prisma/policies apps/backend/src/api/routes/agent-activity.controller.http.spec.ts apps/backend/src/public-api/routes/v1/public.approval.http.spec.ts --coverage=false` (bulk resolve, policy router and public approval specs must stay green), then `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src
GIT commit -m "feat(approvals): multi-stage decision engine with verified decider attribution"
```

---

### Task 6: Policy rules choose the approval flow

**Files:**
- Modify: `libraries/nestjs-libraries/src/dtos/policies/policy-rule.dto.ts`, `public-policy.dto.ts`, `.../policies/policy-rules.service.ts`, `policy-rules.repository.ts`, `policy-approval-router.ts`, call sites in `post-policy-gate.service.ts` (~126, ~198, ~342, ~364) and `publish-policy.guard.ts` (~85), `apps/backend/src/api/routes/policies.controller.ts` (rule view only)
- Test: extend `policy-rules.service.spec.ts`, `policy-approval-router.spec.ts`, `post-policy-gate.service.spec.ts`, `publish-policy.guard.spec.ts`, `policy-rule.dto.spec.ts`, `policies.controller.http.spec.ts`

**Interfaces:**
- `CreatePolicyRuleDto`/`UpdatePolicyRuleDto`: `approvalFlowId?: string | null` (`@IsOptional @IsString @MaxLength(64)`; `pickRuleFields` lists in both controllers add `'approvalFlowId'`, and the null-rejection loop must allow null for this one field to clear it). `PublicPolicyRule` includes `approvalFlowId`.
- `PolicyRulesService.create/update`: accepts `approvalFlowId` only when the effective effect is `REQUIRE_APPROVAL` and `ApprovalFlowService.getById(orgId, id)` finds a live flow; else `BadRequestException({ error: 'approval_flow_invalid' })`. Changing a rule to `BLOCK` clears `approvalFlowId`.
- `PolicyApprovalRouter.route(orgId, postId, opts: { terminateWorkflow: boolean; onlyFromState?: string; ruleIds?: string[] })` passes `{ ruleIds: opts.ruleIds }` to `requestApprovalFromApi`. Every call site passes `ruleIds: outcome.matched.filter(m => m.effect === 'REQUIRE_APPROVAL').map(m => m.ruleId)` (matches are already priority ordered; for multi-channel call sites use the union in match order). No other change to those files.

- [ ] **Step 1: Write the failing tests.** DTO: `approvalFlowId` accepted as string or null, 65 chars invalid. Service: flow id on a BLOCK rule rejected; unknown or archived flow rejected; switching to BLOCK clears it; clearing with null works. Router: `ruleIds` forwarded to `requestApprovalFromApi`; absent `ruleIds` behaves exactly as before. Gate and guard specs: the router is called with `ruleIds` equal to the matched REQUIRE_APPROVAL rule ids in order (a BLOCK rule's id is never included). Http: PUT with `approvalFlowId: null` is accepted; the response rule view contains `approvalFlowId`.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/policies libraries/nestjs-libraries/src/dtos/policies apps/backend/src/api/routes/policies.controller.http.spec.ts apps/backend/src/public-api/routes/v1/public.policies.http.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm exec jest -c jest.config.ts apps/backend/src/public-api/routes/v1 --coverage=false` and `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src
GIT commit -m "feat(policies): REQUIRE_APPROVAL rules can name the approval flow"
```

---

### Task 7: Public approvals API: list, get, approve, reject

**Files:**
- Create: `apps/backend/src/public-api/routes/v1/public.approvals.controller.ts` (+ `.http.spec.ts`), `libraries/nestjs-libraries/src/dtos/approval/public-approval.dto.ts` (+ spec)
- Modify: `apps/backend/src/public-api/public.api.module.ts`, `.../approval/approval.repository.ts` (add `listForPublicApi`), `libraries/nestjs-libraries/src/database/prisma/approval/approval.service.ts` (add `listForApi`, `getDetailForApi`)

**Interfaces:**
- DTOs: `ListApprovalsQueryDto { status?: 'PENDING'|'APPROVED'|'REJECTED'; limit?: number (1..100, default 25); cursor?: string; since?: string (ISO date) }`, `DecideApprovalDto { note?: string (<= 500) }`.
- Service: `listForApi(orgId, q): Promise<{ items: PublicApprovalItem[]; nextCursor: string | null }>` ordered by `requestedAt desc, id desc`, cursor = base64url of `requestedAt|id`; `getDetailForApi(orgId, id): Promise<PublicApprovalItem & { preview: string }>` (404 unknown/foreign; preview = plain text of the post content cut to 500, reuse the text helper used by `agent-activity.view.ts` `cleanDisplayName`/content text function or `htmlToPolicyText`). `PublicApprovalItem` as in spec R1.2.
- Controller `PublicApprovalsController` at `/public/v1`: `GET /approvals` and `GET /approvals/:id` scope `approvals:read`; `POST /approvals/:id/approve|reject` scope `approvals:decide`, `@HttpCode(200)`, optional `Idempotency-Key` header, `claim(org.id, key, { approvalId, decision, note })` / `complete` / `release` exactly like `createPost`. The decider: `actor = currentActor()`; for `API_KEY`/`OAUTH_CLIENT` build `Decider` (`via: 'API'`) and call `ApprovalService.decide`. A `USER` actor (not expected on the public API) is refused 403. Add `@ApiOperation` descriptions listing error codes (`self_approval_blocked`, `not_allowed_for_stage`, `approval_already_resolved`, `key_action_not_allowed`, `key_channel_not_allowed`).

- [ ] **Step 1: Write the failing tests.** Http spec (supertest with stubs): scope metadata per route (assert like `public.integrations.scopes.spec.ts`: `approve`/`reject` need exactly `approvals:decide`, list/get `approvals:read`); a key with `approvals:write` only is refused by `PublicApiScopeGuard`; `limit` 101 and bad `status` -> 400; cursor round trip with the stub; response items contain no `guestToken*`, `requestedById`, `organizationId`; `Idempotency-Key` replay returns the stored response without calling `decide` twice; reuse of a key with a different body -> 409; `decide` throwing `approval_already_resolved` is a 409 and releases the claim; the same decision twice (stub returns `changed:false`) is 200; foreign id 404. Service spec: `listForApi` filters by org, status and since; ordering ties broken by id.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/backend/src/public-api/routes/v1/public.approvals.controller.http.spec.ts libraries/nestjs-libraries/src/dtos/approval/public-approval.dto.spec.ts libraries/nestjs-libraries/src/database/prisma/approval --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement**; register the controller in `public.api.module.ts`.
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm exec jest -c jest.config.ts apps/backend/src/public-api/routes/v1/public-api.openapi.spec.ts apps/backend/src/public-api/routes/v1/public.integrations.scopes.spec.ts --coverage=false` and `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src
GIT commit -m "feat(public-api): list, read, approve and reject approvals (approvals:decide)"
```

---

### Task 8: Email approver links: tokens, challenge, template, public endpoints

**Files:**
- Create: `.../approval/approval-link.crypto.ts` (+ spec), `approval-link.template.ts` (+ spec), `approval-link.service.ts` (+ spec), `libraries/nestjs-libraries/src/dtos/approval/approver-link.dto.ts` (+ spec), `apps/backend/src/api/routes/public.controller.approver-links.spec.ts`
- Modify: `apps/backend/src/api/routes/public.controller.ts`, `.../approval/approval.service.ts` (override of `onStageOpened` only), `.../approval/approval.repository.ts` (token methods), `database.module.ts`, `.env.example`

**Interfaces:**
- `approval-link.crypto.ts` (pure): `newLinkToken(): string` (32 bytes base64url), `hashLinkToken(token): string` (sha256 hex), `makeChallenge(tokenHash: string, now: number, secret: string): string` (`<now>.<hmac hex>` with `key = HMAC-SHA256(secret, 'approver-link-challenge')`), `verifyChallenge(challenge: string, tokenHash: string, now: number, secret: string): 'ok' | 'too_early' | 'expired' | 'invalid'` (valid between 2 s and 15 min, constant-time compare), `linkTtlHours(env: string | undefined): number` (default 48, clamp 1..168, garbage -> 48), `linksEnabled(env): boolean` (`'true'` only).
- `approval-link.template.ts` (pure): `renderApproverEmail(input: { channelName: string; stageName: string; stageLabel: string; requesterName: string; preview: string; approveUrl: string; rejectUrl: string }): { subject: string; html: string }`; every interpolated string HTML-escaped; preview cut to 200 characters; URLs must start with the configured `FRONTEND_URL` origin (throws otherwise).
- `ApprovalLinkService(repo, notifications, orgRepo)`: `sendStageEmails(approval, stage, members)` (mints a token per eligible member via `eligibleMemberIds`, replaces earlier live tokens of the same `(approvalId, stagePosition, userId)`, sends one email each via `NotificationService.sendEmail`, swallows and logs send failures without token text); `view(token)` (GET data of spec R2.2, no mutation); `decide(token, { decision, note, challenge })` (checks challenge, loads token row by hash with `expiresAt > now` and `usedAt null`, re-checks membership/role/disabled via `getUserOrgLink`, then calls `ApprovalService.decide` with `via: 'EMAIL_LINK'` and `expectStage = token.stagePosition`, and consumes the token in the same logical step: `updateMany where tokenHash, usedAt null` BEFORE the decision, and restores `usedAt = null` if the decision throws a retryable non-final error such as `ForbiddenException` (a refused decision must not burn the link) but not on success); `revokeForApproval(approvalId)` used by resolve/reopen paths (Task 5's repository delete is reused).
- Failure bookkeeping: per token a Redis counter (`ioRedis.incr('approver-link:fail:' + hash.slice(0,12))` with 15 min expiry); bad or early/expired challenge and DTO errors increment; at 5 the token row is deleted. All unknown/spent/expired/revoked tokens -> `NotFoundException({ error: 'link_invalid' })` with the identical body.
- `PublicController` gains `GET /public/approver-links/:token` and `POST /public/approver-links/:token/decision` (`@UseGuards(AuthRateLimitGuard)`, `@Res({ passthrough: true })` to set `Cache-Control: no-store` and `Referrer-Policy: no-referrer`). `ApproverLinkDecisionDto { decision: 'approve'|'reject'; note?: string (<= 500); challenge: string (1..200) }`.
- Hook: `ApprovalService.onStageOpened` calls `ApprovalLinkService.sendStageEmails` when `linksEnabled(process.env.APPROVAL_EMAIL_LINKS)` and the service is injected, else the existing `notifyApprovers`. `.env.example` documents `APPROVAL_EMAIL_LINKS` (default off) and `APPROVAL_LINK_TTL_HOURS`.

- [ ] **Step 1: Write the failing tests.**
  - Crypto: challenge ok at 3 s, `too_early` at 1 s, `expired` at 16 min, `invalid` for another token hash or a flipped character; `linkTtlHours` clamps; tokens are 43 chars and unique over 1000 draws; hash is stable.
  - Template: `<script>`, quotes and `&` in channel name, stage name, requester and preview are escaped; preview 200 cut; a URL on another origin throws; no `<img`.
  - Service: GET leaves the DB untouched (assert no write method was called); POST without challenge, with early/old/foreign challenge -> `link_invalid`-class 400/404 per spec and increments the failure counter; 5th failure deletes the token; unknown, expired, used and revoked tokens produce identical bodies; a member who became USER or disabled -> `link_not_allowed`; creator with `preventSelfApproval` -> `self_approval_blocked` and the token is NOT consumed; success consumes the token and calls `decide` with `via EMAIL_LINK`, `actor USER`, `userId` from the token; two parallel POSTs (stub where only the first `updateMany` returns 1) -> one decision; the email send failing does not throw from `sendStageEmails`; tokens and challenges never appear in `console`/Logger output (spy).
  - Env: with `APPROVAL_EMAIL_LINKS` unset `onStageOpened` calls `notifyApprovers` and never mints a token (regression for compatibility).
  - Controller spec (supertest): headers `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on GET; JSON-only decision (a form-encoded POST fails validation); the guard is applied (metadata check like `public.controller.guest.spec.ts`).
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/approval/approval-link libraries/nestjs-libraries/src/dtos/approval/approver-link.dto.spec.ts apps/backend/src/api/routes/public.controller.approver-links.spec.ts apps/backend/src/api/routes/public.controller.guest.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-run the Step 2 command plus** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/approval --coverage=false` and `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src .env.example
GIT commit -m "feat(approvals): signed single-use email approver links with a two step challenge"
```

---

### Task 9: Slack notifications through the webhook outbox

**Files:**
- Create: `libraries/nestjs-libraries/src/services/slack-message.ts` (+ spec), `libraries/nestjs-libraries/src/database/prisma/webhooks/redact-url.ts` (+ spec)
- Modify: `libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-delivery.service.ts` (`send` only, plus `lastError` writes), extend `public-webhook-delivery.service.spec.ts`

**Interfaces:**
- `slack-message.ts` (pure): `isSlackWebhookUrl(url: string): boolean` (parses with `URL`; `https:` and `hostname === 'hooks.slack.com'` and `pathname.startsWith('/services/')`); `buildSlackBody(envelope: { event: string; data: any }, frontendUrl: string): { text: string; blocks: unknown[] }` per spec R4.2: escapes `&`, `<`, `>`, caps each interpolated value at 200 characters, uses only `data.approval.stage`, `data.status`, `data.note`, `data.errorCategory`, `data.post.releaseURL` (https only); never reads post content, ids or actor fields; unknown events (including `webhook.test`) get a generic line.
- `redact-url.ts` (pure): `redactUrl(text: string, url: string): string` replaces every occurrence of the URL, its host+path and its path with `[url]`; used wherever `send` produces `error`.
- `send(row, target)`: `const body = isSlackWebhookUrl(target.url) ? JSON.stringify(buildSlackBody(row.payload, process.env.FRONTEND_URL ?? '')) : JSON.stringify(row.payload)`. The signature is computed over whichever body is sent. Non-Slack targets are byte-for-byte unchanged. Error strings pass through `redactUrl` before being stored (`recordFailure`/`lastError` paths).

- [ ] **Step 1: Write the failing tests.** Slack message: each of the four events renders the expected text and URL button (`/approval` for requested, `/agents` for resolved and failed, `releaseURL` only when https); `<script>&` in a note is escaped; a 500 character note is cut; the output JSON contains none of the strings `content`, a post id, `apiKeyId`, `userId` when the input payload has them (use a payload full of such fields); `isSlackWebhookUrl` rejects `hooks.slack.com.evil.com`, `http://`, `https://hooks.slack.com/other`, `https://evil.com/hooks.slack.com/services/x`. Redact: URL, host and path variants replaced; text without the URL unchanged. Delivery service: a Slack target sends the Slack body (assert the fetch mock body) with the same signature headers; a non-Slack target body equals `JSON.stringify(payload)` exactly as before (snapshot); a fetch error whose message contains the Slack URL is stored without it; HTTP 400 stores `HTTP 400` only.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/services/slack-message.spec.ts libraries/nestjs-libraries/src/database/prisma/webhooks --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm exec jest -c jest.config.ts apps/backend/src/public-api/routes/v1/public-webhook-subscriptions.controller.spec.ts --coverage=false` and `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src
GIT commit -m "feat(webhooks): Slack incoming webhook targets get a Slack formatted message"
```

---

### Task 10: Customer (workspace) provisioning API

**Files:**
- Create: `libraries/nestjs-libraries/src/database/prisma/integrations/customer.service.ts` (+ spec), `libraries/nestjs-libraries/src/dtos/customers/customer.dto.ts` (+ spec), `apps/backend/src/public-api/routes/v1/public.customers.controller.ts` (+ `.http.spec.ts`)
- Modify: `integration.repository.ts` (add `listCustomersWithCounts`, `createCustomer`, `renameCustomer`, `archiveCustomer`, `findCustomerById`), `public.workspace.controller.ts` (`setChannelCustomer` accepts `customerId`), `public.api.module.ts`, `database.module.ts`

**Interfaces:**
- DTOs: `CustomerNameDto { name: string }` with `@Transform(trim)`, length 1..100, a `Matches(/^[^\u0000-\u001f\u007f]+$/)` control-character guard.
- `CustomerService(repo)`: `list(orgId)`, `create(orgId, name): { customer; created }` (returns the existing live customer with that name, `created:false`; 400 `customer_limit_reached` at 200 live), `rename(orgId, id, name)` (404 foreign/archived; 409 `customer_name_taken`), `archive(orgId, id): { id, archived: true, detachedChannels: number }` (sets `deletedAt = now`, `updateMany` integrations `customerId = null` within one `PrismaTransaction`; second archive 404).
- Controller `PublicCustomersController` at `/public/v1`: `GET /customers` (`channels:read`), `POST /customers` (`channels:write`, 201 or 200, optional `Idempotency-Key` through `PublicApiIdempotencyService`), `PUT /customers/:id`, `POST /customers/:id/archive` (`channels:write`). All writes call the same admin check as `assertAdmin` in `public.workspace.controller.ts` (copy the helper into a small shared file `apps/backend/src/public-api/routes/v1/assert-admin.ts` and use it in the new controller only).
- `PUT /integrations/:id/customer` body `{ name?: string | null; customerId?: string | null }`: both set -> 400; `customerId` must be a live customer of the org (404 otherwise) and uses `updateIntegrationGroup`; `{ name }` and the empty-unassign behaviour are unchanged (existing spec stays green).

- [ ] **Step 1: Write the failing tests.** Service: create twice returns the same id and `created:false`; 201st customer rejected; rename collision 409; archive detaches channels and keeps posts (assert only `customerId` updates, no delete calls); archived customers are not listed and cannot be renamed; archive twice 404; foreign id 404. Http: USER role gets 403 on writes; scopes via metadata; `PUT /integrations/:id/customer` with both `name` and `customerId` -> 400, with a foreign `customerId` -> 404; existing `{ name }` behaviour unchanged (run `public.workspace.spec.ts`).
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/integrations/customer.service.spec.ts libraries/nestjs-libraries/src/dtos/customers apps/backend/src/public-api/routes/v1/public.customers.controller.http.spec.ts apps/backend/src/public-api/routes/v1/public.workspace.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src
GIT commit -m "feat(public-api): create, rename, archive and list customers (workspaces)"
```

---

### Task 11: MCP `postsider_decide_approval` (stdio, opt-in)

**Files:**
- Modify: `apps/mcp/src/server.ts` (new option `allowApprovalDecisions`, tool registration, `postsider_get_approval_status` description), `apps/mcp/src/index.ts` (read `POSTSIDER_MCP_ALLOW_APPROVAL_DECISIONS`), `apps/mcp/src/__tests__/tool-inventory.ts`, `stdio.spec.ts`, `server.spec.ts` as needed, `apps/mcp/README.md`, `apps/mcp/CHANGELOG.md`
- Create: `apps/mcp/src/__tests__/decide-approval.spec.ts`

**Interfaces:**
- `PostSiderServerOptions.allowApprovalDecisions?: boolean`. When true, register `postsider_decide_approval` with input `{ approvalId: nonEmptyId, decision: z.enum(['approve','reject']), note?: string (max 500) }`, annotations `{ readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:true }`, handler `client.post('/approvals/' + encodeURIComponent(approvalId) + '/' + decision, note ? { note } : undefined, idempotencyKey)` where the idempotency key is a stable hash of `(approvalId, decision, note)` so a model retry is safe. Description (must contain these facts): needs the `approvals:decide` scope on the API key; a key cannot decide approvals it requested or whose post it created; use only when the user explicitly asked for this decision; reject notes are shown to the author; the response says whether a later stage is still pending.
- Hosted server (`src/http/server.ts`) never sets the option; the scope guard needs no change (a decide POST maps to `posts:write` at the guard and the API refuses OAuth tokens anyway because they never hold `approvals:decide`). Add a spec line proving the hosted tool list is still `EXPECTED_TOOL_NAMES` (40).
- Frozen lists: keep `EXPECTED_TOOL_NAMES` at the hosted 40; add `postsider_decide_approval` to the stdio-only list in `stdio.spec.ts` (`stdioOnly` becomes two names when both opt-ins are set; default stdio stays 41).

- [ ] **Step 1: Write the failing tests.** `decide-approval.spec.ts`: without the option the tool is absent; with it present and the description contains `approvals:decide`; a call posts to `/approvals/abc/approve` with the derived idempotency key; reject with a note sends `{ note }`; a `ZodError` for `decision: 'maybe'` and for a 501 character note; error mapping uses the existing `fail(e)` path (a 403 `self_approval_blocked` text reaches the model). `stdio.spec.ts` updated expectations fail first.
- [ ] **Step 2: Run** `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --runInBand`. Expected: FAIL (new tests).
- [ ] **Step 3: Implement**; update README (tool count text: 40 hosted, 41 local, 42 with both opt-ins, the env var, the safety statement) and CHANGELOG (Unreleased). Do NOT change versions.
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm --filter ./apps/mcp run build` if that script exists (check `apps/mcp/package.json`), and `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/oauth --coverage=false`. Expected: PASS.
- [ ] **Step 5: Commit**
```
GIT add apps/mcp
GIT commit -m "feat(mcp): opt-in postsider_decide_approval for the local server"
```

---

### Task 12: n8n node: approvals, policy check, groups; publish-ready package (separate repository)

**Repository:** `/Users/lukasz/APP and DEV Project/PostSider _Project/n8n-nodes-postsider` (own `.git`, currently on `main`). First `GIT -C <repo> checkout -b feat/approvals-policies-groups`. Never push, never tag, never run `npm publish` or `npm run release`.

**Files:**
- Modify: `nodes/PostSider/shared/operations.ts`, `nodes/PostSider/resources/descriptions.ts`, `nodes/PostSider/PostSider.node.ts` (`getParameters`), `nodes/PostSider/methods/loadOptions.ts` only if a loader is needed, `package.json` (`version` -> `0.2.0`), `CHANGELOG.md`, `README.md`, `test/operations.test.ts`, `test/description.test.ts`, `test/workflow.test.ts`, `test/examples.test.ts`
- Create: `examples/approval-notify-slack.json`

**Interfaces (request builders, exact endpoints, spec R7):**
- `approval/request` -> `POST /posts/{postId}/request-approval` (no body).
- `approval/getStatus` -> unchanged `GET /posts/{postId}/approval`.
- `approval/getMany` -> `GET /approvals` with `qs { status?, since?, limit? }` (limit 1..100, default 25; `returnAll` follows `nextCursor` up to 10 pages in `execute`, not in the pure builder).
- `approval/approve` and `approval/reject` -> `POST /approvals/{approvalId}/approve|reject`, body `{ note? }` (<= 500), headers `{ 'Idempotency-Key': 'n8n:<executionId>:item:<index>' }` (same helper as `post/create`).
- `policy/check` -> `POST /policies/evaluate` with the fields of the server's `EvaluatePolicyDto` (read `libraries/nestjs-libraries/src/dtos/policies/evaluate-policy.dto.ts` in the monorepo and mirror: type, per-channel content, optional date), `policy/getMany` -> `GET /policies`.
- `group/create` -> `POST /customers { name }`, `group/update` -> `PUT /customers/{groupId} { name }`, `group/archive` -> `POST /customers/{groupId}/archive`; `group/getMany` stays `GET /groups`.
- Path IDs go through the existing `encodedId(...)` validator; names are trimmed and length checked like the server (1..100).

- [ ] **Step 1: Write the failing tests** in `test/operations.test.ts` for every builder above (method, endpoint, qs/body, idempotency header, validation errors such as an empty approval id or a 501 character note), `test/description.test.ts` (resource options now include Policy; each new operation exists with the right `displayOptions`; `usableAsTool` still true), `test/workflow.test.ts` (an item flow through `execute` with a mocked transport for approve and for `getMany` paging), `test/examples.test.ts` (the new example parses, uses only node types `n8n-nodes-base.webhook`, `n8n-nodes-base.code`, `n8n-nodes-base.if`, `n8n-nodes-postsider.postSider`, contains no secret-like strings).
- [ ] **Step 2: Run** `npm test` in the repo. Expected: FAIL (new tests).
- [ ] **Step 3: Implement**; the example workflow: Webhook (POST, raw body) -> Code node verifying `X-Postsider-Signature` (`sha256=` HMAC over `<timestamp>.<raw body>` with a placeholder secret from an n8n credential/env expression, reject timestamps older than 5 minutes) -> IF event is `approval.requested` -> PostSider Approve/Reject branch (disabled by default, with a sticky note saying a key with `approvals:decide` is needed). Update README (operations table, required scopes per operation, self-hosted base URL note, safety note that approve/reject must not be wired to unreviewed AI output), CHANGELOG `0.2.0 - Unreleased`, bump `package.json` version and lockfile version field (`npm version 0.2.0 --no-git-tag-version`).
- [ ] **Step 4: Verify.** Run `npm run verify` (lint, typecheck, test, build). Expected: all green. Run `npm pack --dry-run` and confirm the file list is only `dist`, `examples`, `CHANGELOG.md`, package metadata. Do not publish.
- [ ] **Step 5: Commit (in the n8n repo)**
```
GIT -C "/Users/lukasz/APP and DEV Project/PostSider _Project/n8n-nodes-postsider" add nodes test examples package.json package-lock.json CHANGELOG.md README.md
GIT -C "/Users/lukasz/APP and DEV Project/PostSider _Project/n8n-nodes-postsider" commit -m "feat: approvals, policy check and group management operations (0.2.0)"
```
Report the owner steps: tag `0.2.0` and set `NPM_DIST_TAG`/`NPM_TOKEN` per the existing `publish.yml`.

---

### Task 13: Make and Zapier minimum assets

**Files:**
- Create: `docs/automation/make.md`, `docs/automation/zapier.md`, `examples/automation/zapier/package.json`, `index.js`, `authentication.js`, `triggers/approval_requested.js`, `triggers/approval_decided.js`, `creates/request_approval.js`, `creates/decide_approval.js`, `creates/create_draft.js`, `lib/map.js` (pure mapping), `test/map.test.js`, `README.md`

**Interfaces:**
- Authentication: custom, one field `apiKey`, header `Authorization: <apiKey>` (same as the n8n credential), `baseUrl` field defaulting to `https://api.postsider.com`, test call `GET /public/v1/is-connected`.
- Triggers (REST hook): `performSubscribe` -> `POST /public/v1/webhook-subscriptions { name, url: bundle.targetUrl, events: ['approval.requested'] }` (and `['approval.resolved']`), returns the created subscription (store `id`); `performUnsubscribe` -> `DELETE /public/v1/webhook-subscriptions/{id}`; `perform` maps the delivered envelope with `lib/map.js`; `performList` -> `GET /public/v1/approvals?status=PENDING&limit=3` (and `status=APPROVED|REJECTED` for decided) so users get real sample data; the required webhook scopes are documented (`webhooks:write`, `approvals:read`).
- Creates: `request_approval` -> `POST /posts/{id}/request-approval`; `decide_approval` -> `POST /approvals/{id}/approve|reject` with `Idempotency-Key` from `bundle.meta.zap.id` + input hash; `create_draft` -> `POST /posts` (`type: draft`).
- `lib/map.js`: `mapEnvelope(envelope)` (flat, Zapier-friendly keys: `event, eventId, approvalId, postId, status, note, stagePosition, stageTotal, decidedByType`), `verifySignature(rawBody, timestamp, signature, secret, nowMs)` (HMAC-SHA256 over `<timestamp>.<rawBody>` compare constant time, reject skew > 300 s).
- Docs: `make.md` covers HTTP "Make a request" recipes (auth header, list approvals, approve with idempotency header), a Custom webhook scenario with signature verification formula, dedupe by `X-Postsider-Event-Id`, the 5 second response expectation and retry behaviour (read the retry schedule from `public-webhook-delivery.service.ts` before writing it; do not invent numbers); `zapier.md` explains the scaffold, scopes, and that `zapier validate`/`zapier push`/submission are owner actions. State plainly: nothing here is published or verified against the vendor tooling.

- [ ] **Step 1: Write the failing tests** `examples/automation/zapier/test/map.test.js` (run with `node --test`): envelope mapping for both events, missing `approval.stage` yields `null` stage fields, signature accept/reject (tampered body, wrong secret, skew 301 s), no dashes in outputs.
- [ ] **Step 2: Run** `node --test examples/automation/zapier/test/map.test.js`. Expected: FAIL (module missing).
- [ ] **Step 3: Write the scaffold and docs.** Keep the scaffold dependency free except `zapier-platform-core` listed in `package.json` (not installed here); files must be syntactically valid: run `node --check` on every `.js` file.
- [ ] **Step 4: Verify.** `node --test examples/automation/zapier/test/map.test.js` and `for f in $(find examples/automation/zapier -name '*.js' -not -path '*/node_modules/*'); do node --check "$f" || exit 1; done`. Expected: PASS. Dash check: `grep -rnP '[\x{2013}\x{2014}]' docs/automation examples/automation` prints nothing (use `LC_ALL=en_US.UTF-8`).
- [ ] **Step 5: Commit**
```
GIT add docs/automation examples/automation
GIT commit -m "docs(automation): Make recipes and a Zapier app scaffold for approvals"
```

---

### Task 14: Frontend: public approver link page `/approve/[token]`

**Files:**
- Create: `apps/frontend/src/app/approve/[token]/page.tsx`, `apps/frontend/src/components/approver-link-view.tsx`, `apps/frontend/src/lib/approver-link-api.ts` (thin fetchers), `apps/frontend/src/lib/approver-link-model.ts` (+ `.spec.ts`)
- Modify: `apps/frontend/src/lib/i18n/messages/en.ts`, `pl.ts` (new namespace `approverLink`), any route allow-list for unauthenticated pages (check how `app/review/[token]` avoids the auth redirect, and mirror it: grep `review` in `apps/frontend/src/lib/api.ts`, `components/app-root.tsx`, `middleware.ts`)

**Interfaces:**
- API (relative to the backend like `lib/guest-review-api.ts`, `silent: true`): `getApproverLink(token)` -> `GET /public/approver-links/:token`; `decideApproverLink(token, { decision, note, challenge })` -> `POST /public/approver-links/:token/decision`.
- Model (pure): `errorKind(status: number, body: any): 'invalid' | 'not_allowed' | 'self' | 'resolved' | 'rate_limited' | 'network'` (404 `link_invalid`, 403 `link_not_allowed`, 403 `self_approval_blocked`, 409 `approval_already_resolved`, 429), `intentFromQuery(search: string): 'approve' | 'reject' | null`, `canSubmit(state): boolean` (not while submitting, not when `selfApprovalBlocked`, reject allowed with or without note), `stageLabel(stage: { position: number; total: number; name: string }, t)`.
- Page: server component wrapper reading `params.token`; client view `ApproverLinkView` loads data once, shows channel (PlatformIcon + name), requester, stage line, content as text and media as images (no `dangerouslySetInnerHTML`), "You are deciding as <name>", note textarea (reject), buttons Approve and Reject (the `intent` only gives one the filled style), disabled with a reason when `selfApprovalBlocked`, busy state, result panel per outcome, error panels per `errorKind`. Waits at least until the page rendered before enabling buttons (the backend enforces the 2 s minimum anyway; the UI shows a short disabled state and handles the `too_early` response by retrying once after 2.5 s). The token stays only in the URL and is never logged or stored. Add `<meta name="referrer" content="no-referrer">` through the page `metadata`.
- i18n keys (namespace `approverLink`, en and pl, no dashes): `title`, `decidingAs`, `stage`, `requestedBy`, `approve`, `reject`, `notePlaceholder`, `selfBlocked`, `doneApproved`, `doneRejected`, `doneAdvanced` ("Approved. The next reviewer has been notified."), `errInvalid`, `errNotAllowed`, `errResolved`, `errRate`, `errNetwork`.

- [ ] **Step 1: Write the failing tests** `approver-link-model.spec.ts` (relative imports only): `errorKind` table, `intentFromQuery` (garbage -> null), `canSubmit` truth table, stage label formatting; an i18n spec section asserting `approverLink` keys exist in `en.ts` and `pl.ts` with equal placeholder sets and no U+2013/U+2014 (put it in `lib/approval-i18n.spec.ts`, shared with Task 15; Task 14 creates the file with its own section, Task 15 appends).
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/approver-link-model.spec.ts apps/frontend/src/lib/approval-i18n.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** model, API module, view, page, i18n.
- [ ] **Step 4: Verify.** Re-run the Step 2 command, `pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json`, `pnpm --filter ./apps/frontend run lint`. Then a visual check at 375, 768 and 1440 px: start the dev server, serve a fixture with the same technique as `apps/frontend/scripts/agent-center-check.cjs` (mock `/public/approver-links/*` with `page.route`), capture screenshots of valid, self-blocked, resolved and invalid states into the scratchpad directory; no horizontal scroll. If Playwright is missing, record that and rely on `tsc`.
- [ ] **Step 5: Commit**
```
GIT add apps/frontend/src
GIT commit -m "feat(frontend): public approver page for signed email links"
```

---

### Task 15: Frontend: stage-aware approval page, flows settings, policy flow select, key scope

**Files:**
- Create: `apps/frontend/src/app/settings/approval-flows/page.tsx`, `apps/frontend/src/components/approval-flows/flow-form.tsx` (+ `flow-form.module.css`), `apps/frontend/src/lib/approval-flows-api.ts`, `approval-flows-model.ts`, `approval-stage-model.ts` (+ `.spec.ts` for the two model files)
- Modify: `apps/frontend/src/app/approval/page.tsx`, `lib/approval-api.ts` (types: `stage`, `stages`, `hasGuestLink`, `guestLinkExpiresAt`), `components/settings-shell.tsx` (nav item `/settings/approval-flows`, `minRole: "ADMIN"`), `components/policies/policy-rule-form.tsx` and `policies-api.ts`/`policies-model.ts` (field `approvalFlowId`), `app/settings/api/page.tsx` (`API_SCOPES` gets `"approvals:decide"` and a warning line), `lib/i18n/messages/en.ts` and `pl.ts`, `lib/approval-i18n.spec.ts`

**Interfaces:**
- `approval-flows-api.ts`: `listApprovalFlows()`, `createApprovalFlow(body)`, `updateApprovalFlow(id, body)`, `archiveApprovalFlow(id)` over `/approval-flows` (dashboard API).
- `approval-flows-model.ts` (pure): `validateFlow(draft): Array<{ field: string; key: MessageKey }>` mirroring server limits (name 1..120; 1..5 stages; stage name 1..80; approvers <= 20 distinct; `minRole` in `ADMIN|SUPERADMIN`), `emptyFlow()`, `moveStage(stages, from, to)`, `toRequestBody(draft)`.
- `approval-stage-model.ts` (pure): `canDecideStageClient(stage, member, approval): { allowed: boolean; reasonKey?: MessageKey }` (role ADMIN/SUPERADMIN, listed approvers, `isCreatorOrRequester` self-approval when the flow forbids it; the server stays authoritative), `stageProgressLabel(stage, t)`, `stagesAfterRejection(stages)` marks later stages "not reached".
- Pages: `/approval` rows show "Stage 2 of 3: Owner" with a small segmented progress (filled/outlined shapes, no color), Approve/Reject disabled with the reason text when `canDecideStageClient` says no, the guest-link button only for admins when `hasGuestLink`/stage allows it (hide on `guest_not_allowed_for_stage` errors); `/settings/approval-flows`: list with default marker, create/edit modal (`flow-form.tsx`: name, default switch, two flag switches, ordered stage list with up/down buttons, per-stage name, minimum role select, optional member multi-select from the existing team members API in `lib/organization-api.ts`, automation and guest switches), archive with `ConfirmDialog` and the `flow_in_use` message. Policy rule form: "Approval flow" select (loaded from `listApprovalFlows`) visible only when effect is Require approval, with "Default flow" as the empty option.
- i18n: namespace `approvalFlows` and a few `approval.*` stage keys, en and pl only (Q11).

- [ ] **Step 1: Write the failing tests**: `approval-flows-model.spec.ts` (limits at 0/1/5/6 stages, 80/81 character names, duplicate approvers, `moveStage` bounds, request body shape), `approval-stage-model.spec.ts` (truth table incl. self-approval, listed approvers, USER role, implicit stage), extend `approval-i18n.spec.ts` for the new namespaces and for every `MessageKey` used.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/approval-flows-model.spec.ts apps/frontend/src/lib/approval-stage-model.spec.ts apps/frontend/src/lib/approval-i18n.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** models, API module, pages and form, nav, policy form select, key scope, i18n.
- [ ] **Step 4: Verify.** Re-run the Step 2 command, `pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json`, `pnpm --filter ./apps/frontend run lint`, `pnpm exec jest -c jest.config.ts apps/frontend/src/lib --coverage=false` (the Phase 4 specs stay green). Visual check of `/settings/approval-flows` and `/approval` at 375/768/1440 px with fixtures (as in Task 14). If Playwright is missing, say so.
- [ ] **Step 5: Commit**
```
GIT add apps/frontend/src
GIT commit -m "feat(frontend): stage-aware approvals, approval flows settings and flow choice on rules"
```

---

### Task 16: Documentation and final verification

**Files:**
- Modify: `README.md` (new subsections near the approval and webhook sections: `### Approvals (stages, flows, links)` and `### Slack, Make and Zapier`; env table; fix the stale "19 tools" count to 40 hosted / 41 local / 42 with both opt-ins), `docs/API-MCP-TRUST.md` (scope list, `approvals:decide` never default, the fix and the hashing migration, approver link threat model, self-approval rules, tool count), `.env.example` (if Task 8 did not complete it), `apps/frontend/CHANGELOG.md` (Unreleased), `docs/superpowers/` ledger note not needed

**Interfaces:** none (docs). Content requirements:
- README: stages and flows in plain words; how a rule picks a flow; who can decide; self-approval flags and the solo-owner default; deciding with an API key (scope, limits, example `curl` for `POST /public/v1/approvals/:id/approve` with `Idempotency-Key`); email links (enable with `APPROVAL_EMAIL_LINKS=true`, TTL, two step page, what a forwarded email means); guest links and `allowGuest`; Slack via a webhook subscription with an example body for `POST /public/v1/webhook-subscriptions` using a `hooks.slack.com` URL and what the message does not contain; customers API summary; Make/Zapier/n8n pointers; MCP `POSTSIDER_MCP_ALLOW_APPROVAL_DECISIONS`.
- `docs/API-MCP-TRUST.md`: add the scope to the list of never-default scopes; "Approval identity" section (who is recorded for each `via`); "Links in email" threat model with the residual risks of spec section 6; the `guestToken` exposure note (what was wrong, who was affected, what changed, that outstanding links keep working); update "Approval idempotency".
- Owner actions list at the end of the final report in the commit body: deploy order (migrate, backend, frontend), set env flags, publish n8n `0.2.0`, `zapier validate`, bump `@postsider/mcp` (already planned 1.2.0).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Verify names and dashes.**
```
GIT diff main...HEAD -U0 -- apps docs README.md libraries .env.example examples | grep '^+' | LC_ALL=en_US.UTF-8 grep -nP '[\x{2013}\x{2014}]'
grep -n "approvals:decide\|APPROVAL_EMAIL_LINKS\|POSTSIDER_MCP_ALLOW_APPROVAL_DECISIONS\|hooks.slack.com\|approval-flows" README.md docs/API-MCP-TRUST.md .env.example
```
Expected: the dash grep prints nothing; the second grep shows all five terms. (If `main` is not a local ref use `origin/main`.)
- [ ] **Step 3: Full verification.**
```
pnpm exec jest -c jest.config.ts --coverage=false
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --runInBand
pnpm run build:backend && pnpm run build:orchestrator
pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json
pnpm --filter ./apps/frontend run lint
DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp pnpm exec prisma migrate diff --from-url postgresql://postgres@localhost:55432/ps_cp --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma --exit-code
pnpm --filter ./apps/frontend run build
node --test examples/automation/zapier/test/map.test.js
( cd "/Users/lukasz/APP and DEV Project/PostSider _Project/n8n-nodes-postsider" && npm run verify )
```
Expected: all green (root suite larger than Phase 4's 1601 plus the new specs; MCP unchanged public tool list at 40 hosted). `next build` needs network for Google fonts: if it fails only on the font download, record that and rely on `tsc`. If a pre-existing unrelated root spec fails, confirm it fails identically on `origin/main` in a throwaway `git worktree` (never `git stash`) before ignoring it.
- [ ] **Step 4: End-to-end manual run against a real backend** (throwaway Postgres, backend and frontend running; set `APPROVAL_EMAIL_LINKS=true` and `EMAIL_PROVIDER` unset so the email is logged or captured by a stub). One organization with a two stage flow (Reviewer ADMIN, Owner SUPERADMIN, `preventSelfApproval` on) and a REQUIRE_APPROVAL rule on CONTAINS_LINK naming it. Steps: a key with `posts:write` creates a post with a link (policy routes it, approval has 2 stages); the key (without `approvals:decide`) tries to approve: 403; a second key with `approvals:decide` and SCHEDULE rights approves stage 1 only if its stage allows automation (it does not: 403 `not_allowed_for_stage`), then an ADMIN approves stage 1 in `/approval`; stage 2 email link: open GET, confirm it did not consume, post a decision without challenge (rejected), with challenge after 2 s (accepted); reuse the link (404 `link_invalid`); the SUPERADMIN who created the post is refused as `self_approval_blocked`; confirm the post is scheduled exactly once; confirm `GET /approval/pending` as a USER member has no token keys; confirm an old guest link created before the migration still resolves once; register a Slack-shaped URL with the webhook test endpoint against a local HTTPS capture is not possible (SSRF guard), so assert the Slack body in the delivery spec instead. Note anything that differs in the commit message.
- [ ] **Step 5: Commit**
```
GIT add README.md docs/API-MCP-TRUST.md .env.example apps/frontend/CHANGELOG.md
GIT commit -m "docs: approvals, flows, email links, Slack and automation; verification notes"
```

---

## Self-Review

- Spec coverage: R1 (Tasks 2, 5, 7, 11), R2.1 (Tasks 1, 3), R2.2 and R2.3 (Task 8, UI in Task 14), R3 (Tasks 1, 2, 4, 5, 6, UI in Task 15), R4 (Task 9), R5 (Task 10), R6 (Tasks 7, 13), R7 (Task 12), R8 (Tasks 14, 15), R9 (every task plus Task 16), R10 (Task 16, plus README text in Tasks 11 and 12 for their own packages). Dropped items (interactive Slack, reminders, stage webhook event, native n8n trigger, organization provisioning, hosted MCP deciding, CSV import gate) are listed in spec section 2.
- Type consistency: `StageDef`, `FlowRules`, `Decider`, `Origin`, `StageVerdict` (Task 2) are the only vocabulary used by `ApprovalService.decide` (Task 5), the link service (Task 8) and the public controller (Task 7); `ApprovalFlowService.resolveFlowForRules` (Task 4) is what `requestApproval` calls with the `ruleIds` the router passes (Task 6); `hashGuestToken` (Task 3) is the same SHA-256 hex the migration computes in SQL (Task 1); `hashLinkToken`/`makeChallenge` (Task 8) are used by the service and its controller spec; the `via` values appear in Task 5 (service), Task 7 (`API`), Task 8 (`EMAIL_LINK`), Task 3/5 (`GUEST`) and the activity allow-list; the response shape of `decide` (Task 5) is what Task 7 returns and Task 11 and 12 consume.
- Ordering hazard: Task 3 and Task 5 both edit `approval.repository.ts` and `approval.service.ts`; they are sequential (3 first). Tasks 6, 7, 8 touch disjoint files except the one-method override in `approval.service.ts` (Task 8) and the shared module files. Task 5 defines `onStageOpened` so Task 8 only fills it. Tasks 12 and 13 code against the spec contract, so they must re-check endpoint shapes against the merged Tasks 7 and 10 in their last step (a short diff of request builders against `public.approvals.controller.ts` and `public.customers.controller.ts`).
- Proportion: backend tasks carry signatures, rules and test assertions rather than bodies. The algorithmic pieces left to implementers are the conditional-update transaction in `decide`, the cursor encoding in `listForApi`, and the Slack escaping, each pinned by the tests above.
