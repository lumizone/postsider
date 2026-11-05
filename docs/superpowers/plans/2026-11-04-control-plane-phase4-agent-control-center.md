# Control Plane Phase 4: Agent Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give owners a dashboard page that shows what agents and integrations did and what needs a human (summary, filterable inbox, detail drawer with verified actor, claimed provenance, approval, policy outcome, previews and timeline), let them approve, reject, bulk resolve and safely retry from it, manage policy rules and per-key limits from Settings, and evaluate `USER` rules when a person saves a post in the dashboard.

**Architecture:** Read-side services in the shared library (a pure bucket/where/day module, an actor-name directory, a repository that pages post GROUPS with `groupBy`, a view mapper) behind a new session-authenticated `AgentActivityController`; actions reuse `ApprovalService`, `PostsService.retryFailedByGroup` and the Phase 3 gate; the dashboard posts controller calls the Phase 3 gate (plus one new `gateReschedule`) so `USER` rules apply; a dashboard `PoliciesController` fronts the Phase 3 rule service. The frontend adds `/agents` and `/settings/policies` in the existing CSS-variable style, with pure model modules unit tested by the root Jest run and a Playwright headless script for layout.

**Tech Stack:** NestJS, Prisma 6.5.0 (PostgreSQL), Jest 29 + ts-jest, class-validator; Next 15 / React 19 (CSS modules + inline styles, no Tailwind), the in-repo i18n catalogs, Playwright (Chromium) for visual checks.

**Spec:** `docs/superpowers/specs/2026-11-04-control-plane-phase4-agent-control-center.md` (read it first: verified facts, corrections to the decisions, the bucket table, exact response shapes and the English copy catalogue).

## Global Constraints

Every task implicitly includes these.

- Git binary: `/Library/Developer/CommandLineTools/usr/bin/git` (`/usr/bin/git` exits 69 on this host). In commands below `GIT` means that path. Work only in the worktree `postsider-wt-control-plane-p4` on branch `feat/control-plane-p4-agent-center` (stacked on `feat/control-plane-p3-policy`). Never push, never force, never `git stash` without a unique tag.
- Commit trailer on every commit message: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prisma: the only schema change is one index, shipped as a migration file under `libraries/nestjs-libraries/src/database/prisma/migrations/`. Never `db push`. Schema path: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (`SCHEMA` below).
- No em dashes or en dashes (U+2013, U+2014) in any added line: UI copy, API messages, docs, comments, i18n values. Use `-`, a colon or rewrite.
- Exact names. Routes: `/agent-activity` (`/summary`, `/filters`, `/groups/:group`, `/groups/:group/retry-failed`, `/approvals/bulk`), `/policies` (`/evaluate`). Page routes: `/agents`, `/settings/policies`. Buckets (row): `unknown_outcome blocked retryable failed_other review held scheduled draft published` (this is the group priority order). Filter buckets add `all attention failed`. Scopes: `relevant`, `automation`. i18n namespaces: `agentActivity`, `policies` (new), `nav.agents`, `settings.policies`, `settingsApi.*`, `createPost.policyBlocked`, `createPost.policyApprovalSent`. Limits: list `limit` 1 to 50 default 25; bulk 1 to 50 approvals; note at most 500; timeline at most 100; names cleaned to 80 characters; preview 240 characters; error text 500.
- Frontend calls only the dashboard API (`api.get/post/put/del` from `lib/api.ts`); it never calls `/public/v1`. The backend never returns `guestToken`, `guestTokenExpiresAt`, `ApiKey.key`, integration `token`/`refreshToken`, or an unsanitized HTML string for display.
- Decisions D7: no edit of `post.workflow.v1.0.*.ts`, `publicApiRetentionWorkflow`, providers, billing, public API controllers, scopes, webhooks or MCP. Phase 3 services are consumed as they are; the only addition to a Phase 3 file is `gateReschedule` (Task 8).
- Every DB query on tenant data includes `organizationId`. A foreign or unknown group, approval or rule id answers like an unknown one (404 or `skipped: not_found`), never 403 and never data.
- Brand: black and white, Apple-minimal, color only inside `PlatformIcon`. Status is conveyed by label plus shape or weight (filled, outline, dotted, struck), never color alone. `--danger*` tokens only for error banners and destructive confirms. Fonts come from the existing CSS variables (Inter, Changa One); add no font and no color token.
- Frontend conventions: reuse `ConfirmDialog`, `DatePicker`, `EmptyState`, `ChannelAvatar`, `PlatformIcon`, `PostPreviewPanel`, settings `Card`/`PageHeader`/`Switch`/`settingsStyles`; CSS module per component group; data loading with `useEffect` + `useState` + a cancellation flag; text from `useT()`; every task that adds UI adds its `en.ts` AND `pl.ts` keys in the same task (types require `en.ts`; Polish is required). Task 17 completes the other nine locales for the existing namespaces.
- Test commands (run from the worktree root): backend and pure specs `pnpm exec jest -c jest.config.ts <path> --coverage=false`; specs that import code touching `isomorphic-dompurify` start with `jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));`. Frontend specs are pure `.ts` files in `apps/frontend/src/lib` with RELATIVE imports only (the root run has no `@/` alias). Frontend typecheck: `pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json`. Backend build: `pnpm run build:backend`.
- Conventions: imports in libraries and backend use `@postsider/*` aliases; new optional dependencies use a trailing `@Optional() private _x?: T`; Prisma access goes through `PrismaRepository<'model'>`; pure modules import nothing from Nest, Prisma or React.

## Preconditions (run before Task 1)

Phase 3 must be implemented on this branch. Run and expect every line to print a match; if any is missing, stop and report (the signatures below are what this plan consumes):
```
grep -n "class PostPolicyGateService" -r libraries/nestjs-libraries/src
grep -n "preflightWrite\|finishCreate\|gateStatus\|gateRetry" libraries/nestjs-libraries/src/database/prisma/policies/post-policy-gate.service.ts
grep -n "class PolicyRulesService\|class PolicyEvaluationService\|class PolicyApprovalRouter" -r libraries/nestjs-libraries/src
grep -n "targetsFromDraftBody\|targetFromStoredPost\|evaluateTargets\|recordOutcome" libraries/nestjs-libraries/src/database/prisma/policies/policy-evaluation.service.ts
grep -n "export function checkKeyPermission" libraries/nestjs-libraries/src/policies/key-permissions.ts
grep -n "class PolicyBlockedException" -r libraries/nestjs-libraries/src
grep -n "allowedActions\|allowedIntegrationIds" libraries/nestjs-libraries/src/dtos/settings/create-api-key.dto.ts
grep -n "routeToApproval" libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts
grep -n "post.policy_evaluated" libraries/nestjs-libraries/src/database/prisma/audit/audit-events.ts
```
Also open `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` handlers `createPost`, `updatePost`, `retryFailedByGroup` and note the exact order of gate calls; Tasks 7 and 8 mirror them. If a Phase 3 signature differs from this plan, adapt the call and say so in the commit message.

## Review Focus

The failure modes the spec implies that a person is most likely to hit. Each has a test in the owning task.

1. `unknown_outcome` retry: it is never one click, never part of a bulk action, and the request carries `includeUnknownOutcome: true` only after the "I checked the platform" box is ticked; a plain "Retry failed" never re-arms an `unknown_outcome` row (Tasks 7, 13).
2. List correctness: legacy `ERROR` rows with a null category land in `failed_other` and are found by that bucket; two groups with the same `updatedAt` are neither duplicated nor skipped across pages; a group that changes (new group id after an edit) while the drawer is open shows "This post changed", not a crash (Tasks 2, 4, 12).
3. Roles on the server: a USER-role member calling bulk approve, bulk reject or retry directly gets 403 and nothing is touched; the buttons are also hidden for them (Tasks 7, 13).
4. Secrets and untrusted text: no `guestToken`, API key secret or channel token appears anywhere in any response; OAuth client names, claimed provenance, rule names and guest names are cleaned on the server and rendered as text only; a revoked key still shows its name with "(revoked)" (Tasks 3, 6, 12).
5. Bulk partial failure and double submit: one failing approval does not stop the others, a repeated call reports `already_resolved` and changes nothing, and the UI disables the actions while a request is in flight (Tasks 7, 13).
6. Dashboard policy path: a BLOCK on dashboard create writes nothing and the composer shows the rule names; REQUIRE_APPROVAL leaves a DRAFT with an approval and the user is told; `type: 'update'` is evaluated as a schedule; a drag reschedule is evaluated against the NEW date; drafts are only reported (Tasks 8, 16).

## File Structure

New files:
- `libraries/nestjs-libraries/src/database/prisma/migrations/20261104180000_agent_activity_post_index/migration.sql` - the index.
- `libraries/nestjs-libraries/src/database/prisma/schema.control-plane-agent-center.spec.ts` - guards the index.
- `libraries/nestjs-libraries/src/agent-activity/activity-buckets.ts`, `activity-where.ts`, `activity-day.ts`, `activity-cursor.ts`, `display-name.ts` (+ `.spec.ts` each) - pure.
- `libraries/nestjs-libraries/src/database/prisma/agent-activity/actor-directory.service.ts`, `agent-activity.repository.ts`, `agent-activity.view.ts`, `agent-activity.service.ts`, `agent-activity-actions.service.ts` (+ `.spec.ts` each).
- `libraries/nestjs-libraries/src/dtos/agent-activity/list-agent-activity.dto.ts`, `agent-activity-actions.dto.ts` (+ specs), `libraries/nestjs-libraries/src/dtos/policies/dashboard-evaluate-policy.dto.ts`.
- `libraries/nestjs-libraries/src/policies/dashboard-policy-type.ts` (+ spec).
- `apps/backend/src/api/routes/agent-activity.controller.ts` (+ `.http.spec.ts`), `policies.controller.ts` (+ `.http.spec.ts`), `posts.controller.policy.http.spec.ts`, `apps/backend/src/api/api.module.agent-center.spec.ts`.
- Frontend `lib` (pure unless noted): `agent-activity-api.ts` (thin fetchers), `agent-activity-filters.ts`, `agent-activity-model.ts`, `agent-text-diff.ts`, `agent-destination-channel.ts`, `calendar-deep-link.ts`, `policy-errors.ts`, `policies-api.ts` (thin), `policies-model.ts`, `key-permissions-model.ts` (+ `.spec.ts` each), `agent-center-i18n.spec.ts`.
- Frontend UI: `app/agents/page.tsx`, `components/agent-activity/` (`agent-activity-page.tsx`, `agent-summary-bar.tsx`, `agent-filters.tsx`, `agent-group-row.tsx`, `agent-group-drawer.tsx`, `agent-content-compare.tsx`, `agent-timeline.tsx`, `actor-label.tsx`, `agent-actions.tsx`, `retry-unknown-dialog.tsx`, `use-agent-activity.ts`, `agent-activity.module.css`), `app/settings/policies/page.tsx`, `components/policies/` (`policy-rule-form.tsx`, `policy-dry-run-panel.tsx`, `policies.module.css`), `components/policy-notice.tsx`.
- `apps/frontend/scripts/agent-center-fixtures.cjs`, `agent-center-check.cjs`.

Modified (main ones): `schema.prisma`, `database.module.ts`, `api.module.ts`, `posts.controller.ts`, `post-policy-gate.service.ts`, `dashboard-shell.tsx`, `settings-shell.tsx`, `calendar.tsx`, `posts.tsx`, `create-post-modal.tsx`, `lib/posts.ts`, `app/settings/api/page.tsx`, `lib/i18n/messages/*.ts`, `README.md`, `docs/API-MCP-TRUST.md`, `apps/frontend/CHANGELOG.md`.

Order note vs the suggested order: the index migration is Task 1 so every later query can be checked against it; the actor-name directory (Task 3) precedes the list because the list item already carries resolved actors; dashboard USER-rule gating (Task 8) and the policies API (Task 9) finish the backend before any UI so the frontend tasks only consume stable shapes; the composer feedback (Task 16) follows the policies page; the other nine locales (Task 17) come after every English and Polish key exists.

## Validating the Prisma migration without production

The throwaway Postgres on port 55432 database `ps_cp` is migrated through Phase 3 (32 migrations; if it is behind, `prisma migrate deploy` first).
1. `pg_isready -h localhost -p 55432` must say accepting connections. If not, start it: `LC_ALL=en_US.UTF-8 pg_ctl -D /private/tmp/claude-501/-Users-lukasz-APP-and-DEV-Project-PostSider--Project/418d9155-6f4d-4338-b135-fe3ba9262ba1/scratchpad/pgdata -o "-p 55432 -k /tmp/pgsock55432" -l /private/tmp/claude-501/-Users-lukasz-APP-and-DEV-Project-PostSider--Project/418d9155-6f4d-4338-b135-fe3ba9262ba1/scratchpad/pg.log start`.
2. `DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp pnpm exec prisma validate --schema $SCHEMA` must print `is valid`.
3. `pnpm exec prisma migrate deploy --schema $SCHEMA` applies only the new migration; `prisma migrate diff --from-url ... --to-schema-datamodel ... --exit-code` must exit 0 (no drift).
4. `pnpm exec prisma generate --schema $SCHEMA` regenerates the client.

---

### Task 1: Composite index on `Post` and query-plan evidence

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (`model Post` ~402, index list ~463)
- Create: `.../migrations/20261104180000_agent_activity_post_index/migration.sql`
- Test: `libraries/nestjs-libraries/src/database/prisma/schema.control-plane-agent-center.spec.ts`

**Interfaces:**
- Produces: `@@index([organizationId, state, updatedAt])` on `Post` (default name `Post_organizationId_state_updatedAt_idx`). No column changes.

- [ ] **Step 1: Write the failing test.** The spec reads `schema.prisma` and the migration as text: the `model Post {` block contains `@@index([organizationId, state, updatedAt])`; `migration.sql` exists and contains `Post_organizationId_state_updatedAt_idx` and no statement other than the single `CREATE INDEX`.
- [ ] **Step 2: Run it to verify it fails.** Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/schema.control-plane-agent-center.spec.ts --coverage=false`. Expected: FAIL (index missing).
- [ ] **Step 3: Edit `schema.prisma` and create the migration.** `migration.sql` is exactly one statement: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Post_organizationId_state_updatedAt_idx" ON "Post"("organizationId", "state", "updatedAt");` (a lone statement is not wrapped in a transaction by Prisma). Fallback: if `migrate deploy` in Step 4 fails with "cannot run inside a transaction block", remove `CONCURRENTLY`, keep the single statement, and add a one-line SQL comment that the build takes a short write lock on `Post`; say which variant shipped in the commit message.
- [ ] **Step 4: Validate and apply on the throwaway database.**
Run:
```
export DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp
SCHEMA=libraries/nestjs-libraries/src/database/prisma/schema.prisma
pnpm exec prisma validate --schema $SCHEMA
pnpm exec prisma migrate deploy --schema $SCHEMA
pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel $SCHEMA --exit-code
pnpm exec prisma generate --schema $SCHEMA
psql -h localhost -p 55432 -U postgres -d ps_cp -c '\d "Post"' | grep Post_organizationId_state_updatedAt_idx
```
Expected: `is valid`; the migration applies; the diff exits 0; the last command prints the index.
- [ ] **Step 5: Query-plan evidence.** In `psql`, `SET session_replication_role = replica;` (skips foreign keys), insert 200000 rows into `"Post"` with `generate_series` for one fake organization id, filling only the NOT NULL columns without defaults (`id, publishDate, organizationId, integrationId, content, group, updatedAt`; check `\d "Post"`), spread over states (about 1% `APPROVAL`, 2% `ERROR` with mixed `errorCategory`/`errorRetryable`, rest `PUBLISHED`/`QUEUE`), 40000 distinct `group` values, `updatedAt` spread over 90 days, then `ANALYZE "Post"`. Run `EXPLAIN (ANALYZE, BUFFERS)` for (a) the summary count `SELECT state,"errorCategory","errorRetryable",count(*) FROM "Post" WHERE "organizationId"=$org AND "deletedAt" IS NULL AND "parentPostId" IS NULL AND state IN ('APPROVAL','ERROR') GROUP BY 1,2,3`, (b) published today `... AND state='PUBLISHED' AND "updatedAt" >= now()-interval '1 day'`, (c) the list page `SELECT "group", max("updatedAt") m FROM "Post" WHERE "organizationId"=$org AND "deletedAt" IS NULL AND "parentPostId" IS NULL AND state IN ('APPROVAL','ERROR') GROUP BY "group" ORDER BY m DESC, "group" DESC LIMIT 26`. Expected: (a) and (b) use `Post_organizationId_state_updatedAt_idx` (index or bitmap scan, no sequential scan on `Post`); (c) report the plan. Delete the seeded rows afterwards (`DELETE FROM "Post" WHERE "organizationId"=$org`). Put the three plan summaries (node type and execution time) in the commit message body.
- [ ] **Step 6: Re-run the Step 2 command.** Expected: PASS.
- [ ] **Step 7: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/schema.prisma libraries/nestjs-libraries/src/database/prisma/migrations/20261104180000_agent_activity_post_index libraries/nestjs-libraries/src/database/prisma/schema.control-plane-agent-center.spec.ts
GIT commit -m "feat(db): org+state+updatedAt index on Post for the agent activity queries"
```

---

### Task 2: Pure activity modules: buckets, where builders, day bounds, cursor, names (TDD)

**Files:**
- Create: `libraries/nestjs-libraries/src/agent-activity/activity-buckets.ts`, `activity-where.ts`, `activity-day.ts`, `activity-cursor.ts`, `display-name.ts`
- Test: a `.spec.ts` next to each

**Interfaces:**
- Produces `activity-buckets.ts`:
```ts
export const ROW_BUCKETS = ['unknown_outcome','blocked','retryable','failed_other','review','held','scheduled','draft','published'] as const; // group priority, highest first
export type RowBucket = (typeof ROW_BUCKETS)[number];
export const ACTIVITY_BUCKETS = ['all','attention','failed','review','blocked','retryable','unknown_outcome','failed_other','published','scheduled','draft','held'] as const;
export type ActivityBucket = (typeof ACTIVITY_BUCKETS)[number];
export const AUTOMATION_ACTOR_TYPES = ['API_KEY','OAUTH_CLIENT'] as const;
export function bucketOfRow(row: { state: string; errorCategory?: string | null; errorRetryable?: boolean | null }): RowBucket; // spec section 4 R1 table
export function groupBucket(buckets: readonly RowBucket[]): RowBucket; // highest priority; throws on empty
export function expandBucket(b: ActivityBucket): RowBucket[]; // all -> nine; attention -> review, blocked, unknown_outcome, retryable, failed_other; failed -> unknown_outcome, retryable, failed_other
```
- Produces `activity-where.ts` (returns plain Prisma-shaped objects, no Prisma import):
```ts
export type PostWhere = Record<string, unknown>;
export type ActorFilter = { type: 'USER' | 'API_KEY' | 'OAUTH_CLIENT' | 'SYSTEM'; id: string | null };
export function parseActorFilter(raw: string): ActorFilter | null; // 'API_KEY:legacy' -> {API_KEY, null}; 'SYSTEM' -> {SYSTEM, null}; USER/OAUTH_CLIENT/API_KEY need a non-empty id <= 100 chars; anything else null
export function rowBucketWhere(b: RowBucket): PostWhere;
export function bucketWhere(b: ActivityBucket): PostWhere | null; // null for 'all'; OR of rowBucketWhere for expanded buckets
export function scopeWhere(scope: 'relevant' | 'automation'): PostWhere;
export function actorWhere(a: ActorFilter): PostWhere; // createdBy OR lastModifiedBy; API_KEY with id null -> apiKeyId null
export type ActivityFilters = { bucket: ActivityBucket; scope: 'relevant' | 'automation'; integrationIds?: string[]; actor?: ActorFilter; agentName?: string; source?: string; from?: Date; to?: Date };
export function buildActivityWhere(orgId: string, f: ActivityFilters): PostWhere; // AND of organizationId, deletedAt null, parentPostId null, integration { deletedAt: null }, scope, bucket, integrationId in, actor, agentName, source, updatedAt range
```
- Produces `activity-day.ts`: `isValidTimeZone(tz: unknown): tz is string`; `resolveTimeZone(requested?: string | null, orgDefault?: string | null): string` (requested if valid, else orgDefault if valid, else `'UTC'`); `dayBounds(now: Date, timeZone: string): { start: Date; end: Date }` (UTC instants of local midnight and next local midnight).
- Produces `activity-cursor.ts`: `encodeGroupCursor(c: { updatedAt: Date; group: string }): string` (base64url JSON `{t, g}`); `decodeGroupCursor(s: string): { updatedAt: Date; group: string } | null` (null for anything malformed, empty or oversized group).
- Produces `display-name.ts`: `cleanDisplayName(raw: unknown, max = 80): string | null` (strings only, strips `U+0000-U+001F` and `U+007F-U+009F`, collapses whitespace, trims, cuts to `max`, empty -> null).

- [ ] **Step 1: Write the failing tests.**
  - `activity-buckets.spec.ts`: every row of the spec table, including `{state:'ERROR', errorCategory:null, errorRetryable:null}` -> `failed_other` (legacy), `{ERROR, UNKNOWN, true}` -> `retryable`, `{ERROR, POLICY_BLOCKED, true}` -> `blocked` (category wins over the flag), `{ERROR, UNKNOWN_OUTCOME, false}` -> `unknown_outcome`; `groupBucket(['published','retryable','review'])` -> `retryable`, `groupBucket(['review','blocked'])` -> `blocked`, `groupBucket(['unknown_outcome','blocked'])` -> `unknown_outcome`; empty throws; `expandBucket` sets as listed; `ROW_BUCKETS` has nine unique entries.
  - `activity-where.spec.ts`: define in the spec a small `evalWhere(row, where)` supporting `state` (string or `{in}`), `errorCategory` (`null`, string, `{in}`, `{notIn}`), `errorRetryable` (`true`, `false`, `null`), `OR`, `AND`, `NOT`. Parity test: for `state` in the six states x `errorCategory` in `[null,'POLICY_BLOCKED','UNKNOWN_OUTCOME','RATE_LIMITED','UNKNOWN']` x `errorRetryable` in `[null,true,false]`, for each `RowBucket b`: `evalWhere(row, rowBucketWhere(b)) === (bucketOfRow(row) === b)`; and for every `ActivityBucket`: `bucketWhere` matches exactly the rows whose bucket is in `expandBucket`. `failed_other` where must treat null category and null/false retryable explicitly (`notIn` alone would drop nulls: the parity test proves it). `parseActorFilter`: valid forms, `'API_KEY:legacy'`, invalid (`'ROOT:1'`, `'USER:'`, 101 chars) -> null. `buildActivityWhere('org-1', ...)` always contains `organizationId: 'org-1'`, `deletedAt: null`, `parentPostId: null`; `scope automation` is an OR over createdByType and lastModifiedByType in `AUTOMATION_ACTOR_TYPES`; `scope relevant` additionally ORs `state in (APPROVAL, ERROR)`; an `API_KEY` actor with a key id matches `createdByApiKeyId` or `lastModifiedByApiKeyId`; empty `integrationIds` adds no clause.
  - `activity-day.spec.ts`: `dayBounds(2026-03-29T12:00:00Z, 'Europe/Warsaw')` = `{2026-03-28T23:00:00Z, 2026-03-29T22:00:00Z}` (23 hour day); `dayBounds(2026-10-25T12:00:00Z, 'Europe/Warsaw')` = `{2026-10-24T22:00:00Z, 2026-10-25T23:00:00Z}` (25 hours); `2026-07-01T23:30:00Z` in Warsaw belongs to 2026-07-02 local; `'UTC'`; `'America/New_York'` on 2026-11-01 (25 hours). `isValidTimeZone('Mars/Base')` false, `''` false, `undefined` false. `resolveTimeZone('bad', 'Europe/Warsaw')` -> `'Europe/Warsaw'`, `('bad', null)` -> `'UTC'`, `('Asia/Tokyo', 'Europe/Warsaw')` -> `'Asia/Tokyo'`.
  - `activity-cursor.spec.ts`: round trip keeps the millisecond; `decodeGroupCursor('%%%')`, a valid base64 of non-JSON, a JSON with a bad date, an empty group and a 101 character group all -> null.
  - `display-name.spec.ts`: `'  Claude\u0000\n Desktop '` -> `'Claude Desktop'`; 120 chars -> 80; `'\u0007\u0008'` -> null; number input -> null.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/agent-activity --coverage=false`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement the five modules** per the Interfaces block. Use `Intl.DateTimeFormat` parts for local date and offset in `dayBounds` (find local midnight by correcting the UTC guess with the zone offset at that instant, so DST days are 23 or 25 hours).
- [ ] **Step 4: Re-run the Step 2 command.** Expected: PASS.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/agent-activity
GIT commit -m "feat(agent-activity): pure buckets, where builders, day bounds, cursor and name cleaning"
```

---

### Task 3: Actor directory (verified actor display names)

**Files:**
- Create: `libraries/nestjs-libraries/src/database/prisma/agent-activity/actor-directory.service.ts` (+ spec)
- Modify: `libraries/nestjs-libraries/src/database/prisma/database.module.ts` (providers)

**Interfaces:**
- Consumes: `ActorView` (`@postsider/nestjs-libraries/actor/post-actor`), `cleanDisplayName` (Task 2).
- Produces:
```ts
export type ActorDisplay = { type: 'USER'|'API_KEY'|'OAUTH_CLIENT'|'SYSTEM'; id: string | null; name: string | null; state: 'ok'|'revoked'|'unknown'|'legacy'; authorizedBy: string | null };
export type ActorResolver = (view: ActorView | null | undefined) => ActorDisplay | null;
@Injectable() export class ActorDirectoryService {
  constructor(_members: PrismaRepository<'userOrganization'>, _apiKeys: PrismaRepository<'apiKey'>, _mcpClients: PrismaRepository<'mcpOAuthClient'>, _oauthApps: PrismaRepository<'oAuthApp'>)
  resolve(orgId: string, views: ReadonlyArray<ActorView | null | undefined>): Promise<ActorResolver>;
}
```
Rules: `id` is the api key id, oauth client id or user id of the view; `USER` name = `name` (+ `lastName`) else email, from members of THIS organization only (a user who left -> `unknown`); `API_KEY` with null id -> `state 'legacy'`, name null; soft deleted key -> `revoked` with its name; unknown id -> `unknown`, name null; `OAUTH_CLIENT`: look the id up in `McpOAuthClient` and in `OAuthApp` (the latter filtered by `organizationId`), and when the view has a `userId`, `authorizedBy` is that member's name; `SYSTEM` -> name null, state `ok`. Names pass through `cleanDisplayName`. One query per table at most per `resolve` call, only when ids exist; ids deduplicated.

- [ ] **Step 1: Write the failing test** `actor-directory.service.spec.ts` with mocked repositories: (a) a mixed list of 6 views issues exactly one `findMany` per table with deduplicated `in` lists and none for empty lists; (b) the `userOrganization`, `apiKey` and `oAuthApp` calls carry `organizationId: 'org-1'`; the `apiKey` query `select` has no `key` property; (c) revoked key -> `{ state: 'revoked', name: 'ci' }`; unknown ids -> `unknown`; legacy; (d) OAuth view with `userId` -> `authorizedBy` is that user's name, and a name containing control characters is cleaned; (e) a user not in the member list -> `unknown`; (f) `resolver(null)` -> `null`; (g) a name of 200 characters is cut to 80.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/agent-activity/actor-directory.service.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** the service and register it in `database.module.ts` providers.
- [ ] **Step 4: Re-run the Step 2 command.** Expected: PASS.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/agent-activity libraries/nestjs-libraries/src/database/prisma/database.module.ts
GIT commit -m "feat(agent-activity): batched actor display names without leaking secrets"
```

---

### Task 4: Repository and service: summary, list, filters

**Files:**
- Create: `.../agent-activity/agent-activity.repository.ts`, `agent-activity.view.ts`, `agent-activity.service.ts` (+ `.spec.ts` each), `libraries/nestjs-libraries/src/dtos/agent-activity/list-agent-activity.dto.ts` (+ spec)
- Modify: `database.module.ts` (providers: `AgentActivityRepository`, `AgentActivityService`)

**Interfaces:**
- Consumes: Task 2 modules, `ActorDirectoryService` (Task 3), `actorViewFromColumns` (Phase 2), `stripHtmlValidation` from `@postsider/helpers/utils/strip.html.validation` (`('none', html)` gives plain text).
- Produces `ListAgentActivityDto` (class-validator, query): `bucket?` (IsIn `ACTIVITY_BUCKETS`, default `'attention'`), `scope?` (`'relevant'|'automation'`, default `'relevant'`), `integrationIds?: string[]` (comma separated string transformed, at most 20), `actor?: string`, `agentName?: string` (max 255), `source?: string` (max 255), `from?`, `to?` (ISO 8601 strings), `limit?` (1 to 50, default 25, transformed from string), `cursor?: string`.
- Produces `AgentActivityRepository`:
```ts
pageGroups(orgId: string, where: PostWhere, cursor: { updatedAt: Date; group: string } | null, take: number): Promise<Array<{ group: string; updatedAt: Date }>>; // groupBy by ['group'], _max.updatedAt, orderBy [{_max:{updatedAt:'desc'}},{group:'desc'}], having for the cursor, take
rowsForGroups(orgId: string, groups: string[]): Promise<ActivityRow[]>; // top-level, not deleted, explicit select (see ActivityRow), one findMany
pendingApprovalIds(orgId: string, postIds: string[]): Promise<Array<{ id: string; postId: string }>>; // status PENDING, select id and postId only
openCounts(orgId: string): Promise<Array<{ state: string; errorCategory: string | null; errorRetryable: boolean | null; count: number }>>; // groupBy state/errorCategory/errorRetryable for state in APPROVAL, ERROR
publishedCount(orgId: string, range: { start: Date; end: Date }): Promise<number>; // PUBLISHED, top-level, not deleted, updatedAt in range, createdByType in AUTOMATION_ACTOR_TYPES
automationActionCount(orgId: string, range: { start: Date; end: Date }): Promise<number>; // auditLog.count: organizationId, type 'resource', actorType in AUTOMATION_ACTOR_TYPES, createdAt in range
recentActors(orgId: string, since: Date): Promise<ActorView[]>; // distinct createdBy and lastModifiedBy automation identities over top-level rows since, most recent first, at most 50
recentProvenance(orgId: string, since: Date): Promise<{ agentNames: string[]; sources: string[] }>; // distinct non-null values, at most 50 each
```
`ActivityRow` select: `id group state publishDate updatedAt content image error errorCategory errorRetryable publishAttempts releaseId releaseURL integrationId` + the 8 actor columns + the 5 provenance columns + `integration { id name providerIdentifier picture }`. Never select `settings` secrets beyond what is listed.
- Produces `agent-activity.view.ts` (pure): `toGroupSummary(rows: ActivityRow[], resolve: ActorResolver, pendingIds: string[]): GroupSummary` (shape in the spec R1.2: `bucket = groupBucket`, `updatedAt` = max row `updatedAt`, `contentPreview` = plain text of the first destination cut to 240, `canRetry` = some destination bucket in `retryable|unknown_outcome|failed_other` whose `releaseId` is null or `'missing'`, `createdBy`/`lastModifiedBy` from the first destination, `claimed` all five provenance keys with nulls kept).
- Produces `AgentActivityService`:
```ts
summary(orgId: string, opts: { timezone?: string | null; orgDefaultTimezone?: string | null; now?: Date }): Promise<ActivitySummary>;
list(orgId: string, q: ParsedActivityQuery): Promise<{ groups: GroupSummary[]; nextCursor: string | null }>; // ParsedActivityQuery = ActivityFilters + { limit: number; cursor?: string }; invalid cursor/actor, from > to -> BadRequestException
filters(orgId: string, now?: Date): Promise<ActivityFilterOptions>; // actors with key `${type}:${id ?? 'legacy'}`, agentNames, sources, 90 day window
```
`ActivitySummary` is exactly the spec R1.1 shape. `failed.total = retryable + unknownOutcome + other`.

- [ ] **Step 1: Write the failing tests.**
  - `list-agent-activity.dto.spec.ts` (with `class-transformer` + `validate`): defaults (`bucket attention`, `scope relevant`, `limit 25`); `limit` `'0'` and `'51'` invalid; `integrationIds` `'a,b, ,c'` -> `['a','b','c']`, 21 entries invalid; `bucket: 'nope'` invalid; `agentName` of 256 chars invalid; `from: 'yesterday'` invalid.
  - `agent-activity.repository.spec.ts` (mocked `PrismaRepository`): `pageGroups` calls `post.groupBy` once with `by: ['group']`, the passed `where` (which carries the org), `orderBy` exactly `[{ _max: { updatedAt: 'desc' } }, { group: 'desc' }]`, `take`; with a cursor `having` is an OR of `updatedAt._max lt t` and (`updatedAt._max equals t` AND `group lt g`); without a cursor no `having`. `rowsForGroups` queries `organizationId`, `parentPostId: null`, `deletedAt: null`, `group: { in }` and its `select` contains no `settings`, `token` or `key`. `pendingApprovalIds` selects only `id, postId` with `status: 'PENDING'` and the org. `automationActionCount` uses `type: 'resource'` and the automation actor types. `publishedCount` filters `createdByType in` automation types.
  - `agent-activity.view.spec.ts`: bucket priority across destinations; `canRetry` false when a failed destination has a real `releaseId` and true for `'missing'`; preview is plain text (`'<p>Hi <b>there</b></p>'` -> `'Hi there'`) and cut at 240; `claimed` has five keys even when all null; `pendingApprovalIds` passed through; actors come from the resolver (`null` when the columns are null).
  - `agent-activity.service.spec.ts`: `summary` reduces `openCounts` rows through `bucketOfRow` (rows: APPROVAL x3, ERROR/POLICY_BLOCKED x1, ERROR/UNKNOWN_OUTCOME x2, ERROR/RATE_LIMITED/true x4, ERROR/null/null x5 -> `waitingForReview 3, policyBlocked 1, failed { total 11, retryable 4, unknownOutcome 2, other 5 }`), passes day bounds computed from `now` and the resolved zone (`'bad'` -> org default -> `UTC`, no throw), `actionsToday` and `publishedToday` from the repository. `list` builds the where with `buildActivityWhere`, requests `limit + 1` groups, returns `nextCursor` (decodable) only when more than `limit` came back, fetches rows once for exactly the page groups, keeps the group order, resolves actors with one `resolve` call, and two groups with the same `updatedAt` keep the `group desc` order; bad cursor, bad actor and `from > to` -> `BadRequestException`. `filters` returns actor keys `API_KEY:legacy` for a null key id, resolved names, and the 90 day `since`.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/agent-activity libraries/nestjs-libraries/src/dtos/agent-activity --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** the DTO, repository, view and service; register the two providers. `recentActors` can use two `groupBy` calls (createdBy and lastModifiedBy columns) merged and ordered by max `updatedAt`.
- [ ] **Step 4: Re-run the Step 2 command.** Expected: PASS.
- [ ] **Step 5: Real-database check.** Seed the throwaway database as in Task 1 Step 5 (but 30 groups, several with identical `updatedAt`, mixed states), then run a Node script (`pnpm exec ts-node -T` or `node -r ts-node/register`, outside the repo tree) that builds a `PrismaClient` for `ps_cp`, calls `pageGroups` page by page with `take = 6` and asserts every group appears exactly once in order, then deletes the seed. Expected: no duplicate, no skipped group, order is `max(updatedAt) desc, group desc`. If Prisma rejects the `having` shape, change it to the nearest accepted form and keep the unit test in step.
- [ ] **Step 6: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/agent-activity libraries/nestjs-libraries/src/dtos/agent-activity libraries/nestjs-libraries/src/database/prisma/database.module.ts
GIT commit -m "feat(agent-activity): summary, group list and filter options services"
```

---

### Task 5: Dashboard controller: summary, list, filters

**Files:**
- Create: `apps/backend/src/api/routes/agent-activity.controller.ts`, `agent-activity.controller.http.spec.ts`, `apps/backend/src/api/api.module.agent-center.spec.ts`
- Modify: `apps/backend/src/api/api.module.ts` (import and add to `authenticatedController`)

**Interfaces:**
- Consumes: `AgentActivityService` (Task 4).
- Produces routes on `@Controller('/agent-activity')`: `GET /summary?timezone=` -> `ActivitySummary` (passes `(org as any).defaultTimezone` as `orgDefaultTimezone`); `GET /` with `ListAgentActivityDto` -> `{ groups, nextCursor }` (the controller converts `from`/`to` to `Date`); `GET /filters` -> `ActivityFilterOptions`. No `@CheckPolicies` on reads (every member). Route order: declare `/summary` and `/filters` before `/groups/:group` (Task 6).

- [ ] **Step 1: Write the failing tests.**
  - `agent-activity.controller.http.spec.ts` (harness of `public.retry-failed.http.spec.ts`; middleware sets `req.org = { id: 'org-1', defaultTimezone: 'Europe/Warsaw', users: [{ role: 'USER' }] }`): `GET /agent-activity/summary?timezone=Asia/Tokyo` calls the service with `('org-1', { timezone: 'Asia/Tokyo', orgDefaultTimezone: 'Europe/Warsaw' })` and returns its body; a USER-role caller gets 200 (reads are for every member); `GET /agent-activity?bucket=blocked&integrationIds=a,b&limit=10` passes parsed filters (`integrationIds ['a','b']`, `limit 10`, `scope 'relevant'`); `limit=0`, `limit=51`, `bucket=nope`, `integrationIds` with 21 entries, `from=garbage` -> 400 and the service is not called; the service's `BadRequestException` surfaces as 400; `GET /agent-activity/filters` returns the service result; no query or body can change the organization (the service always receives `'org-1'`).
  - `api.module.agent-center.spec.ts`: `Reflect.getMetadata('controllers', ApiModule)` contains `AgentActivityController`; calling `new ApiModule().configure(fakeConsumer)` with a consumer recording `forRoutes` arguments shows `AgentActivityController` among the routes of both `CsrfMiddleware` and `AuthMiddleware`.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/backend/src/api --coverage=false -t "agent"` (or the two files by path). Expected: FAIL.
- [ ] **Step 3: Implement the controller and register it** in `api.module.ts` (`authenticatedController` array and import).
- [ ] **Step 4: Re-run the Step 2 command.** Expected: PASS. Then `pnpm run build:backend`. Expected: exit 0.
- [ ] **Step 5: Commit**
```
GIT add apps/backend/src/api
GIT commit -m "feat(api): dashboard routes for agent activity summary, list and filters"
```

---

### Task 6: Group detail endpoint

**Files:**
- Modify: `agent-activity.repository.ts` (+ spec), `agent-activity.service.ts` (+ spec), `agent-activity.view.ts` (+ spec), `agent-activity.controller.ts` (+ http spec)

**Interfaces:**
- Consumes: `AuditEventsService.list(orgId, { targetType: 'post', targetIds, limit: 100 })`, `PostsRepository.getPostIdsInGroupIncludingDeleted(orgId, postId)`, `approvalDecidedByView` (Phase 2), `PolicyEvaluationService` (Phase 3, `@Optional()`), `ActorDirectoryService`.
- Produces repository methods: `detailRows(orgId, group): Promise<DetailRow[]>` (top-level, not deleted; `ActivityRow` fields plus `lastPublishAttemptAt`), `childRows(orgId, parentIds): Promise<Array<{ parentPostId: string; content: string; createdAt: Date }>>`, `approvalsFor(orgId, postIds): Promise<ApprovalRow[]>` with an explicit select `id postId status note requestedAt resolvedAt requestedByType requestedByUserId requestedByApiKeyId requestedByOAuthClientId decidedByType approverId guestName guestEmail` (never `guestToken`, `guestTokenExpiresAt`), `firstCommentFor` is read from the row (`firstComment` in the select).
- Produces `AgentActivityService.detail(orgId: string, group: string): Promise<ActivityDetail>` and `GET /agent-activity/groups/:group`. Shape: spec R2 (`destinations`, `policy { recorded, current }`, `timeline`). `policy.recorded` is parsed from the newest `post.policy_evaluated` timeline event (`metadata.effect`, `metadata.phase`, `metadata.ruleNames` split on ` | `, `metadata.matchedCount`). `policy.current` calls `PolicyEvaluationService.targetFromStoredPost(orgId, postId, { action: 'SCHEDULE', approved })` for each destination in state `QUEUE DRAFT APPROVAL ERROR HELD`, then `evaluateTargets(orgId, targets, 'publish')`; any throw or a missing service gives `null`. Timeline actors use the resolver; a guest decision (`metadata.by === 'guest'` -> actor type `GUEST`) has no name.

- [ ] **Step 1: Write the failing tests.**
  - Repository spec: `detailRows` and `childRows` carry `organizationId`; `approvalsFor` select has no `guestToken`/`guestTokenExpiresAt` keys.
  - Service spec: unknown group (no rows) -> `NotFoundException('Group not found')`; destinations carry `contentText` (HTML stripped), `thread` in creation order, `errorMessage` cut to 500, `image` raw, `approval` with `requestedBy` resolved, `decidedBy` as an `ActorDisplay` for `decidedByType USER` and `{ type: 'GUEST', name, email }` for a guest; `JSON.stringify(result)` contains neither `guestToken` nor `token`; the timeline is requested with the ids from `getPostIdsInGroupIncludingDeleted` and `limit: 100`, items are mapped with resolved actors, a guest event gets `{ type: 'GUEST' }`; `policy.recorded` parsed from a sample event (`ruleNames: 'No links | Night window'` -> two names) and `null` without one; `policy.current` built from the mocked Phase 3 service with `approved: true` only for an `APPROVED` approval, `null` when the service is absent, when it throws (the detail still resolves), and when every destination is `PUBLISHED`; revoked key actor keeps its name.
  - Controller http spec: `GET /agent-activity/groups/g1` -> 200 with the service body for a USER-role member; service `NotFoundException` -> 404 with the same body for unknown and foreign groups; the service always receives `'org-1'`.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/agent-activity apps/backend/src/api/routes/agent-activity.controller.http.spec.ts --coverage=false`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** repository methods, `detail` (batch every lookup: one `detailRows`, one `childRows`, one `approvalsFor`, one timeline call, one resolver), the view mappers and the route.
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/agent-activity apps/backend/src/api/routes
GIT commit -m "feat(agent-activity): group detail with approval, policy outcome and audit timeline"
```

---

### Task 7: Bulk approve/reject and dashboard retry-failed

**Files:**
- Create: `.../agent-activity/agent-activity-actions.service.ts` (+ spec), `libraries/nestjs-libraries/src/dtos/agent-activity/agent-activity-actions.dto.ts` (+ spec)
- Modify: `agent-activity.controller.ts` (+ http spec), `database.module.ts`

**Interfaces:**
- Consumes: `ApprovalService.approve/reject(orgId, approvalId, userId, role[, note])`, `ApprovalRepository.getById(orgId, id)`, `assertCanApprove` (`approval.rules.ts`), `PostsService.retryFailedByGroup`, `PostPolicyGateService.gateRetry`, `PolicyApprovalRouter.route`.
- Produces DTOs: `BulkApprovalsDto { action: 'approve'|'reject'; approvalIds: string[] (1..50, distinct strings); note?: string (<= 500) }`, `RetryFailedDto { includeUnknownOutcome?: boolean }`.
- Produces:
```ts
type BulkItemResult = { approvalId: string; postId: string | null; status: 'done'|'skipped'|'failed'; reason?: 'already_resolved'|'not_found'|'error'; message?: string };
bulkResolve(orgId: string, userId: string, role: string, body: BulkApprovalsDto): Promise<{ results: BulkItemResult[]; summary: { done: number; skipped: number; failed: number } }>;
retryFailed(orgId: string, group: string, opts: { includeUnknownOutcome: boolean }): Promise<{ group: string; results: RetryFailedResult[]; policy: unknown }>;
```
- Routes (both `@CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])`): `POST /agent-activity/approvals/bulk` (body `BulkApprovalsDto`), `POST /agent-activity/groups/:group/retry-failed` (body `RetryFailedDto`, default `includeUnknownOutcome` false).
- `bulkResolve`: `assertCanApprove(role)` FIRST (403, nothing touched); then per id, in order: `getById` null -> `skipped/not_found`; call approve or reject; `BadRequestException` whose message includes `already been resolved` -> `skipped/already_resolved`; `NotFoundException` -> `skipped/not_found`; any other error -> `failed/error` with the exception message cut to 200 (non-Http errors: `'Unexpected error'`, logged); the loop never aborts. `retryFailed`: mirror the Phase 3 public handler exactly (read it first): `gateRetry(orgId, group, { includeUnknownOutcome })`, then `retryFailedByGroup(orgId, group, { includeUnknownOutcome, routeToApproval })` where `routeToApproval(postId)` routes through `PolicyApprovalRouter.route(orgId, postId, { terminateWorkflow: false })` only for ids in the gate's approval set; the result gains `policy` (the gate outcome). `PolicyBlockedException` propagates untouched.

- [ ] **Step 1: Write the failing tests.**
  - DTO spec: 0 and 51 ids invalid, duplicate ids invalid, note of 501 chars invalid, `action: 'delete'` invalid; `RetryFailedDto` rejects a non-boolean.
  - Service spec: a USER role -> `ForbiddenException` and `approve` never called; mixed batch `[ok, alreadyResolved, foreign (getById null), boom]` yields `done, skipped/already_resolved, skipped/not_found, failed/error` and `summary { 1,2,1 }` and ALL four were attempted; reject passes the note and approve does not; a second identical call reports every previously done id as `already_resolved`; the same org always (`getById('org-1', ...)`); retry: sequence order (`gateRetry` before `retryFailedByGroup`), `includeUnknownOutcome` forwarded verbatim (false by default), a `PolicyBlockedException` from the gate propagates and `retryFailedByGroup` is not called, `routeToApproval` returns false for ids outside the gate set, the result includes `policy`.
  - Controller http spec: both routes carry the admin `CHECK_POLICIES_KEY` metadata (assert like `webhooks.controller.spec.ts`); a body with 51 ids -> 400; `retry-failed` with `{ includeUnknownOutcome: 'yes' }` -> 400; a service 404 -> 404; the controller passes `req.user.id` and the caller role from `org.users[0].role`.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/agent-activity/agent-activity-actions.service.spec.ts libraries/nestjs-libraries/src/dtos/agent-activity apps/backend/src/api/routes/agent-activity.controller.http.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** DTOs, service, routes; provide the service in `database.module.ts`.
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src/api/routes
GIT commit -m "feat(agent-activity): bulk approve/reject and dashboard retry of failed destinations"
```

---

### Task 8: Dashboard write-time evaluation of USER rules

**Files:**
- Create: `libraries/nestjs-libraries/src/policies/dashboard-policy-type.ts` (+ spec), `apps/backend/src/api/routes/posts.controller.policy.http.spec.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/policies/post-policy-gate.service.ts` (+ its spec), `apps/backend/src/api/routes/posts.controller.ts` (`createPost` ~273, `changeDate` ~330)

**Interfaces:**
- Consumes: `PostPolicyGateService.preflightWrite/finishCreate`, `PolicyEvaluationService.targetFromStoredPost/evaluateTargets/recordOutcome`, `PolicyApprovalRouter.route`, `PolicyBlockedException`, `actorFromUser` (Phase 2), `ApprovalService.getForPost`.
- Produces `dashboardPolicyType(type: unknown): 'draft'|'schedule'|'now'` (`'draft'`->draft, `'now'`->now, `'schedule'` and `'update'` -> schedule, anything else -> schedule).
- Produces on the gate: `gateReschedule(orgId: string, postId: string, date: string, actor: PostActor): Promise<{ proceed: boolean; policy: PolicyOutcome; approvalRequested: boolean }>`: load the stored target with `targetFromStoredPost(orgId, postId, { action: 'SCHEDULE', approved })` (`approved` true when the post's approval is `APPROVED`; missing post -> `NotFoundException`), override `scheduledAt` with `new Date(date)` and `actors` with `[actorView(actor)]` plus the stored actors, evaluate with phase `'write'`, `recordOutcome` (non-ALLOW), BLOCK -> throw `PolicyBlockedException`, REQUIRE_APPROVAL -> `PolicyApprovalRouter.route(orgId, postId, { terminateWorkflow: true })` and `{ proceed: false, approvalRequested: true }`, otherwise `{ proceed: true, approvalRequested: false }`.
- Dashboard wiring: `PostsController` gets a trailing `@Optional() private _gate?: PostPolicyGateService`. `createPost`: after the existing validation and `mapTypeToPost`, `const gateBody = { ...body, type: dashboardPolicyType(body.type) }; const pre = await gate.preflightWrite(org.id, gateBody, actorFromUser(user)); const created = await createPost(org.id, body, 'WEB', { forceDraftIntegrationIds: pre.approvalIntegrationIds }); return gate.finishCreate(org.id, created, pre);` (mirror the Phase 3 public `createPost`/`updatePost` handlers for the edit-of-QUEUE case). `changeDate`: when `action === 'schedule'` call `gateReschedule` first; if `!proceed` return `{ approvalRequested: true, policy }` without `changeDate`; `action === 'update'` is never gated. When `_gate` is undefined the controller behaves as today (production DI always provides it).

- [ ] **Step 1: Write the failing tests.**
  - `dashboard-policy-type.spec.ts`: the mapping table above, plus `undefined` and `42` -> `'schedule'`.
  - Gate spec (extend): `gateReschedule` BLOCK throws and records; REQUIRE_APPROVAL routes with `terminateWorkflow: true` and returns `proceed false`; ALLOW proceeds; the target passed to `evaluateTargets` has `scheduledAt` equal to the NEW date (an `OUTSIDE_WINDOW`-style mock evaluator that inspects it); an APPROVED approval makes `approved: true`; unknown post -> `NotFoundException`; the phase is `'write'`.
  - `posts.controller.policy.http.spec.ts` (harness as in `public.retry-failed.http.spec.ts`, middleware sets `req.org` and `req.user = { id: 'u1' }`; mock `PostsService`, the gate): create with `type: 'update'` calls `preflightWrite` with `type: 'schedule'` and an actor `{ type: 'USER', userId: 'u1' }`; preflight BLOCK -> 422 with `error: 'policy_blocked'` and the matched rule names, `createPost` never called; REQUIRE_APPROVAL -> `createPost` called with `forceDraftIntegrationIds` equal to the gate's set and the response elements carry `approvalRequested: true`; `type: 'draft'` still calls `preflightWrite` and passes through; existing validation errors (400) happen before the gate; `PUT /posts/p1/date` with `action: 'schedule'`: BLOCK -> 422, `changeDate` not called; REQUIRE_APPROVAL -> 200 `{ approvalRequested: true }`, `changeDate` not called; ALLOW -> `changeDate` called once; `action: 'update'` -> gate not called.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/policies/dashboard-policy-type.spec.ts libraries/nestjs-libraries/src/database/prisma/policies apps/backend/src/api/routes/posts.controller.policy.http.spec.ts --coverage=false`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the helper, `gateReschedule` and the controller wiring. Existing `posts.controller` specs must still pass.
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm exec jest -c jest.config.ts apps/backend/src/api --coverage=false` and `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/policies libraries/nestjs-libraries/src/database/prisma/policies apps/backend/src/api/routes
GIT commit -m "feat(posts): evaluate USER policy rules on dashboard create, edit and reschedule"
```

---

### Task 9: Dashboard policies API and dry run

**Files:**
- Create: `apps/backend/src/api/routes/policies.controller.ts`, `policies.controller.http.spec.ts`, `libraries/nestjs-libraries/src/dtos/policies/dashboard-evaluate-policy.dto.ts` (+ spec)
- Modify: `apps/backend/src/api/api.module.ts` (register in `authenticatedController`), `api.module.agent-center.spec.ts` (add the controller)

**Interfaces:**
- Consumes: `PolicyRulesService` (`list`, `create`, `update`, `remove`, `toPublicRule`, DTOs `CreatePolicyRuleDto`/`UpdatePolicyRuleDto`), `PolicyEvaluationService.targetsFromDraftBody/evaluateTargets`, `checkKeyPermission`, `OrganizationService.listApiKeys(orgId)` (rows now include `allowedActions`, `allowedIntegrationIds`), `AuditLogger.logSecurityEvent`, `actorFromUser`.
- Produces `DashboardEvaluatePolicyDto extends EvaluatePolicyDto { asActor?: { type: 'USER'|'API_KEY'|'OAUTH_CLIENT'|'SYSTEM'; apiKeyId?: string } }` (validated nested object; `apiKeyId` only with `API_KEY`).
- Routes on `@Controller('/policies')`, ALL `@CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])`: `GET /` -> `{ policies: PublicPolicyRule[] }`; `POST /` (201) ; `PUT /:id`; `DELETE /:id` -> `{ id, deleted: true }`; `POST /evaluate` (200) -> `{ effect, matched, channels: [{ integrationId, effect }], key: { allowed: boolean; code?: 'key_action_not_allowed'|'key_channel_not_allowed' } }`. Create, update and delete call `logSecurityEvent(org.id, 'policy.create'|'policy.update'|'policy.delete', user.id, { ruleId, name })` (never words). `evaluate`: actor from `asActor` (default `actorFromUser(user)`; `API_KEY` with `apiKeyId` must be one of the organization's keys else 400 `unknown_api_key`; `API_KEY` without id is the legacy key; `OAUTH_CLIENT` -> `{ type, oauthClientId: null }`); targets via `targetsFromDraftBody(org.id, body, actor)`; `evaluateTargets(org.id, targets, 'write')`; `key` is `checkKeyPermission(perms, action, integrationIds)` for an API key with an id (action from `type`: draft DRAFT, schedule SCHEDULE, now PUBLISH_NOW), otherwise `{ allowed: true }`. Nothing is written (no audit, no approval).

- [ ] **Step 1: Write the failing tests.**
  - DTO spec: `asActor` with an unknown type invalid; `apiKeyId` with `type USER` invalid; the inherited Phase 3 rules still apply (0 posts invalid).
  - Controller http spec: every handler has the admin `CHECK_POLICIES_KEY` metadata; `GET /policies` returns the public rules; create/update/delete delegate with the org and write the three audit event names with `{ ruleId, name }` only (assert `conditionParams`/words are absent from the audit input); a service `NotFoundException` -> 404 for foreign ids; a service 400 (`policy_limit_reached`) passes through; evaluate: default actor is the session USER; `asActor { API_KEY, apiKeyId: 'k1' }` with a key limited to `['DRAFT']` and `type: 'now'` returns `key { allowed: false, code: 'key_action_not_allowed' }`; an `apiKeyId` of another organization -> 400; a foreign channel id -> 404 (from the service); evaluate never calls the audit logger, the approval router or any create method.
  - Module spec: `PoliciesController` is in `controllers` and wrapped by both middlewares.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/backend/src/api libraries/nestjs-libraries/src/dtos/policies --coverage=false`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the DTO, controller and registration.
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm run build:backend`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add apps/backend/src/api libraries/nestjs-libraries/src/dtos/policies
GIT commit -m "feat(api): dashboard policy rule management and dry run"
```

---

### Task 10: Frontend data layer: API module, filters, model (pure, TDD)

**Files:**
- Create: `apps/frontend/src/lib/agent-activity-api.ts`, `agent-activity-filters.ts`, `agent-activity-model.ts`, `agent-center-i18n.spec.ts`, specs `agent-activity-filters.spec.ts`, `agent-activity-model.spec.ts`

**Interfaces:**
- Produces `agent-activity-api.ts` (types mirror the spec R1/R2/R3 shapes exactly: `AgentSummary`, `AgentGroup`, `AgentDestination`, `ActorDisplay`, `AgentGroupDetail`, `BulkResult`, `RetryResult`, `AgentFilterOptions`) and functions: `getAgentSummary(timezone?: string)` (`GET /agent-activity/summary`), `listAgentActivity(query: Record<string,string>)` (`GET /agent-activity`), `getAgentFilters()`, `getAgentGroup(group: string)` (`GET /agent-activity/groups/:group`, URL-encoded), `bulkResolveApprovals(body: { action: 'approve'|'reject'; approvalIds: string[]; note?: string })`, `retryAgentGroup(group: string, includeUnknownOutcome: boolean)`. Uses `api` from `./api` (this file is not unit tested; the others import nothing from it).
- Produces `agent-activity-filters.ts` (pure, relative imports only):
```ts
export type AgentBucket = 'all'|'attention'|'failed'|'review'|'blocked'|'retryable'|'unknown_outcome'|'failed_other'|'published'|'scheduled'|'draft'|'held';
export type AgentFilters = { bucket: AgentBucket; scope: 'relevant'|'automation'; integrationIds: string[]; actor: string; agentName: string; source: string; from: string; to: string }; // from/to 'YYYY-MM-DD' local, '' = unset
export const DEFAULT_FILTERS: AgentFilters; // bucket 'attention', scope 'relevant', rest empty
export function filtersFromSearch(search: string): AgentFilters; // tolerant: unknown bucket -> default, bad dates -> '', integrationIds max 20
export function filtersToSearch(f: AgentFilters): string; // '' when default; omits defaults; stable key order; no leading '?'
export function toApiQuery(f: AgentFilters, limit?: number): Record<string, string>; // from -> start of local day ISO, to -> end of local day ISO (23:59:59.999), integrationIds comma joined, empty omitted
export function hasActiveFilters(f: AgentFilters): boolean; // anything but DEFAULT_FILTERS
```
- Produces `agent-activity-model.ts` (pure): `FILTER_BUCKETS: AgentBucket[]` (order for the segmented control: `attention review blocked failed published scheduled draft all`); `BUCKET_WEIGHT: Record<RowBucketName, 'filled'|'outline'|'dotted'|'struck'|'plain'>` (`unknown_outcome`/`blocked` filled, `retryable`/`failed_other` outline, `review` dotted, `held` struck, `scheduled`/`draft`/`published` plain); `TILE_BUCKET: { review: 'review'; blocked: 'blocked'; failed: 'failed' }`; `mergeGroupPages(prev: AgentGroup[], next: AgentGroup[]): AgentGroup[]` (append, drop groups already present, keep first); `toggleGroup(sel: Set<string>, group: string): Set<string>` (new set); `selectedApprovalIds(groups: AgentGroup[], sel: Set<string>): string[]` (flatten `pendingApprovalIds` of selected groups, distinct, at most 50 then stop); `pruneSelection(sel: Set<string>, groups: AgentGroup[]): Set<string>` (drop groups that are gone or have no pending approvals); `bucketLabelKey(b: string): string` returns `agentActivity.bucket.${b}`.

- [ ] **Step 1: Write the failing tests.**
  - `agent-activity-filters.spec.ts`: round trip `filtersToSearch(filtersFromSearch(s))` for a full query; default state -> `''`; `?bucket=nope` -> default bucket; `from=2026-13-40` -> `''`; 25 `integrationIds` -> 20; `toApiQuery` omits empty values, joins ids, and `from: '2026-11-04'` -> `new Date(2026, 10, 4, 0, 0, 0, 0).toISOString()`, `to` -> `new Date(2026, 10, 4, 23, 59, 59, 999).toISOString()`; `hasActiveFilters(DEFAULT_FILTERS)` false.
  - `agent-activity-model.spec.ts`: `mergeGroupPages` dedupes by `group` and keeps the first occurrence and the order; `selectedApprovalIds` ignores groups without pending ids, dedupes and caps at 50; `pruneSelection` drops vanished groups; `toggleGroup` does not mutate its input; `FILTER_BUCKETS` has no duplicates; every `RowBucketName` has a weight.
  - `agent-center-i18n.spec.ts` (imports `../lib/i18n/messages/en` and `pl` as relative modules): for every leaf under `agentActivity` and `policies` in `en` there is a leaf with the same key path in `pl`; `{placeholder}` sets match per key; no U+2013/U+2014 in either namespace; passes trivially while the namespaces are absent (guard with `if (!en.agentActivity)` style optional chaining) and becomes binding as keys land.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/agent-activity-filters.spec.ts apps/frontend/src/lib/agent-activity-model.spec.ts apps/frontend/src/lib/agent-center-i18n.spec.ts --coverage=false`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules (`agent-activity-api.ts` last, types first).
- [ ] **Step 4: Re-run the Step 2 command, then** `pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json`. Expected: PASS, exit 0.
- [ ] **Step 5: Commit**
```
GIT add apps/frontend/src/lib
GIT commit -m "feat(frontend): agent activity API module, filter state and list model"
```

---

### Task 11: Nav item, `/agents` page, summary bar, filters and list

**Files:**
- Create: `apps/frontend/src/app/agents/page.tsx`, `components/agent-activity/agent-activity-page.tsx`, `agent-summary-bar.tsx`, `agent-filters.tsx`, `agent-group-row.tsx`, `actor-label.tsx`, `use-agent-activity.ts`, `agent-activity.module.css`
- Modify: `components/dashboard-shell.tsx` (`NAV_ITEMS`, after `/approval`), `lib/i18n/messages/en.ts` and `pl.ts` (`nav.agents`, new `agentActivity` namespace keys used here from spec R8)

**Interfaces:**
- Consumes: Task 10 modules, `getIntegrationChannels`/`listChannels` for the channel filter, `DatePicker`, `EmptyState`, `PlatformIcon`, `platformFromIdentifier`, `useAuth`, `useT`.
- Produces: `app/agents/page.tsx` renders `<Suspense><AgentActivityPage/></Suspense>` (needed for `useSearchParams`). `use-agent-activity.ts`: `useAgentActivity(filters: AgentFilters)` returning `{ groups, nextCursor, summary, filterOptions, loading, loadingMore, error, loadMore(), refresh() }` (cancellation flag per request, refetch on window focus, aborts stale responses when filters change). `AgentActivityPage` keeps filters in the URL (`router.replace(pathname + '?' + filtersToSearch(f))`, `scroll: false`) and passes the user role down. Summary tiles are buttons with `aria-pressed` for `review`, `blocked`, `failed`; clicking applies `TILE_BUCKET`. Group row: checkbox (only when `pendingApprovalIds.length > 0` and the user is ADMIN or SUPERADMIN), destination chips, preview, `by <name>` with a type label, claimed agent name with the word "claimed", relative or locale time, bucket label with weight styling. The `ActorLabel` component renders `ActorDisplay` using `agentActivity.actor.*` keys (legacy, revoked, unknown, system, authorizedBy). Clicking a row calls an `onOpen(group)` prop (drawer is Task 12).
- Nav icon: a 16x16 stroke SVG in the style of the neighbours (a small "activity pulse" path), `labelKey: "nav.agents"`, no `minRole`.

- [ ] **Step 1: Add the keys** to `en.ts` and `pl.ts`: `nav.agents`, and the `agentActivity` keys for page, tiles, buckets, filters, list, actor labels from spec R8.
- [ ] **Step 2: Implement** the nav entry, route, page, hook, summary bar, filters, row and CSS module (neutral tokens only; tiles are bordered cards; selected tile is inverted `--fg`/`--bg`; layout stacks under 768px; filters collapse into a wrapped row; touch targets at least 40px under 768px; list rows are `<ul>` of `<li>` with a visible focus ring).
- [ ] **Step 3: Typecheck.** Run: `pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json` and `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/agent-center-i18n.spec.ts --coverage=false`. Expected: exit 0, PASS (en/pl parity now binding for the added keys).
- [ ] **Step 4: Manual check (the Playwright script comes in Task 18).** `node apps/frontend/scripts/dedupe-react.cjs`, then in `apps/frontend`: `NEXT_PUBLIC_BACKEND_URL=http://localhost:3000 pnpm exec next dev -p 4200` with the backend running and an organization that has at least one API key post (create one with `curl -H "Authorization: <key>" -d '{...}' .../public/v1/posts`). Open `/agents`: the nav shows "Agent activity", the summary tiles render numbers, clicking "Waiting for review" sets `?bucket=review` and filters the list, "Load more" appends without duplicates, switching the language to Polish changes the labels, a USER-role account sees no checkboxes.
- [ ] **Step 5: Commit**
```
GIT add apps/frontend/src
GIT commit -m "feat(frontend): Agent activity page with summary, filters and list"
```

---

### Task 12: Group detail drawer: destinations, who, approval, policy, previews, compare, timeline

**Files:**
- Create: `lib/agent-text-diff.ts`, `lib/agent-destination-channel.ts` (+ specs), `components/agent-activity/agent-group-drawer.tsx`, `agent-content-compare.tsx`, `agent-timeline.tsx`
- Modify: `agent-activity-page.tsx` (open the drawer), `agent-activity.module.css`, `en.ts`, `pl.ts` (`agentActivity.drawer.*`, `error.*`, `event.*`, `compare.*`)

**Interfaces:**
- Produces `agent-text-diff.ts` (pure): `export type DiffPart = { text: string; kind: 'same'|'added'|'removed' }; diffWords(a: string, b: string): DiffPart[]` (word level LCS, whitespace preserved, deterministic); `compareDestinations(items: Array<{ id: string; name: string; text: string }>): { identical: boolean; baseline: { id: string; name: string }; others: Array<{ id: string; name: string; parts: DiffPart[]; identical: boolean }> }` (first item is the baseline; `identical` ignores differences in whitespace runs only).
- Produces `agent-destination-channel.ts` (pure): `destinationToChannel(d: { integrationId: string; integrationName: string; providerIdentifier: string; picture: string | null }): Channel` (fields of `lib/calendar-data` `Channel`: `id`, `name`, `platform` via `platformFromIdentifier`, `identifier`, `color` `'#0F0F0F'`, `avatarUrl`, `audience 0`, `audienceHistory []`). Because it must be importable by the root Jest run, it re-implements the one-line identifier to platform lookup through an injected function parameter instead of importing `lib/integrations`: signature `destinationToChannel(d, platformOf: (identifier: string) => string)`.
- Drawer (`AgentGroupDrawer({ group, onClose, onChanged })`, overlay pattern of `PostDetailDrawer`, width `min(560px, 100%)`, `role="dialog"`, `aria-modal`, Escape closes, focus moves to the close button on open and back to the opener on close): loads `getAgentGroup(group)` with a cancellation flag; 404 (`ApiError.status === 404`) shows `agentActivity.drawer.changed` and a Refresh button that calls `onChanged()` then closes; other errors show a banner with Retry. Sections in the order of spec R7.3. Error category text from `agentActivity.error.<CATEGORY>`; unknown category -> `error.UNKNOWN`. Claimed provenance block is headed "Claimed by the client, not verified" and every value is rendered as plain text. Content: per destination a tab strip; a `PostPreviewPanel` instance per active destination (`channels=[channel]`, `bodyFor` = that destination's `contentText`, `media` from `parsePostMedia(image)`, `threadParts` = that destination's `thread`, `maxLenFor` via `effectiveMaxLength(getProviderRequirement(identifier), {})`, `identifierFor` = `providerIdentifier`); below it `AgentContentCompare` renders `compareDestinations`: `compare.same` when identical, otherwise for each other destination its parts with `added` underlined, `removed` struck through (no color). Timeline: list newest first with the localized event label (`event.<type with dots replaced by underscores>`), the actor via `ActorLabel` (GUEST -> `actor.guest`), time with `toLocaleString(locale)`, and for `post.failed`/`post.policy_evaluated` the relevant metadata values as plain text.

- [ ] **Step 1: Write the failing tests.**
  - `agent-text-diff.spec.ts`: identical strings -> all `same`; one word replaced -> `removed` then `added` for that word only; insertion at the end; both empty; whitespace-only difference -> `identical: true` in `compareDestinations`; three destinations -> baseline is the first and `others` has two entries with their own parts; 2000 word inputs finish under 200ms (guards against an exponential implementation).
  - `agent-destination-channel.spec.ts`: maps ids, name, identifier, `platform` via the injected function, `avatarUrl` null passes through, `audienceHistory` empty.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/agent-text-diff.spec.ts apps/frontend/src/lib/agent-destination-channel.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** the two pure modules, then the keys (`en.ts` + `pl.ts`), then the drawer, compare and timeline components and wire `onOpen` in the page.
- [ ] **Step 4: Run** the Step 2 command (PASS), `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/agent-center-i18n.spec.ts --coverage=false` (PASS) and the frontend typecheck (exit 0).
- [ ] **Step 5: Manual check.** With the dev server and a group that has a failed destination and an approval: the drawer opens, Escape closes it and focus returns to the row, a group edited from another tab shows "This post changed" after Refresh, a two-channel post with different text per channel shows the compare view with underlines and strikes and no color, an OAuth client named `<img src=x onerror=alert(1)>` (register one with `POST /oauth/register`-style dynamic registration or edit a fixture) renders as literal text.
- [ ] **Step 6: Commit**
```
GIT add apps/frontend/src
GIT commit -m "feat(frontend): agent activity detail drawer with previews, compare view and timeline"
```

---

### Task 13: Actions: approve, reject, bulk, retry with unknown-outcome confirm, open links

**Files:**
- Create: `components/agent-activity/agent-actions.tsx`, `retry-unknown-dialog.tsx`, `lib/calendar-deep-link.ts` (+ spec)
- Modify: `agent-group-row.tsx`, `agent-group-drawer.tsx`, `agent-activity-page.tsx` (selection bar), `components/calendar.tsx` (query consumers), `agent-activity.module.css`, `en.ts`, `pl.ts` (`agentActivity.action.*`, `retryUnknown.*`, `bulk.*`)

**Interfaces:**
- Produces `calendar-deep-link.ts` (pure): `parseCalendarDeepLink(search: string): { postId?: string; date?: string }` (`post` must match `^[A-Za-z0-9_-]{1,64}$`; `date` must be a real `YYYY-MM-DD` calendar date; invalid values are omitted); `stripCalendarDeepLink(search: string): string` (removes `post` and `date`, keeps the rest, no leading `?`).
- `Calendar` change (same pattern as `connect=1`): an effect reads `parseCalendarDeepLink(window.location.search)` once the channel and event loading finished: `date` -> `setCursor(new Date(y, m-1, 1))` and `setSelected(new Date(y, m-1, d))`; `postId` -> `void openEventForEdit({ id: postId, channelId: '', date: '', time: '' } as CalendarEvent)` (member role: ignored, as editing is hidden for members); then `history.replaceState` with `stripCalendarDeepLink`.
- `agent-actions.tsx`: `useAgentActions({ onDone })` returning `{ approve(approvalId), reject(approvalId, note?), bulk(action, approvalIds, note?), retry(group, includeUnknown), busy }` over `approvePost`, `rejectPost`, `bulkResolveApprovals`, `retryAgentGroup`; one request in flight at a time (buttons `disabled` while `busy`); result messages in an `aria-live="polite"` region (`bulk.result` text from the summary; 422 `policy_blocked` text via `parsePolicyBlocked` once Task 16 lands, until then the server `msg`); every success calls `onDone()` (refetch list and summary, close the drawer if its group is gone). Buttons: Approve (`action.approve`) and Reject (inline reason box like `approval/page.tsx`) only for ADMIN/SUPERADMIN and only for destinations whose `approval.status === 'PENDING'`; "Retry failed" when `canRetry` and some destination is `retryable` or `failed_other` (sends `includeUnknownOutcome: false`); "Retry anyway" when a destination is `unknown_outcome`, which opens `RetryUnknownDialog`; "Open in editor" (`/calendar?post=<postId>`) for destinations in `DRAFT QUEUE APPROVAL ERROR HELD`, "Open in calendar" (`/calendar?date=<local publishDate YYYY-MM-DD>`), "View on platform" (`releaseURL`, `target="_blank" rel="noopener noreferrer"`) for `PUBLISHED`. A sticky bulk bar appears when groups are selected: `list.selected`, "Approve selected" and "Reject selected" (each opens `ConfirmDialog` with `bulk.confirmApprove|Reject`; reject includes an optional reason field), no retry in bulk.
- `RetryUnknownDialog({ onConfirm, onCancel, busy })`: same visual contract as `ConfirmDialog` (reuse it as the shell via its `title` and `body` props is not enough because of the checkbox, so render through the same portal pattern), title `retryUnknown.title`, body `retryUnknown.body`, a labelled checkbox `retryUnknown.check`; the confirm button is `disabled` until the box is ticked; Escape cancels; the box is unticked every time the dialog opens.

- [ ] **Step 1: Write the failing test** `calendar-deep-link.spec.ts`: `?post=abc_12&date=2026-11-04` -> both; `post=../x` omitted; `date=2026-02-30` omitted; `date=2026-11-4` omitted; `post` of 65 chars omitted; `stripCalendarDeepLink('connect=1&post=abc&date=2026-11-04')` -> `'connect=1'`; empty -> `''`.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/calendar-deep-link.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** the parser, the calendar consumers, keys (`en.ts` + `pl.ts`), the hook, the dialog and the buttons.
- [ ] **Step 4: Run** the Step 2 command (PASS), the i18n spec (PASS) and the frontend typecheck (exit 0).
- [ ] **Step 5: Manual check.** As ADMIN with the backend: approve one pending item from the row (it disappears, the tile count drops); select two groups and "Approve selected" (confirm dialog, then result line "2 done, 0 skipped, 0 failed"; run it again from a stale tab and see "skipped"); open a group with an `unknown_outcome` destination: "Retry anyway" opens the dialog, the confirm button is disabled until the box is ticked, and the network request body is `{"includeUnknownOutcome":true}` only after confirming (a plain "Retry failed" sends `false`); as a USER-role account no approve, reject, retry or checkbox exists, and `curl` of the bulk route returns 403; "Open in editor" lands on `/calendar?post=...` and opens the edit modal, then the query is gone from the address bar.
- [ ] **Step 6: Commit**
```
GIT add apps/frontend/src
GIT commit -m "feat(frontend): approve, reject, bulk and retry actions with unknown-outcome confirm"
```

---

### Task 14: Settings > Policies page with dry run

**Files:**
- Create: `lib/policies-api.ts`, `lib/policies-model.ts` (+ spec), `app/settings/policies/page.tsx`, `components/policies/policy-rule-form.tsx`, `policy-dry-run-panel.tsx`, `policies.module.css`
- Modify: `components/settings-shell.tsx` (`NAV_ITEMS`: `{ href: "/settings/policies", labelKey: "settings.policies", minRole: "ADMIN" }` after webhooks), `en.ts`, `pl.ts` (`settings.policies`, `policies.*`)

**Interfaces:**
- Produces `policies-api.ts` (thin): `listPolicies()`, `createPolicy(input)`, `updatePolicy(id, patch)`, `deletePolicy(id)`, `evaluatePolicy(body)` over `/policies` and `/policies/evaluate`; types `PolicyRule`, `PolicyCondition`, `PolicyEffect`, `PolicyInput`, `EvaluateResult` mirroring the Phase 3 public shapes.
- Produces `policies-model.ts` (pure, relative imports):
```ts
export const POLICY_LIMITS = { nameMax: 120, priorityMin: 0, priorityMax: 1000, filterMax: 100, wordsMax: 100, wordMax: 100, capMin: 1, capMax: 10000 } as const;
export type PolicyFormState = { name: string; enabled: boolean; priority: string; effect: PolicyEffect; condition: PolicyCondition; words: string; windowDays: number[]; windowStart: string; windowEnd: string; timezone: string; capMax: string; capScope: 'organization'|'channel'; appliesToActorTypes: string[]; appliesToApiKeyIds: string[]; appliesToIntegrationIds: string[]; appliesToProviders: string };
export function emptyForm(): PolicyFormState; // priority '100', enabled true, effect REQUIRE_APPROVAL, condition CONTAINS_LINK
export function formFromRule(r: PolicyRule): PolicyFormState;
export function validateForm(f: PolicyFormState, isValidZone?: (z: string) => boolean): Record<string, string>; // field -> i18n key suffix; {} when valid
export function toInput(f: PolicyFormState): PolicyInput; // trims; words split on newlines/commas, distinct case-insensitive, conditionParams only for the chosen condition ({} for ALWAYS/CONTAINS_LINK/PUBLISH_NOW/HAS_VIDEO); providers split on commas lowercased
export function ruleSummary(r: PolicyRule): { effect: PolicyEffect; condition: PolicyCondition; filters: string[] }; // keys only, no translated text
```
- Page: list ordered by priority (as returned), monochrome effect chip ("Require approval" outlined, "Block" filled), `Switch` for enabled (optimistic with rollback and an error banner), Edit (opens `PolicyRuleForm` in the rename-modal style: `role="dialog"`, Escape closes unless busy), Delete (`ConfirmDialog`, danger), empty state, `policy_limit_reached` shown as the server message. Form: name, effect select, condition select with its parameter editor (words textarea one per line; window days checkboxes Sun to Sat, start/end `HH:MM` inputs, timezone input prefilled from `Intl.DateTimeFormat().resolvedOptions().timeZone`; cap number and scope), priority, filters (actor types checkboxes with the note "Empty means automation only", API keys multi-select from `/settings/api-keys`, channels multi-select from `getIntegrationChannels`, providers text), inline field errors from `validateForm` with `aria-invalid`. `PolicyDryRunPanel`: channel select, type (draft, schedule, now), date-time input when schedule, text area, "Contains an image" and "Contains a video" toggles (adds a sample `{ path }` ending `.png`/`.mp4`), "As" select (`test.as.*`), button "Run check"; result shows effect chip (`result.allow|requireApproval|block`), matched rule names, per-channel effects and, when `key.allowed === false`, the key code message; nothing persists.

- [ ] **Step 1: Write the failing test** `policies-model.spec.ts`: `validateForm` flags empty and 121 character names, priority `-1`, `1001`, `10.5`, `''`; `CONTAINS_WORDS` with no words, 101 words, a 101 character word, case-insensitive duplicates (`Foo`, `foo`); `OUTSIDE_WINDOW` with no days, `start === end`, `25:00`, bad timezone (injected validator), valid overnight window `22:00`-`06:00`; `DAILY_CAP_EXCEEDED` with `0` and `10001`; 101 filter entries; a valid form returns `{}`. `toInput`: `CONTAINS_LINK` -> `conditionParams {}`; words dedupe and trim (`' a ,A\nb'` -> `['a','b']`); window -> `{ days, start, end, timezone }`; cap -> `{ max: number, scope }`; providers `'X, LinkedIn'` -> `['x','linkedin']`; round trip `toInput(formFromRule(rule))` equals the rule's editable fields for one rule per condition.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/policies-model.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, API module, keys (`en.ts` + `pl.ts`: page, form, seven condition labels, two effects, validation messages keyed by the `validateForm` suffixes, test panel), settings nav entry, page, form and dry run panel.
- [ ] **Step 4: Run** the Step 2 command, the i18n spec and the frontend typecheck. Expected: PASS, exit 0.
- [ ] **Step 5: Manual check.** As ADMIN: create "No links from agents" (`CONTAINS_LINK`, require approval), see it listed; toggle it off and on; edit its priority; run the dry run with text `see https://x.co` as "An API key" -> "Needs approval" with the rule name; a `BLOCK` rule with `CONTAINS_WORDS` `["banned"]` -> "Blocked"; an invalid timezone shows the field error and no request is sent; delete asks for confirmation; a USER-role account does not see the nav item and `GET /policies` returns 403.
- [ ] **Step 6: Commit**
```
GIT add apps/frontend/src
GIT commit -m "feat(frontend): Settings policies page with rule form and dry run"
```

---

### Task 15: Key permissions in the API key dialogs

**Files:**
- Create: `lib/key-permissions-model.ts` (+ spec)
- Modify: `apps/frontend/src/app/settings/api/page.tsx` (`ApiKeyRow`, create form ~245, rename modal ~385, rows ~212), `en.ts`, `pl.ts` (`settingsApi.*` keys from spec R8)

**Interfaces:**
- Produces `key-permissions-model.ts` (pure):
```ts
export type KeyAction = 'DRAFT' | 'SCHEDULE' | 'PUBLISH_NOW';
export const KEY_ACTIONS: readonly KeyAction[] = ['DRAFT', 'SCHEDULE', 'PUBLISH_NOW'];
export type KeyPermissionsState = { limited: boolean; actions: KeyAction[]; integrationIds: string[] };
export function permissionsFromRow(row: { allowedActions?: string[]; allowedIntegrationIds?: string[] }): KeyPermissionsState; // limited when either list is non-empty; unknown action strings dropped
export function permissionsPayload(s: KeyPermissionsState): { allowedActions: KeyAction[]; allowedIntegrationIds: string[] }; // limited false -> both []
export function isPermissionsSaveable(s: KeyPermissionsState): boolean; // limited with both lists empty -> false
export function describePermissions(row: ..., channelName: (id: string) => string | undefined): { actions: KeyAction[] | null; channelCount: number | null; channelNames: string[] }; // null = unrestricted
```
- Page changes: `ApiKeyRow` gains `allowedActions?: string[]; allowedIntegrationIds?: string[]`. Create form and rename modal get a "Permissions" block: a `Switch` "Limit what this key can do", when on: three action checkboxes and a channel multi-select (channels from `getIntegrationChannels`, loaded once on first open), a one-line note `permissionsScope`; when `!isPermissionsSaveable` the Create/Save button is `disabled` and `permissionsEmptyHint` is shown. Create posts `{ name, scopes, ...permissionsPayload }`; rename PUT sends `{ name, scopes, ...permissionsPayload }` and the local row state is updated from the response (not only name and scopes). The list gets a "Permissions" column text from `describePermissions` (`permAll` or `permSummary`). The grid `gridTemplateColumns` gains a column and `minWidth` grows; the table keeps `overflowX: auto` so mobile does not scroll the page.

- [ ] **Step 1: Write the failing test** `key-permissions-model.spec.ts`: empty row -> `limited false`; row with `['DRAFT']` and `[]` -> limited, actions `['DRAFT']`; `['DRAFT','HACK']` drops `HACK`; payload for unlimited is two empty arrays even if lists were filled; `isPermissionsSaveable({limited:true, actions:[], integrationIds:[]})` false, true with either list filled, true when not limited; `describePermissions` for unrestricted -> `{ actions: null, channelCount: null }`, for 2 channel ids with one unknown name returns `channelCount 2` and one name.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/key-permissions-model.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, keys (`en.ts` + `pl.ts`) and the page changes.
- [ ] **Step 4: Run** the Step 2 command, the i18n spec and the frontend typecheck. Expected: PASS, exit 0.
- [ ] **Step 5: Manual check.** Create a key limited to Draft on one channel: the list shows "Draft only, 1 channel"; `curl` a `type: "now"` post with that key returns 403 `key_action_not_allowed` and the same key can create a draft on that channel (proves the UI wrote what Phase 3 enforces); edit it, turn the switch off, Save: the list shows "All actions, all channels" and the PUT body had two empty arrays; with the switch on and nothing ticked the button is disabled.
- [ ] **Step 6: Commit**
```
GIT add apps/frontend/src
GIT commit -m "feat(frontend): per-key action and channel limits in the API key dialogs"
```

---

### Task 16: Composer and calendar feedback for policy outcomes

**Files:**
- Create: `lib/policy-errors.ts` (+ spec), `components/policy-notice.tsx`
- Modify: `lib/posts.ts` (`createPost` return type, `changePostDate` return), `components/create-post-modal.tsx` (`humanizeSubmitError` ~401), `components/calendar.tsx` (`submitPost` ~772, `moveEvent` ~896, render the notice), `components/posts.tsx` (`submitPost` ~650, render the notice), `en.ts`, `pl.ts` (`createPost.policyBlocked`, `createPost.policyApprovalSent`, plus `common`-free link text reusing `nav.approval`)

**Interfaces:**
- Produces `policy-errors.ts` (pure): `parsePolicyBlocked(body: unknown): { ruleNames: string[] } | null` (body `{ error: 'policy_blocked', policy: { matched: [{ name }] } }`; names deduped, each cut to 80, at most 5 kept); `summarizeCreateResult(created: unknown): { approvalRequested: boolean; blocked: false }` (true when any array element has `approvalRequested === true`); `summarizeDateResult(res: unknown): { approvalRequested: boolean }`.
- `lib/posts.ts`: `createPost` returns `Array<{ postId: string; integration: string; policy?: unknown; approvalRequested?: boolean }>`; `changePostDate` returns `Promise<{ approvalRequested?: boolean }>` (the response body, `{}` when empty).
- `humanizeSubmitError`: first branch for `parsePolicyBlocked(anyErr.body)` -> `t("createPost.policyBlocked", { rules: names.join(", ") })`.
- `PolicyNotice({ message, onClose })`: dismissable banner (`role="status"`, text from `createPost.policyApprovalSent`, a link to `/approval` labelled `nav.approval`), auto-dismiss after 10s, monochrome. Calendar and Posts keep a `policyNotice` boolean: set after `createPost` resolves with `summarizeCreateResult(created).approvalRequested`; in `moveEvent` when `changePostDate` returns `approvalRequested` the optimistic move is reverted by `refreshEvents()` and the notice is shown; a thrown `ApiError` with `parsePolicyBlocked(body)` sets `channelError` to the `createPost.policyBlocked` text instead of `errors.postReschedule`.

- [ ] **Step 1: Write the failing test** `policy-errors.spec.ts`: `parsePolicyBlocked` with the Phase 3 body -> names; duplicate names deduped; 7 rules -> first 5; a name of 200 characters cut to 80; `{ error: 'other' }`, `null`, a string -> `null`; `summarizeCreateResult([{postId:'p', approvalRequested:true}])` true, `[]` false, non-array false; `summarizeDateResult({ approvalRequested: true })` true, `undefined` false.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/policy-errors.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure module, the type changes, the error branch, the notice component, and the calendar and posts wiring. Existing behavior for responses without the new keys must not change.
- [ ] **Step 4: Run** the Step 2 command, the i18n spec and the frontend typecheck. Expected: PASS, exit 0.
- [ ] **Step 5: Manual check.** With a `BLOCK` rule `CONTAINS_WORDS ["banned"]` listing actor type `USER`: saving a scheduled post containing "banned" shows "Blocked by policy: <rule name>" in the composer and creates nothing; a `REQUIRE_APPROVAL` rule (`CONTAINS_LINK`, actor `USER`) makes "Schedule" save a draft, the composer closes and the notice appears with the Approval link; dragging a scheduled post on the calendar to a day that violates an `OUTSIDE_WINDOW` BLOCK rule shows the blocked message and the post returns to its slot; a plain draft is untouched; with no rules nothing changes.
- [ ] **Step 6: Commit**
```
GIT add apps/frontend/src
GIT commit -m "feat(frontend): show policy block and approval outcomes in the composer and calendar"
```

---

### Task 17: Remaining locales for existing namespaces and parity checks

**Files:**
- Modify: `apps/frontend/src/lib/i18n/messages/{ru,zh,fr,de,pt,it,ja,ko,tr}.ts` (and verify `en.ts`, `pl.ts`), `apps/frontend/src/lib/agent-center-i18n.spec.ts`

**Interfaces:** the keys that live in namespaces present in all 11 files: `nav.agents`, `settings.policies`, every `settingsApi.*` key added in Task 15, `createPost.policyBlocked`, `createPost.policyApprovalSent`. New namespaces `agentActivity` and `policies` stay in `en.ts` and `pl.ts` only (the other nine fall back to English by design).

- [ ] **Step 1: Extend the failing test.** In `agent-center-i18n.spec.ts` add: for each of the 11 locale modules (relative imports), every key in `ALL_LOCALE_KEYS` (list written out in the spec file: the keys above) resolves to a non-empty string, and `{placeholder}` sets equal the English ones. Run `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/agent-center-i18n.spec.ts --coverage=false`. Expected: FAIL naming the missing locale and key.
- [ ] **Step 2: Translate** the keys into the nine files, inside their existing blocks (`nav`, `settings`, `settingsApi`, `createPost`), keeping each file's tone and no dashes; short action words, the three action names, "Policies" and "Agent activity" must be natural, not literal.
- [ ] **Step 3: Re-run the Step 1 command, then** the frontend typecheck. Expected: PASS, exit 0.
- [ ] **Step 4: Commit**
```
GIT add apps/frontend/src/lib/i18n apps/frontend/src/lib/agent-center-i18n.spec.ts
GIT commit -m "feat(frontend): translate nav, settings and key permission strings for all locales"
```

---

### Task 18: Playwright headless screenshot checks

**Files:**
- Create: `apps/frontend/scripts/agent-center-fixtures.cjs`, `apps/frontend/scripts/agent-center-check.cjs`

**Interfaces:** the script is a Node CommonJS program: `node apps/frontend/scripts/agent-center-check.cjs [--base http://localhost:4200] [--out <dir>]` (default out dir: a `agent-center-shots` folder under `os.tmpdir()`; screenshots are never committed). It requires `playwright` lazily and prints `SKIP: playwright not installed` with exit code 0 when missing. It does not start servers; the base URL must be a running `next dev`/`start` built with `NEXT_PUBLIC_BACKEND_URL=http://localhost:3000`. All requests to `http://localhost:3000/**` are fulfilled by `page.route` from the fixtures with CORS headers (`access-control-allow-origin` = the page origin, `access-control-allow-credentials: true`, `access-control-allow-headers: *`) and an empty 204 for `OPTIONS`. Fixtures cover: `/user/self` (ADMIN, `agencyMode false`), `/user/organizations`, `/integrations/list` (3 channels incl. a TikTok), `/agent-activity/summary`, `/agent-activity` (6 groups across every bucket incl. `unknown_outcome`, a pending approval, a revoked key actor, a legacy org key, a claimed agent name), `/agent-activity/filters`, `/agent-activity/groups/<g>` (two destinations with different text, a policy block record, a 12 event timeline with one guest decision), `/approval/*`, `/policies`, `/policies/evaluate`, `/settings/api-keys` (one restricted key), and `[]` for anything else.

- [ ] **Step 1: Write the fixtures and the script.** Checks (each failing check pushes a message; exit code 1 when any):
  1. `/agents` at 1440x900 light and dark and at 390x844: summary tiles (five), segmented buckets, at least 6 rows, no `scrollWidth > innerWidth`, screenshots `agents-<theme>-<w>.png`.
  2. Click the first row: the dialog (`role=dialog`) is visible with the Destinations, Who, Approval, Policy, Content and Timeline headings; the compare view shows the "Text differs between destinations" text; Escape closes it and `document.activeElement` is the originating row; screenshot `agents-drawer-<theme>.png`.
  3. Open the group with the `unknown_outcome` destination: click "Retry anyway": the confirm button is `disabled`; tick the checkbox: it is enabled; Cancel; no request to `retry-failed` was made yet (track via `page.on('request')`).
  4. Select two groups: the bulk bar shows "2 selected"; screenshot.
  5. `/settings/policies`: list, open the form, switch condition to Words, submit empty -> inline error with `aria-invalid`; dry run panel returns "Needs approval"; screenshots light and mobile.
  6. `/settings/api`: the Permissions column and the edit modal with the limit switch on; screenshot.
  7. Global: `page.on('console')` records no `error` entries (ignore the font fetch failure message if offline), and `document.body.innerText` of each page contains no U+2013 or U+2014 character.
  8. Switch to Polish (`localStorage['postsider:locale']='pl'`) and assert the page title text differs from English.
- [ ] **Step 2: Run it.** `node apps/frontend/scripts/dedupe-react.cjs`; in `apps/frontend`: `NEXT_PUBLIC_BACKEND_URL=http://localhost:3000 pnpm exec next dev -p 4200` in the background; wait until `curl -s -o /dev/null -w '%{http_code}' http://localhost:4200/login` prints `200`; then `node apps/frontend/scripts/agent-center-check.cjs --out "$TMPDIR/agent-center-shots"`. Expected: `OK` summary line, exit 0, PNG files listed. Open the PNGs and visually confirm: black and white only (color only in platform icons), no overlap or clipped text at 390px, focus ring visible on the opened row, dark theme legible. Fix UI defects found (CSS only) and re-run. Stop the dev server.
- [ ] **Step 3: Commit**
```
GIT add apps/frontend/scripts apps/frontend/src
GIT commit -m "test(frontend): Playwright layout and interaction checks for Agent activity and Policies"
```

---

### Task 19: Documentation and final verification

**Files:**
- Modify: `README.md` (new subsection near the approval and audit sections), `docs/API-MCP-TRUST.md` (a short note), `apps/frontend/CHANGELOG.md` (Unreleased)

**Interfaces:** none (docs). Content requirements:
- README `### Agent activity (dashboard)`: what the page shows (summary tiles and what each counts: destinations, open backlog versus today; buckets and their meaning including `unknown_outcome` and why retry needs a confirmation), filters, the drawer sections, verified actor versus claimed provenance, approve/reject/bulk/retry and who can do them (admins), Settings > Policies and the dry run, per-key limits in the API key dialog, USER rules now applied when saving in the dashboard (create, edit, schedule, reschedule by drag; not CSV import, duplicate, evergreen), the new `?post=` and `?date=` calendar links, the endpoints under `/agent-activity` and `/policies` as dashboard (session) routes, not public API.
- `docs/API-MCP-TRUST.md`: Phase 4 adds session-authenticated dashboard routes only and changes no public route, scope, webhook or MCP tool; dashboard `POST /posts` and `PUT /posts/:id/date` can answer 422 `policy_blocked` or return `approvalRequested`.
- `apps/frontend/CHANGELOG.md`: user-facing bullets (Agent activity page, policies page, key limits, composer messages).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Verify no dashes were added and names are real.**
Run:
```
GIT diff -U0 | grep '^+' | LC_ALL=en_US.UTF-8 grep -nP '[\x{2013}\x{2014}]'
GIT diff main...HEAD -U0 -- apps docs README.md libraries | grep '^+' | LC_ALL=en_US.UTF-8 grep -nP '[\x{2013}\x{2014}]'
grep -n "agent-activity\|Settings > Policies\|unknown_outcome\|?post=" README.md docs/API-MCP-TRUST.md
```
Expected: the dash greps print nothing; the last grep shows all four terms. (If `main` is not a local ref use `feat/control-plane-p3-policy` as the base.)
- [ ] **Step 3: Full verification.**
Run:
```
pnpm exec jest -c jest.config.ts --coverage=false
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --runInBand
pnpm run build:backend && pnpm run build:orchestrator
pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json
pnpm --filter ./apps/frontend run lint
DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp pnpm exec prisma migrate diff --from-url postgresql://postgres@localhost:55432/ps_cp --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma --exit-code
pnpm --filter ./apps/frontend run build
```
Expected: all suites PASS (the root run includes every spec above; the MCP suite is unchanged and must still pass, proving no public contract moved), builds exit 0, lint exit 0, migrate diff exits 0. `next build` needs network for Google fonts: if it fails only on the font download, record that and rely on `tsc` plus the Task 18 dev-server run. If a pre-existing unrelated root spec fails, confirm it fails identically on `feat/control-plane-p3-policy` (use a `git worktree`, never `git stash`) before ignoring it.
- [ ] **Step 4: End-to-end manual run against a real backend.** Backend and frontend running, one organization with: an API key limited to Draft, a `REQUIRE_APPROVAL` rule on `CONTAINS_LINK` for automation, a `BLOCK` rule on the word "banned" listing `USER`. Post as the key (a draft, a scheduled post with a link -> `policy.effect REQUIRE_APPROVAL`, a "now" post -> 403); in `/agents` see the draft, the approval item and the summary change; approve it from the drawer; force a failed publish (disconnect the channel) and retry it; save a "banned" post in the composer as a person and see the block message. Note anything that differs in the commit message.
- [ ] **Step 5: Commit**
```
GIT add README.md docs/API-MCP-TRUST.md apps/frontend/CHANGELOG.md
GIT commit -m "docs: Agent activity page, policies UI and dashboard policy evaluation"
```

---

## Self-Review

- Spec coverage: R1 (Tasks 1, 2, 4, 5), R2 (Task 6), R3 (Tasks 7, 13), R4 (Task 3), R5 (Tasks 8, 16), R6 (Tasks 9, 14, 15), R7 (Tasks 11, 12, 13, 18), R8 (Tasks 10 to 17), R9 (every task plus Task 18 and 19), R10 (Task 19). D1 is Tasks 4 and 11, D2 Tasks 6 and 12, D3 Tasks 7 and 13, D4 Tasks 1 to 6, D5 Tasks 9, 14, 15, D6 Tasks 8 and 16, D7 is a Global Constraint verified by the untouched MCP suite in Task 19.
- Type consistency: `RowBucket`/`ActivityBucket` (Task 2) are the same names used by the repository, view and service (Task 4) and mirrored as `AgentBucket` strings in the frontend (Task 10); `ActorDisplay` (Task 3) is produced by Tasks 4 and 6 and consumed by `ActorLabel` (Task 11); `GroupSummary.pendingApprovalIds` (Task 4) feeds `selectedApprovalIds` (Task 10) and the bulk route (Task 7); `includeUnknownOutcome` flows dialog (Task 13) -> `retryAgentGroup` (Task 10) -> `RetryFailedDto` (Task 7) -> `retryFailedByGroup` (Phase 1); `gateReschedule` (Task 8) is used only by the dashboard `changeDate`; the `approvalRequested` key (Phase 3 `finishCreate`, Task 8 for `changeDate`) is read by `summarizeCreateResult`/`summarizeDateResult` (Task 16).
- Ordering hazard: Task 13 references the `parsePolicyBlocked` text before Task 16 exists; it falls back to the server `msg` until then (stated in the task). Task 17 is the only task that touches the nine non-Polish locale files.
- Proportion: the backend tasks carry signatures and test assertions rather than bodies; the three algorithmic pieces left to the implementer are `dayBounds`, the `groupBy` cursor `having`, and `diffWords`, each pinned by tests including the DST days and a performance bound.
