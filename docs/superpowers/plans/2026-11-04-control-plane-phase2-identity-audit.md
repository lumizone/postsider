# Control Plane Phase 2: Agent Identity and Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a verified actor (user, API key, OAuth client, system) on every post write and approval, store client-claimed provenance separately, make approval requests idempotent with real attribution and guest identity, write post lifecycle audit events and expose them through a scoped read API, webhooks and one MCP tool.

**Architecture:** A pure actor module plus an `AsyncLocalStorage` context set by the two auth middlewares gives every repository write the verified actor without threading parameters. Provenance is parsed from body and headers by one pure function and stored in its own columns. `AuditLog` is extended additively with target and actor columns and a best-effort `logResourceEvent`; a new read service serves `GET /public/v1/audit-events` (scope `audit:read`) and `GET /public/v1/posts/:id/activity` (scope `posts:read`).

**Tech Stack:** NestJS, Prisma 6.5.0 (PostgreSQL), Temporal activities (orchestrator), Jest 29 + ts-jest, class-validator, MCP SDK (ESM) for `apps/mcp`.

**Spec:** `docs/superpowers/specs/2026-11-04-control-plane-phase2-identity-audit.md` (read it first; it holds the verified facts, the corrections to the brief, the exact event list and the PR #36 overlap list).

## Global Constraints

Every task implicitly includes these.

- Git binary: `/Library/Developer/CommandLineTools/usr/bin/git` (`/usr/bin/git` exits 69 on this host). In commands below `GIT` means that path. Work only in the worktree `postsider-wt-control-plane-p2` on branch `feat/control-plane-p2-identity`. Never push, never force, never `git stash` without a unique tag.
- Commit trailer on every commit message: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prisma: schema changes ship ONLY as a migration file under `libraries/nestjs-libraries/src/database/prisma/migrations/`. Never `db push`. Schema path: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (`SCHEMA` below).
- No em dashes or en dashes (U+2014, U+2013) in any added line: user-facing copy, API messages, docs, README, MCP descriptions, comments. Use `-` or rewrite.
- `PostActorType` values (exact): `USER`, `API_KEY`, `OAUTH_CLIENT`, `SYSTEM`. Audit event names (exact): `post.created`, `post.updated`, `post.deleted`, `post.status_changed`, `post.approval_requested`, `post.approval_resolved`, `post.published`, `post.failed`, `post.retry_requested`.
- Provenance fields (exact): `agentName`, `workflowId`, `runId`, `externalRef`, `source`; each at most 255 characters; headers `X-Postsider-Agent`, `X-Postsider-Workflow-Id`, `X-Postsider-Run-Id`, `X-Postsider-External-Ref`, `X-Postsider-Source`. Guest identity: `guestName` 1 to 120, `guestEmail` valid and at most 254. Audit API: `limit` 1 to 100, default 25.
- The actor is NEVER read from a request body or header. `creationMethod` keeps today's handling and never influences actor columns.
- Every DB query on tenant data includes `organizationId`. Cross-tenant ids return 404 (never 403, never data).
- API, webhook and MCP changes are additive: do not rename or remove existing response keys, headers, events or MCP tools. The only intentional response change is the explicit projection of the request-approval response (spec fact 7).
- Audit writes are best effort: they never throw to the caller and never delay or fail publishing, approval or an API response.
- Never edit workflow files (`post.workflow.v1.0.*.ts`) and never change `publicApiRetentionWorkflow`. No billing changes, no MCP OAuth flow changes (D7). Frontend changes are limited to the explicit, scoped D7 exception in Task 7 (guest review page inputs and the `audit:read` scope checkbox) and nothing else.
- Test commands: root specs `pnpm exec jest -c jest.config.ts <path> --coverage=false`; MCP specs `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs <path>`. Run from the worktree root. Specs live next to the source as `*.spec.ts`. Specs that import code touching `isomorphic-dompurify` start with `jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));`.
- Conventions: imports use the `@postsider/*` aliases; match the constructor field style of the file you edit; new optional constructor dependencies use a trailing `@Optional() private _x?: T` (precedent: `_funnelAttribution` in `PostsService`) so existing positional `new X(...)` specs keep compiling.

## Review Focus

The failure modes the spec implies that a person is most likely to hit. Each has a test in the owning task.

1. Spoofing: a body `creationMethod`, body keys such as `createdByType`/`actor`, and `X-Postsider-*` headers can never change the actor columns (Tasks 3, 4, 5).
2. A retried `request-approval`, including two concurrent calls, must not reset the guest token, re-notify, re-emit the webhook or rewrite the requester, and must never return `guestToken` (Task 6).
3. A guest decision without a valid name and email returns 400 and resolves nothing; the shipped guest page must keep working, so the page sends both fields (Task 7); `GUEST_REVIEW_REQUIRE_IDENTITY=false` is only a rollout-ordering escape hatch (Tasks 6, 7).
4. An audit write that throws (synchronously or by rejection) or a missing `AuditLogger` must not break `createPost`, publishing, `request-approval` or the retry endpoint (Task 8).
5. Another organization's id on `audit-events`, `posts/:id/activity`, and a tampered cursor leak nothing; `audit:read` is absent from legacy keys, default-scoped new keys and OAuth tokens (Task 9).
6. Retention must never delete security or sign-in audit rows, only `type = 'resource'` rows older than 365 days (Task 12).
7. Provenance edge cases: exactly 255 characters is accepted, 256 is a 400 with no partial write, control characters are stripped, whitespace-only means absent, body beats header, an update without provenance keeps the stored values (Task 5).

## File Structure

New files:
- `libraries/nestjs-libraries/src/database/prisma/migrations/20261104120000_control_plane_identity_audit/migration.sql` - one additive migration.
- `libraries/nestjs-libraries/src/database/prisma/schema.control-plane-identity.spec.ts` - guards enum and field names against the generated client.
- `libraries/nestjs-libraries/src/actor/post-actor.ts` (+ `.spec.ts`) - pure: `PostActor`, column mapping, views, credential and user mapping.
- `libraries/nestjs-libraries/src/actor/actor-context.ts` (+ `.spec.ts`) - `AsyncLocalStorage` context.
- `libraries/nestjs-libraries/src/actor/post-provenance.ts` (+ `.spec.ts`) - provenance parsing and column mapping.
- `libraries/nestjs-libraries/src/database/prisma/audit/audit-events.ts` (+ `.spec.ts`) - event names, entry type, metadata sanitizer.
- `libraries/nestjs-libraries/src/database/prisma/audit/post-audit.ts` (+ `.spec.ts`) - never-throwing recorder wrapper.
- `libraries/nestjs-libraries/src/database/prisma/audit/audit-events.service.ts` (+ `.spec.ts`) - read side: list, cursor, item mapping.
- `libraries/nestjs-libraries/src/database/prisma/approval/approval.projection.ts` (+ `.spec.ts`) - public approval views.
- `libraries/nestjs-libraries/src/dtos/approval/guest-review-resolve.dto.ts` (+ `.spec.ts`).
- `libraries/nestjs-libraries/src/dtos/audit/list-audit-events.dto.ts`, `libraries/nestjs-libraries/src/dtos/posts/public-post-identity.dto.ts`, `libraries/nestjs-libraries/src/dtos/audit/public-audit-event.dto.ts` - request DTO and OpenAPI schema DTOs.
- `apps/backend/src/public-api/routes/v1/public.audit.controller.ts` (+ `.http.spec.ts`).
- `apps/frontend/src/lib/guest-review-identity.ts` (+ `.spec.ts`) - pure name and email validation for the guest page.

Modified (main ones): `schema.prisma`, `public.auth.middleware.ts`, `auth.middleware.ts`, `mcp-oauth.repository.ts`, `posts.repository.ts`, `integration.repository.ts` (`parkPostsForDeletedChannel`), `posts.service.ts`, `approval.repository.ts`, `approval.service.ts`, `audit.logger.ts`, `database.module.ts`, `public.integrations.controller.ts`, `public.api.module.ts`, `public.controller.ts`, `approval.controller.ts`, `public-api-scopes.ts`, `public-api-oauth-scopes.ts`, `public-webhook-events.ts`, `post.activity.ts`, `apps/mcp/src/client.ts`, `server.ts` and its frozen lists, `apps/frontend/src/lib/guest-review-api.ts`, `apps/frontend/src/components/guest-review-view.tsx`, `apps/frontend/src/lib/i18n/messages/en.ts` and `pl.ts`, `apps/frontend/src/app/settings/api/page.tsx`, `apps/orchestrator/src/activities/webhook.delivery.activity.ts`, `README.md`, `docs/API-MCP-TRUST.md`, the MCP skill `postsider-approval-workflow`.

Order note: the frontend task (7) sits right after the approval task because the approval task makes name and email mandatory; retention (12) sits just before docs.

Order note vs the brief: the brief listed "persist actor" after the helper; here the auth plumbing that feeds the helper (Task 3) is its own task, because the helper is useless until the middlewares bind it and that is where the spoofing tests live. Webhook payload changes (brief: exposure) are grouped in Task 10 even though the approval service is edited earlier, so each service file gets its audit and webhook edits in one pass per task.

## Validating the Prisma migration without production

The throwaway Postgres on port 55432 database `ps_cp` is running and migrated to Phase 1 (29 migrations).
1. `pg_isready -h localhost -p 55432` must say accepting connections. If not, start it: `LC_ALL=en_US.UTF-8 pg_ctl -D /private/tmp/claude-501/-Users-lukasz-APP-and-DEV-Project-PostSider--Project/418d9155-6f4d-4338-b135-fe3ba9262ba1/scratchpad/pgdata -o "-p 55432 -k /tmp/pgsock55432" -l /private/tmp/claude-501/-Users-lukasz-APP-and-DEV-Project-PostSider--Project/418d9155-6f4d-4338-b135-fe3ba9262ba1/scratchpad/pg.log start`.
2. `DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp pnpm exec prisma validate --schema $SCHEMA` must print `is valid`.
3. `pnpm exec prisma migrate deploy` applies only the new migration; `prisma migrate diff --from-url ... --to-schema-datamodel ... --exit-code` must exit 0 (no drift).
4. `pnpm exec prisma generate --schema $SCHEMA` regenerates the client so TypeScript sees the new fields.

---

### Task 1: Schema and migration

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (`model Post` ~402, `model PostApproval` ~1185, `model AuditLog` ~1097, enums near `enum CreationMethod` ~1015)
- Create: `libraries/nestjs-libraries/src/database/prisma/migrations/20261104120000_control_plane_identity_audit/migration.sql`
- Test: `libraries/nestjs-libraries/src/database/prisma/schema.control-plane-identity.spec.ts`

**Interfaces:**
- Produces: Prisma enum `PostActorType`; `Post` columns `createdByType PostActorType?`, `createdByUserId String?`, `createdByApiKeyId String?`, `createdByOAuthClientId String?`, the same four with prefix `lastModifiedBy`, and `agentName`, `workflowId`, `runId`, `externalRef`, `source` (`String? @db.VarChar(255)`); `PostApproval` columns `requestedByType PostActorType?`, `requestedByUserId String?`, `requestedByApiKeyId String?`, `requestedByOAuthClientId String?`, `decidedByType PostActorType?`, `guestName String? @db.VarChar(120)`, `guestEmail String? @db.VarChar(254)`; `AuditLog` columns `targetType String?`, `targetId String?`, `actorType PostActorType?`, `actorApiKeyId String?`, `actorOAuthClientId String?`, `metadata Json?`, indexes `@@index([organizationId, targetType, targetId, createdAt])` and `@@index([organizationId, createdAt])`. No foreign keys on any new column (spec R1).

- [ ] **Step 1: Write the failing test** `schema.control-plane-identity.spec.ts`

```ts
import { Prisma, PostActorType } from '@prisma/client';

const model = (name: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;
const field = (m: string, f: string) => model(m).fields.find((x) => x.name === f)!;

describe('control plane identity schema', () => {
  it('PostActorType has exactly four values', () => {
    expect(Object.values(PostActorType).sort()).toEqual(['API_KEY', 'OAUTH_CLIENT', 'SYSTEM', 'USER']);
  });
  it.each(['createdBy', 'lastModifiedBy'])('Post has the %s actor columns, nullable, no relation', (p) => {
    expect(field('Post', `${p}Type`)).toMatchObject({ type: 'PostActorType', isRequired: false });
    for (const s of ['UserId', 'ApiKeyId', 'OAuthClientId']) {
      expect(field('Post', `${p}${s}`)).toMatchObject({ type: 'String', isRequired: false, kind: 'scalar' });
    }
  });
  it.each(['agentName', 'workflowId', 'runId', 'externalRef', 'source'])('Post.%s is optional text', (f) => {
    expect(field('Post', f)).toMatchObject({ type: 'String', isRequired: false });
  });
  it('PostApproval has requester and decider attribution and guest identity', () => {
    for (const f of ['requestedByType', 'requestedByUserId', 'requestedByApiKeyId', 'requestedByOAuthClientId', 'decidedByType', 'guestName', 'guestEmail']) {
      expect(field('PostApproval', f).isRequired).toBe(false);
    }
    expect(field('PostApproval', 'decidedByType').type).toBe('PostActorType');
  });
  it('AuditLog has target, actor and metadata columns', () => {
    expect(field('AuditLog', 'targetType').isRequired).toBe(false);
    expect(field('AuditLog', 'actorType').type).toBe('PostActorType');
    expect(field('AuditLog', 'metadata').type).toBe('Json');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**
Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/schema.control-plane-identity.spec.ts --coverage=false`
Expected: FAIL (`PostActorType` undefined).

- [ ] **Step 3: Edit `schema.prisma`** exactly as the Interfaces block says; add `enum PostActorType { USER API_KEY OAUTH_CLIENT SYSTEM }` next to `CreationMethod`. Do not add relations or indexes on `Post`.

- [ ] **Step 4: Create `migration.sql`** (additive only):

```sql
CREATE TYPE "PostActorType" AS ENUM ('USER','API_KEY','OAUTH_CLIENT','SYSTEM');

ALTER TABLE "Post"
  ADD COLUMN "createdByType" "PostActorType",
  ADD COLUMN "createdByUserId" TEXT,
  ADD COLUMN "createdByApiKeyId" TEXT,
  ADD COLUMN "createdByOAuthClientId" TEXT,
  ADD COLUMN "lastModifiedByType" "PostActorType",
  ADD COLUMN "lastModifiedByUserId" TEXT,
  ADD COLUMN "lastModifiedByApiKeyId" TEXT,
  ADD COLUMN "lastModifiedByOAuthClientId" TEXT,
  ADD COLUMN "agentName" VARCHAR(255),
  ADD COLUMN "workflowId" VARCHAR(255),
  ADD COLUMN "runId" VARCHAR(255),
  ADD COLUMN "externalRef" VARCHAR(255),
  ADD COLUMN "source" VARCHAR(255);

ALTER TABLE "PostApproval"
  ADD COLUMN "requestedByType" "PostActorType",
  ADD COLUMN "requestedByUserId" TEXT,
  ADD COLUMN "requestedByApiKeyId" TEXT,
  ADD COLUMN "requestedByOAuthClientId" TEXT,
  ADD COLUMN "decidedByType" "PostActorType",
  ADD COLUMN "guestName" VARCHAR(120),
  ADD COLUMN "guestEmail" VARCHAR(254);

ALTER TABLE "AuditLog"
  ADD COLUMN "targetType" TEXT,
  ADD COLUMN "targetId" TEXT,
  ADD COLUMN "actorType" "PostActorType",
  ADD COLUMN "actorApiKeyId" TEXT,
  ADD COLUMN "actorOAuthClientId" TEXT,
  ADD COLUMN "metadata" JSONB;

CREATE INDEX "AuditLog_organizationId_targetType_targetId_createdAt_idx"
  ON "AuditLog"("organizationId","targetType","targetId","createdAt");
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId","createdAt");
```

- [ ] **Step 5: Validate, apply on the throwaway database, generate**
Run:
```
export DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp
SCHEMA=libraries/nestjs-libraries/src/database/prisma/schema.prisma
pnpm exec prisma validate --schema $SCHEMA
pnpm exec prisma migrate deploy --schema $SCHEMA
pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel $SCHEMA --exit-code
pnpm exec prisma generate --schema $SCHEMA
psql -h localhost -p 55432 -U postgres -d ps_cp -c 'select count(*) from "Post" where "createdByType" is not null'
psql -h localhost -p 55432 -U postgres -d ps_cp -c '\d "PostApproval"' | grep -E 'guestName|guestEmail|decidedByType'
```
Expected: `is valid`; migrate applies `20261104120000_control_plane_identity_audit`; the diff exits 0 (no output); generate succeeds; the count is `0` (existing rows untouched); `guestName` shows `character varying(120)`, `guestEmail` `character varying(254)`.

- [ ] **Step 6: Run the Step 2 command again.** Expected: PASS (all cases).

- [ ] **Step 7: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/schema.prisma libraries/nestjs-libraries/src/database/prisma/migrations/20261104120000_control_plane_identity_audit libraries/nestjs-libraries/src/database/prisma/schema.control-plane-identity.spec.ts
GIT commit -m "feat(db): actor, provenance, approval attribution and audit target columns"
```

---

### Task 2: Actor module and ambient context (pure, TDD)

**Files:**
- Create: `libraries/nestjs-libraries/src/actor/post-actor.ts`, `libraries/nestjs-libraries/src/actor/actor-context.ts`
- Test: `libraries/nestjs-libraries/src/actor/post-actor.spec.ts`, `libraries/nestjs-libraries/src/actor/actor-context.spec.ts`

**Interfaces:**
- Produces (`post-actor.ts`, no Nest or Prisma imports except `import type`):
```ts
export const POST_ACTOR_TYPES = ['USER', 'API_KEY', 'OAUTH_CLIENT', 'SYSTEM'] as const;
export type PostActorType = (typeof POST_ACTOR_TYPES)[number];
export type PostActor =
  | { type: 'USER'; userId: string }
  | { type: 'API_KEY'; apiKeyId: string | null }
  | { type: 'OAUTH_CLIENT'; oauthClientId: string | null; userId?: string | null } // userId = the human who authorized the grant
  | { type: 'SYSTEM' };
export const SYSTEM_ACTOR: PostActor;
export type ActorPrefix = 'createdBy' | 'lastModifiedBy' | 'requestedBy';
export type ActorColumns<P extends ActorPrefix> =
  { [K in `${P}Type`]: PostActorType | null } &
  { [K in `${P}UserId` | `${P}ApiKeyId` | `${P}OAuthClientId`]: string | null };
export function actorToColumns<P extends ActorPrefix>(actor: PostActor, prefix: P): ActorColumns<P>; // always all four keys
export type ActorView = { type: PostActorType; userId?: string; apiKeyId?: string; oauthClientId?: string }; // OAUTH_CLIENT views carry both oauthClientId and userId when known
export function actorViewFromColumns(row: Record<string, unknown> | null | undefined, prefix: ActorPrefix): ActorView | null; // null when `${prefix}Type` is null/absent; omits null ids
export type PublicApiCredentialLike = { type: 'legacy' | 'api-key' | 'oauth'; id?: string; oauthClientId?: string; oauthUserId?: string };
export function actorFromPublicCredential(c: PublicApiCredentialLike | null | undefined): PostActor;
export function actorFromUser(user: { id?: string | null } | null | undefined): PostActor; // USER, or SYSTEM when no id
```
- Produces (`actor-context.ts`):
```ts
export function runWithActor<T>(actor: PostActor, fn: () => T, opts?: { impersonatedBy?: string }): T;
export function runAsSystem<T>(fn: () => T): T;
export function currentActor(): PostActor; // SYSTEM_ACTOR outside any runWithActor
export function currentImpersonator(): string | undefined; // user id of the real (super admin) caller when the dashboard session is impersonating, else undefined
```

- [ ] **Step 1: Write failing tests** `post-actor.spec.ts`:
  - `POST_ACTOR_TYPES` equals `Object.values(PostActorType)` from `@prisma/client` (sorted).
  - `actorToColumns({type:'USER',userId:'u1'}, 'createdBy')` toEqual `{ createdByType:'USER', createdByUserId:'u1', createdByApiKeyId:null, createdByOAuthClientId:null }`; `API_KEY` with `apiKeyId:null` gives `lastModifiedByType:'API_KEY'` and all three ids null; `SYSTEM` gives only the type set; `OAUTH_CLIENT` with `'c1'` and no userId sets `requestedByOAuthClientId:'c1'` and `requestedByUserId:null`; `OAUTH_CLIENT` with `oauthClientId:'c1', userId:'u7'` sets both `createdByOAuthClientId:'c1'` and `createdByUserId:'u7'` with `createdByType:'OAUTH_CLIENT'` (the type stays OAUTH_CLIENT).
  - `actorFromPublicCredential`: `{type:'api-key',id:'k1'}` -> `{type:'API_KEY',apiKeyId:'k1'}`; `{type:'legacy'}` -> `{type:'API_KEY',apiKeyId:null}`; `{type:'oauth',oauthClientId:'c1',oauthUserId:'u7'}` -> `{type:'OAUTH_CLIENT',oauthClientId:'c1',userId:'u7'}`; `{type:'oauth',oauthClientId:'c1'}` -> `{type:'OAUTH_CLIENT',oauthClientId:'c1'}` (no userId key); `{type:'oauth'}` -> `oauthClientId:null`; `undefined` -> `SYSTEM_ACTOR`; an unknown `type` string cast in -> `SYSTEM_ACTOR`.
  - `actorFromUser({id:'u1'})` -> USER; `actorFromUser({})`, `null` -> SYSTEM.
  - `actorViewFromColumns({createdByType:'OAUTH_CLIENT',createdByOAuthClientId:'c1',createdByUserId:'u7'},'createdBy')` -> `{type:'OAUTH_CLIENT',oauthClientId:'c1',userId:'u7'}`; `actorViewFromColumns({createdByType:'API_KEY',createdByApiKeyId:'k1',createdByUserId:null},'createdBy')` toEqual `{type:'API_KEY',apiKeyId:'k1'}`; `{createdByType:null}` -> `null`; `undefined` row -> `null`.
  `actor-context.spec.ts`: `currentActor()` outside a run is `SYSTEM`; inside `runWithActor(userActor, async () => { await Promise.resolve(); await new Promise(r => setTimeout(r, 1)); return currentActor(); })` returns the user actor; a nested `runWithActor` overrides and the outer value is restored after it; `runAsSystem` inside a user run yields `SYSTEM`; two concurrent runs with different actors never see each other's value; `currentImpersonator()` is `undefined` by default, returns the id passed in `opts.impersonatedBy` inside the run and `undefined` again after it, and a nested run without `opts` clears it.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/actor --coverage=false`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** both files per the Interfaces block. `actor-context.ts` uses one module-level `AsyncLocalStorage<PostActor>` from `node:async_hooks`.
- [ ] **Step 4: Re-run Step 2 command.** Expected: PASS.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/actor
GIT commit -m "feat(actor): pure actor mapping and ambient actor context"
```

---

### Task 3: Bind the verified actor in both auth middlewares

**Files:**
- Modify: `apps/backend/src/services/auth/public.auth.middleware.ts` (set `oauthClientId` on the credential; wrap the final `next()`), `apps/backend/src/services/auth/auth.middleware.ts` (wrap the final `next()`), `libraries/nestjs-libraries/src/database/prisma/oauth/mcp-oauth.repository.ts` (`findActiveAccessForApi` ~348)
- Test: `apps/backend/src/services/auth/public.auth.middleware.spec.ts` (extend), `apps/backend/src/services/auth/auth.middleware.spec.ts` (extend), `libraries/nestjs-libraries/src/database/prisma/oauth/mcp-oauth.repository.api-access.spec.ts` (new)

**Interfaces:**
- Consumes: `actorFromPublicCredential`, `actorFromUser`, `runWithActor` (Task 2).
- Produces: `req.publicApiCredential` becomes `{ type: 'legacy' | 'api-key' | 'oauth'; id?: string; oauthClientId?: string; oauthUserId?: string }` (additive keys). `McpOAuthRepository.findActiveAccessForApi` result gains `mcpOAuthClientId: string` and `userId: string` (values `row.grant.mcpOAuthClientId` and `row.grant.userId`, both scalars the query already loads, so no extra query). Legacy OAuth: `oauthClientId = authorization.oauthAppId`, `oauthUserId = authorization.userId` (both on the spread row already). While `next()` runs, `currentActor()` returns the verified actor (type OAUTH_CLIENT, with the authorizing user id) and, for an impersonating dashboard session, `currentImpersonator()` returns the real super admin id.

- [ ] **Step 1: Write failing tests.** In the public middleware spec, using the file's existing harness, pass a `next` that records `currentActor()`:
  - API key credential `{credentialType:'api-key', apiKeyId:'k1'}` -> recorded `{type:'API_KEY', apiKeyId:'k1'}`.
  - Legacy org key (`credentialType:'legacy'`, no id) -> `{type:'API_KEY', apiKeyId:null}`.
  - MCP OAuth token whose repository result carries `mcpOAuthClientId:'mc1'` -> `req.publicApiCredential` toEqual `{type:'oauth', oauthClientId:'mc1', oauthUserId:'u7'}` and recorded actor `{type:'OAUTH_CLIENT', oauthClientId:'mc1', userId:'u7'}` (repository result carries `userId:'u7'`).
  - Legacy OAuth token whose authorization row has `oauthAppId:'app1'` and `userId:'u2'` -> `oauthClientId:'app1'`, `oauthUserId:'u2'`.
  - Spoof: request with header `x-postsider-actor-type: USER`, `x-postsider-agent: admin`, and `req.body = { creationMethod: 'WEB', createdByType: 'USER', actor: { type: 'USER', userId: 'victim' } }` on an API key -> recorded actor is still `API_KEY` `k1`.
  - A rejected credential (401) never calls `next` and leaves `currentActor()` as SYSTEM afterwards.
  In `auth.middleware.spec.ts` (dashboard): a request with a valid user `u1` records `{type:'USER', userId:'u1'}` inside `next`; with impersonation enabled (super admin `admin-1` impersonating `u9`) the recorded actor is `{type:'USER', userId:'u9'}` and `currentImpersonator()` is `'admin-1'`; without impersonation `currentImpersonator()` is `undefined`.
  `mcp-oauth.repository.api-access.spec.ts`: with a mocked `_access.model.mcpOAuthAccessToken.findFirst` returning a grant with `mcpOAuthClientId:'mc1'`, `userId:'u7'` and an active membership, `findActiveAccessForApi('h')` result `toMatchObject({ mcpOAuthGrantId: 'g1', mcpOAuthClientId: 'mc1', userId: 'u7' })`.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/backend/src/services/auth/public.auth.middleware.spec.ts apps/backend/src/services/auth/auth.middleware.spec.ts libraries/nestjs-libraries/src/database/prisma/oauth/mcp-oauth.repository.api-access.spec.ts --coverage=false`. Expected: FAIL on the new cases only.
- [ ] **Step 3: Implement.** In `PublicAuthMiddleware.use`, replace the trailing `next()` with `runWithActor(actorFromPublicCredential(req.publicApiCredential), () => next())`; in the OAuth branch set `req.publicApiCredential = { type: 'oauth', ...(clientId ? { oauthClientId: clientId } : {}) }` where `clientId = authorization.mcpOAuthClientId ?? authorization.oauthAppId`. In `AuthMiddleware.use` do the same with `actorFromUser(req.user)`; in the impersonation branch capture `const impersonatorId = user.id` BEFORE `user = loadImpersonate.user` and wrap that branch's own `next()` as `runWithActor(actorFromUser(user), () => next(), { impersonatedBy: impersonatorId })` (the branch returns early, so it needs its own wrap). Add `mcpOAuthClientId: row.grant.mcpOAuthClientId` to the object returned by `findActiveAccessForApi`. Do not touch any other OAuth code.
- [ ] **Step 4: Re-run Step 2 command.** Expected: PASS, and the pre-existing cases in those specs still pass.
- [ ] **Step 5: Commit**
```
GIT add apps/backend/src/services/auth libraries/nestjs-libraries/src/database/prisma/oauth
GIT commit -m "feat(auth): bind the verified actor for dashboard, API key and OAuth requests"
```

---

### Task 4: Persist the actor on every post write path

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts` (`createOrUpdatePost` ~784, `changeState` ~662, `changeDate` ~725, `claimErrorForRetry` ~622, `updateReleaseId` ~649, `deletePost` ~507, `updatePost` ~597, `claimPostForPublish` ~114, `resumePublishing` ~159), `libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts` (`parkPostsForDeletedChannel` ~971)
- Test: `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.actor.spec.ts` (new, same `build()` helper style as `posts.repository.reliability.spec.ts`), `libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.park-posts.spec.ts` (new)

**Interfaces:**
- Consumes: `actorToColumns`, `currentActor`, `SYSTEM_ACTOR` (Task 2).
- Produces: `createOrUpdatePost(state, orgId, date, body, tags, creationMethod, inter?, provenance?)` now returns `{ previousPost, posts, createdIds: string[] }` (`createdIds` = ids of rows that did not exist before the call). The `provenance?: PostProvenance` argument is added here as a typed pass-through; its persistence is Task 5 (import `type PostProvenance` from the Task 5 file is NOT allowed yet, so declare the parameter as `provenance?: Partial<Record<'agentName'|'workflowId'|'runId'|'externalRef'|'source', string>>` and spread it; Task 5 replaces the inline type).

- [ ] **Step 1: Write failing tests** (`posts.repository.actor.spec.ts`; wrap calls in `runWithActor`):
  - `createOrUpdatePost('schedule', ...)` as `{type:'API_KEY',apiKeyId:'k1'}` with `creationMethod 'CSV'`: `upsert.mock.calls[0][0].create` toMatchObject `{ createdByType:'API_KEY', createdByApiKeyId:'k1', createdByUserId:null, lastModifiedByType:'API_KEY', lastModifiedByApiKeyId:'k1', creationMethod:'CSV' }` (spoof: creationMethod does not change the actor); `.update` contains the four `lastModifiedBy*` keys and NO `createdBy*` key.
  - OAuth actor `{type:'OAUTH_CLIENT',oauthClientId:'c1',userId:'u7'}`: `create` toMatchObject `{ createdByType:'OAUTH_CLIENT', createdByOAuthClientId:'c1', createdByUserId:'u7', lastModifiedByType:'OAUTH_CLIENT', lastModifiedByUserId:'u7' }`.
  - No `runWithActor`: `create` has `createdByType:'SYSTEM'` and `lastModifiedByType:'SYSTEM'` with all ids null.
  - `createdIds`: `findFirst` returns `{id:'p-old',state:'QUEUE'}` for the first value (has `value.id`) and `null` for the second; with upsert mocks returning ids `p-old`, `p-new`, `createdIds` toEqual `['p-new']`.
  - `changeState('p1','PUBLISHED')` `update.data` toMatchObject `lastModifiedByType:'USER', lastModifiedByUserId:'u1'` under a USER run; `changeDate`, `claimErrorForRetry` (`updateMany.data`), `updateReleaseId`, `deletePost` (`updateMany.data` has `deletedAt` and the four `lastModifiedBy*`) likewise.
  - `updatePost('p1','rel','url','org')` under a USER run writes `lastModifiedByType:'SYSTEM'` (publish success is always SYSTEM).
  - `claimPostForPublish` HELD flip: the transaction mock's `post.update` data has `lastModifiedByType:'SYSTEM'`; `resumePublishing('org','to_draft')` each `post.update` data carries the ambient actor's columns.
  - `IntegrationRepository.prototype.parkPostsForDeletedChannel.call({ _posts: { model: { post: { updateMany } } } }, 'org', 'i1')` under a USER run: `data` toMatchObject `{ state:'DRAFT', lastModifiedByType:'USER', lastModifiedByUserId:'u1' }`.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/posts libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.park-posts.spec.ts --coverage=false`. Expected: FAIL on the new specs; existing specs still PASS (a few assertions that use `toEqual` on whole `data` objects may need the new keys, update them to `toMatchObject`).
- [ ] **Step 3: Implement.** Inside `updateData(type)` add `...(type === 'create' ? actorToColumns(actor, 'createdBy') : {})` and `...actorToColumns(actor, 'lastModifiedBy')`, with `const actor = currentActor()` read once per `createOrUpdatePost` call; collect `createdIds` from the `existing` lookup. In every other listed method spread `actorToColumns(currentActor(), 'lastModifiedBy')` into `data`; `updatePost` and `claimPostForPublish` use `SYSTEM_ACTOR` explicitly. Intentionally NOT changed: `recordPublishAttempt`, `updateImages`, evergreen `markRecycled`/`setEvergreen`. Leave the soft-delete cleanup `updateMany` for `body.group` (edit replacement) untouched.
- [ ] **Step 4: Re-run Step 2 command, then** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/posts --coverage=false`. Expected: all PASS.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/posts libraries/nestjs-libraries/src/database/prisma/integrations
GIT commit -m "feat(posts): persist created-by and last-modified-by actor on every write path"
```

---

### Task 5: Provenance parsing, validation and persistence

**Files:**
- Create: `libraries/nestjs-libraries/src/actor/post-provenance.ts`
- Modify: `posts.repository.ts` (replace the inline provenance type from Task 4, persist), `posts.service.ts` (`createPost` ~1343), `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` (`createPost` ~375, `updatePost` ~491)
- Test: `libraries/nestjs-libraries/src/actor/post-provenance.spec.ts`, `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.provenance.spec.ts`, `apps/backend/src/public-api/routes/v1/public.provenance.http.spec.ts` (harness copied from `public.retry-failed.http.spec.ts`)

**Interfaces:**
- Produces:
```ts
export const PROVENANCE_FIELDS = ['agentName','workflowId','runId','externalRef','source'] as const;
export type ProvenanceField = (typeof PROVENANCE_FIELDS)[number];
export type PostProvenance = Partial<Record<ProvenanceField, string>>;
export const PROVENANCE_HEADERS: Record<ProvenanceField, string>; // lower-case: x-postsider-agent, x-postsider-workflow-id, x-postsider-run-id, x-postsider-external-ref, x-postsider-source
export const PROVENANCE_MAX_LENGTH = 255;
export function parseProvenance(bodyProvenance: unknown, headers: Record<string, unknown>): PostProvenance; // throws BadRequestException
export function provenanceToColumns(p: PostProvenance | undefined): PostProvenance; // only defined keys
export function provenanceView(row: Record<string, unknown> | null | undefined): Record<ProvenanceField, string | null>;
```
- `PostsService.createPost(orgId, body, creationMethod, options: { provenance?: PostProvenance } = {}): Promise<any[]>` passes `options.provenance` as the 8th argument of `createOrUpdatePost` (after `body.inter`).
- Repository rule: on `create` the defined provenance keys are written; on `update` only the defined keys are written (absent keys keep their stored value); `{}` or `undefined` writes nothing.

- [ ] **Step 1: Write failing tests.** `post-provenance.spec.ts`:
  - trims `'  n8n  '` to `'n8n'`; strips `'a\u0000b\nc\u009fd'` to `'abcd'`; a whitespace-only or control-only value is absent (key not in result).
  - exactly 255 chars OK; 256 chars throws `BadRequestException` whose message contains `agentName` and `255`.
  - non-string body field (`{ runId: 5 }`) throws naming `runId`; `bodyProvenance` equal to `'x'`, `[]`, `5` throws; `null` and `undefined` mean "no body provenance".
  - body wins over header per field: body `{agentName:'body'}` + header `x-postsider-agent: header` gives `'body'`; header used when the body lacks the field; header value of 256 chars throws; array header values and non-string header values are ignored.
  - unknown keys (`{ prompt: 'secret', agentName: 'a' }`) are not in the output.
  `posts.repository.provenance.spec.ts` (mocked `upsert`): create data contains the given keys; update data contains only the given keys; update with `undefined` contains none of the five keys; no provenance key is ever written outside those five names.
  `public.provenance.http.spec.ts` (stubs `PostsService`, `PublicApiIdempotencyService`; scopes `posts:write`): `POST /posts` with body `provenance: {agentName:'ads-agent', runId:'r-1'}` and header `x-postsider-source: n8n` calls `createPost` with 4th arg `{ provenance: { agentName:'ads-agent', runId:'r-1', source:'n8n' } }`; a 256-char `workflowId` returns 400 and `createPost` is not called and `idempotency.claim` is not called; `creationMethod: 'WEB'` in the body still yields `'API'` as the third argument (unchanged) ; `PUT /posts/p1` passes the parsed provenance to `createPost`; a PUT with only `provenance` (no content fields) still returns the existing "Nothing to update" 400.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/actor/post-provenance.spec.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.provenance.spec.ts apps/backend/src/public-api/routes/v1/public.provenance.http.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** `post-provenance.ts` (normalize order: must be string, strip controls `/[\u0000-\u001F\u007F-\u009F]/g`, trim, empty is absent, length check). In the controller add `@Headers() headers: Record<string, unknown>` to `createPost` and `updatePost`, call `parseProvenance(rawBody?.provenance, headers)` BEFORE the idempotency claim and before any service call, and pass `{ provenance }`. Do not log provenance values.
- [ ] **Step 4: Re-run Step 2 command, then** `pnpm exec jest -c jest.config.ts apps/backend/src/public-api libraries/nestjs-libraries/src/database/prisma/posts --coverage=false`. Expected: PASS.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/actor libraries/nestjs-libraries/src/database/prisma/posts apps/backend/src/public-api
GIT commit -m "feat(api): claimed provenance on post create and update with strict validation"
```

---

### Task 6: Approval attribution, idempotent request, guest identity

**Files:**
- Create: `libraries/nestjs-libraries/src/database/prisma/approval/approval.projection.ts`, `libraries/nestjs-libraries/src/dtos/approval/guest-review-resolve.dto.ts`
- Modify: `approval.repository.ts`, `approval.service.ts`, `approval.controller.ts` (dashboard request response), `apps/backend/src/api/routes/public.controller.ts` (`resolveGuestReview` ~54), `public.integrations.controller.ts` (`requestApproval` ~601, `getApprovalStatus` ~615)
- Test: `approval.repository.spec.ts`, `approval.service.spec.ts` (extend), `approval.projection.spec.ts`, `guest-review-resolve.dto.spec.ts`, `apps/backend/src/public-api/routes/v1/public.approval.http.spec.ts`, `apps/backend/src/api/routes/public.controller.guest.spec.ts`

**Interfaces:**
- Consumes: `actorToColumns`, `currentActor`, `actorViewFromColumns` (Task 2).
- Produces (repository):
```ts
openRequest(orgId: string, postId: string, requestedById: string, actor: PostActor): Promise<{ approval: PostApproval; created: boolean }>
resolve(organizationId: string, id: string, approverId: string | null, status: 'APPROVED'|'REJECTED', note: string | null): Promise<number>   // now also sets decidedByType: approverId ? 'USER' : null
resolveByGuestToken(token: string, status: 'APPROVED'|'REJECTED', note: string | null, guest: { name: string; email: string } | null): Promise<number> // sets decidedByType null, guestName, guestEmail
```
`openRequest` algorithm: (1) `updateMany({ where: { postId, organizationId, status: { in: ['APPROVED','REJECTED'] } }, data: reopenData })` where `reopenData` sets `status 'PENDING'`, `requestedById`, `...actorToColumns(actor,'requestedBy')`, `requestedAt now`, and nulls `approverId`, `decidedByType`, `note`, `guestName`, `guestEmail`, `resolvedAt`, `guestToken`, `guestTokenExpiresAt`; count 1 means re-opened, return the row with `created: true`; (2) else `create` with the same requester columns, return `created: true`; (3) on Prisma `P2002` read the existing row, return `created: false` and change nothing; any other error is rethrown. Replaces `upsertRequest` (remove it).
- Produces (service):
```ts
export type ApprovalRequestResult = PostApproval & { created: boolean };
requestApproval(orgId: string, postId: string, requestedById: string, actor: PostActor = currentActor()): Promise<ApprovalRequestResult>
requestApprovalFromApi(orgId: string, postId: string): Promise<ApprovalRequestResult> // requestedById still from resolveApiRequester (notification routing only)
resolveGuestReview(token: string, action: 'approve'|'reject', note?: string, guest?: { name: string; email: string } | null)
```
- Produces (`approval.projection.ts`, pure):
```ts
export type ApprovalDeciderView = ActorView | { type: 'GUEST'; guestName: string | null; guestEmail: string | null };
export function toPublicApproval(row: Record<string, any>, created?: boolean): { id: string; postId: string; status: string; note: string | null; requestedAt: Date; resolvedAt: Date | null; requestedBy: ActorView | null; created?: boolean };
export function approvalDecidedByView(row: Record<string, any>): ApprovalDeciderView | null; // decidedByType set -> view (USER gets userId = row.approverId); else guestName/guestEmail present -> GUEST; else null
```
Never includes `guestToken`, `guestTokenExpiresAt` or `requestedById`.

The guest identity requirement stays ON by default. The switch `GUEST_REVIEW_REQUIRE_IDENTITY` is kept only for rollout ordering (backend and frontend deploy separately; the page from Task 7 must be live before the backend requires the fields): default `true`; an operator may set it to `false` while the old page is still served, then remove it.
- Produces (DTO): `GuestReviewResolveDto { action: 'approve'|'reject' (IsIn); note?: string (IsOptional IsString MaxLength 2000); guestName?: string (Transform trim, Length 1..120); guestEmail?: string (Transform trim+lower, IsEmail, MaxLength 254) }`; `guestName` and `guestEmail` are required unless `process.env.GUEST_REVIEW_REQUIRE_IDENTITY === 'false'` (use `@ValidateIf` reading the variable at validation time; when not required but supplied they are still validated).

Service flow: `assertRequestable(post)`, `openRequest`; when `created === false` return `{ ...approval, created: false }` with NO notification, webhook, audit or token change, except the heal rule: if the post state is `DRAFT` while an approval is PENDING, call `setPostState(orgId, postId, 'APPROVAL')` only; when `created === true` run the existing sequence (set `APPROVAL`, in-app notification, `notifyApprovers`, webhook `approval.requested`) and return `{ ...approval, created: true }`. `approve`/`reject` unchanged except the repository now records `decidedByType USER`.
Controllers: public `requestApproval` returns `toPublicApproval(result, result.created)` and sets HTTP 200 when `!created` (`@Res({ passthrough: true })`), 201 otherwise; `getApprovalStatus` keeps `status, note, requestedAt, resolvedAt` and adds `requestedBy` (`actorViewFromColumns(row,'requestedBy')`) and `decidedBy` (`approvalDecidedByView(row)`); dashboard `POST /approval/request` returns the row plus `created`. `public.controller.ts` uses `@Body() body: GuestReviewResolveDto`, builds `guest = body.guestName && body.guestEmail ? { name, email } : null`, and passes it down.

- [ ] **Step 1: Write failing tests.**
  - Repository (`approval.repository.spec.ts`): re-open path (`updateMany` count 1 then `findFirst` row) returns `created:true` and the `updateMany` `where.status` is `{ in: ['APPROVED','REJECTED'] }` and `data` toMatchObject `{ status:'PENDING', requestedByType:'API_KEY', requestedByApiKeyId:'k1', decidedByType:null, guestName:null, guestEmail:null, guestToken:null, guestTokenExpiresAt:null, resolvedAt:null }`; create path (count 0) returns `created:true` and `create.data` contains `requestedById` plus the actor columns; `create` rejecting `{ code:'P2002' }` returns `created:false` and no `update`/`updateMany` was called with `status:'PENDING'` data after it; another error is rethrown; `resolve` data contains `decidedByType:'USER'`; `resolveByGuestToken(...)` with a guest sets `guestName`, `guestEmail`, `decidedByType:null`, `approverId:null` and still clears the token.
  - Service (`approval.service.spec.ts`): an OAuth request inside `runWithActor({type:'OAUTH_CLIENT',oauthClientId:'c1',userId:'u7'})` passes that actor to `openRequest` (so `requestedByUserId:'u7'` with `requestedByType:'OAUTH_CLIENT'`); API request inside `runWithActor({type:'API_KEY',apiKeyId:'k1'})` calls `openRequest` with that actor and with `requestedById` equal to the resolved SUPERADMIN id (routing), and the persisted attribution columns come from the actor only (assert `actorToColumns` input, not the SUPERADMIN); `created:false` -> `setPostState`, `inAppNotification`, `notifyApprovers`, `deliver` all not called and the result has `created:false`; `created:false` with post state `DRAFT` -> only `setPostState('APPROVAL')` called; `created:true` -> all side effects once and `created:true`; guest resolve forwards `guest` to `resolveByGuestToken`; `approve` still calls `resolve` and the webhook as before.
  - Projection: `toPublicApproval` of a row containing `guestToken:'secret'`, `guestTokenExpiresAt`, `requestedById:'u-super'` returns no such keys (`JSON.stringify` does not contain `secret`); `requestedBy` from the columns; `approvalDecidedByView`: USER row -> `{type:'USER',userId:'u9'}` from `approverId`; guest row -> `{type:'GUEST',guestName:'Ann',guestEmail:'a@b.co'}`; undecided -> `null`.
  - DTO (`guest-review-resolve.dto.spec.ts`, use `plainToInstance` + `validate`): missing name -> error on `guestName`; 121 chars -> error; `'not-an-email'` -> error on `guestEmail`; 255-char email -> error; valid pair passes; trims `'  Ann  '`; with `process.env.GUEST_REVIEW_REQUIRE_IDENTITY='false'` the body `{action:'approve'}` passes, and `{action:'approve', guestEmail:'bad'}` still fails; `action:'maybe'` fails.
  - HTTP (`public.approval.http.spec.ts`): first `POST /posts/p1/request-approval` -> 201 and body toEqual keys without `guestToken`, with `created:true`; stub returning `created:false` -> 200 and the stored `guestToken` is absent from the body even though the stub row has one; `GET /posts/p1/approval` -> keeps the four old keys and has `requestedBy`/`decidedBy`; `status:'NONE'` unchanged.
  - Guest route (`public.controller.guest.spec.ts`, Nest testing module with `useMocker`): body without name -> 400 and `resolveGuestReview` not called; valid body -> called with `('tok','approve',undefined,{name:'Ann',email:'a@b.co'})`; flag `false` and no identity -> called with `guest: null`.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/approval libraries/nestjs-libraries/src/dtos/approval apps/backend/src/public-api/routes/v1/public.approval.http.spec.ts apps/backend/src/api/routes/public.controller.guest.spec.ts --coverage=false`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** per the Interfaces and Service flow blocks. Keep `guestName`/`guestEmail` out of `getForGuestReview`'s return (the guest page never receives them).
- [ ] **Step 4: Re-run Step 2 command.** Expected: PASS. Then `pnpm run build:backend` -> exit 0 (catches the removed `upsertRequest` and DTO typing).
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries apps/backend/src
GIT commit -m "feat(approval): real attribution, idempotent request and guest identity"
```

---

### Task 7: Frontend exception: guest review identity inputs and the `audit:read` scope checkbox

Scoped exception to D7, approved by the controller: exactly the files below, nothing else in `apps/frontend`.

**Files:**
- Create: `apps/frontend/src/lib/guest-review-identity.ts`
- Modify: `apps/frontend/src/lib/guest-review-api.ts` (`resolveGuestReview`), `apps/frontend/src/components/guest-review-view.tsx` (`GuestReviewView`), `apps/frontend/src/lib/i18n/messages/en.ts` (`guestReview` block ~1377) and `pl.ts` (`guestReview` block ~1499), `apps/frontend/src/app/settings/api/page.tsx` (`API_SCOPES` ~22)
- Test: `apps/frontend/src/lib/guest-review-identity.spec.ts`

How the frontend does i18n (verified): `useT()` from `@/lib/i18n`; the catalog `en.ts` is the source of truth and the fallback; the other nine locales (`ru zh fr de pt it ja ko tr pl`) are `DeepPartial<Messages>` and resolve missing keys from English. Only `en.ts` and `pl.ts` define a `guestReview` block today, so the new keys go in those two and every other locale falls back to English exactly as it does for the rest of that block. No new keys are added to the other nine locale files. Copy contains no em or en dashes.

**Interfaces:**
- Consumes: backend `POST /public/approval-review/:token/resolve` body `{ action, note?, guestName, guestEmail }` (Task 6).
- Produces:
```ts
// guest-review-identity.ts (pure, no React)
export const GUEST_NAME_MAX = 120;
export const GUEST_EMAIL_MAX = 254;
export type GuestIdentityError = 'nameRequired' | 'nameTooLong' | 'emailRequired' | 'emailInvalid' | 'emailTooLong';
export function validateGuestIdentity(name: string, email: string): { ok: true; name: string; email: string } | { ok: false; error: GuestIdentityError };
// guest-review-api.ts
export const resolveGuestReview: (token: string, action: 'approve'|'reject', identity: { name: string; email: string }, note?: string) => Promise<unknown>; // posts { action, note, guestName: identity.name, guestEmail: identity.email }
```
`validateGuestIdentity` trims both; name 1 to 120; email must match a simple `^[^\s@]+@[^\s@]+\.[^\s@]+$`, at most 254, returned trimmed (the backend lowercases). New `en.ts` keys under `guestReview` (copy exactly, Polish equivalents in `pl.ts`): `nameLabel: "Your name"`, `emailLabel: "Your email"`, `identityHint: "We record who made this decision."`, `nameRequired: "Enter your name."`, `nameTooLong: "Name must be 120 characters or fewer."`, `emailRequired: "Enter your email."`, `emailInvalid: "Enter a valid email address."`, `emailTooLong: "Email must be 254 characters or fewer."`. In `GuestReviewView`: two required text/email inputs (name, email) rendered above the Approve and Reject buttons, with `aria-invalid` and an inline error from the `guestReview.*` key matching the `GuestIdentityError`; both `act("approve")` and the confirm-reject click call `validateGuestIdentity` first and do not call the API when it fails; the values are sent with the request. In `settings/api/page.tsx` add `"audit:read",` to `API_SCOPES` after `"webhooks:write"`; the picker renders raw scope strings (no label keys exist for scopes), so no i18n key is needed for it, and `DEFAULT_API_SCOPES` stays unchanged so the scope is never preselected.

Test setup finding: `apps/frontend` has no component test runner (no jest/vitest in its `package.json`, no `@testing-library`), but the root Jest run already picks up pure `apps/frontend/src/lib/*.spec.ts` files (for example `utm-utils.spec.ts`). So the logic is tested as a pure function and the component is checked manually.

- [ ] **Step 1: Write the failing test** `guest-review-identity.spec.ts`: `validateGuestIdentity('', 'a@b.co')` -> `{ok:false,error:'nameRequired'}`; `'   '` name -> `nameRequired`; 121-char name -> `nameTooLong`, 120 chars -> ok; `('Ann','')` -> `emailRequired`; `'not-an-email'`, `'a@b'`, `'a b@c.de'` -> `emailInvalid`; an email of 255 chars (valid shape) -> `emailTooLong`; `('  Ann  ', '  a@b.co  ')` -> `{ok:true,name:'Ann',email:'a@b.co'}`.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/frontend/src/lib/guest-review-identity.spec.ts --coverage=false`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the helper, then the API function, the component, the two `guestReview` blocks and the `API_SCOPES` entry as described.
- [ ] **Step 4: Run** the Step 2 command (PASS), then `pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json` (exit 0; this also proves every `t("guestReview.*")` key is a valid `MessageKey`) and `pnpm --filter ./apps/frontend run lint` (exit 0).
- [ ] **Step 5: Manual check (no component runner).** With backend and frontend running locally and a pending approval with a guest link (`POST /approval/:id/guest-link` as an admin): open the link; clicking Approve with empty fields shows the inline name error and sends no request (network tab); entering a name and a bad email shows the email error; valid values approve successfully and the approval row (`psql ... 'select "guestName","guestEmail","decidedByType","status" from "PostApproval" where id = ...'`) shows the name and email, `decidedByType` null; repeat with Reject, which still shows the reason box and requires the same two fields; switch the UI language to Polish and confirm the new labels. Then in Settings -> API create-key form confirm `audit:read` appears unchecked, create a key with it, and confirm `GET /public/v1/audit-events` with that key returns 200 (after Task 9).
- [ ] **Step 6: Commit**
```
GIT add apps/frontend/src
GIT commit -m "feat(frontend): guest review name and email inputs and audit:read scope checkbox"
```

---

### Task 8: Audit writer and lifecycle hooks

**Files:**
- Create: `libraries/nestjs-libraries/src/database/prisma/audit/audit-events.ts`, `libraries/nestjs-libraries/src/database/prisma/audit/post-audit.ts`
- Modify: `audit.logger.ts` (add `logResourceEvent`), `posts.service.ts` (trailing `@Optional() private _audit?: AuditLogger`; hooks in `createPost`, `deletePost`, `changePostStatus`, `changeDate`, `setPostState`, `retryFailedRow`), `approval.service.ts` (trailing `@Optional() private _audit?: AuditLogger`; hooks in `requestApproval`, `approve`, `reject`, `resolveGuestReview`), `apps/orchestrator/src/activities/post.activity.ts` (trailing `@Optional() private _audit?: AuditLogger`; hooks in `sendWebhooks` and `_emitPostFailed`)
- Test: `audit-events.spec.ts`, `audit.logger.resource.spec.ts`, `post-audit.spec.ts`, `posts.service.audit.spec.ts`, `approval.service.audit.spec.ts`, `apps/orchestrator/src/activities/post.activity.audit.spec.ts`

**Interfaces:**
- Produces (`audit-events.ts`):
```ts
export const AUDIT_EVENT_TYPES = ['post.created','post.updated','post.deleted','post.status_changed','post.approval_requested','post.approval_resolved','post.published','post.failed','post.retry_requested'] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
export type AuditMetadata = Record<string, string | number | boolean | null>;
export interface ResourceAuditEntry {
  organizationId: string;
  event: AuditEventType;
  targetType: 'post';
  targetId: string;
  actor?: PostActor | null;     // undefined -> currentActor(); null -> no verified actor (guest)
  status?: 'ok' | 'error';      // default 'ok'
  metadata?: AuditMetadata;
}
export function sanitizeAuditMetadata(input: unknown): AuditMetadata; // primitives only, max 12 keys, strings cut to 200 chars, drops keys named content, text, error, token, secret, password, email
```
- Produces: `AuditLogger.logResourceEvent(entry: ResourceAuditEntry): Promise<void>` writing `{ organizationId, operation: entry.event, type: 'resource', targetType, targetId, actorType, actorUserId (the user id of a USER actor, or the authorizing user of an OAUTH_CLIENT actor), actorApiKeyId, actorOAuthClientId, status, correlationId: randomUUID(), inputHash: null, metadata }`; when `currentImpersonator()` is set, `metadata.impersonatedBy` is added automatically (value: the super admin user id); it catches and logs every error (never rejects). `recordPostEvent(audit: AuditLogger | undefined, entry: ResourceAuditEntry): Promise<void>` in `post-audit.ts` returns immediately when `audit` is undefined and wraps the call in try/catch so a synchronous throw or a rejection is swallowed.
- Event hooks, all through `recordPostEvent(this._audit, ...)` AFTER the primary write succeeded, awaited with the wrapper (cheap, never throws), metadata per spec R4:
  - `PostsService.createPost`: per channel, using `createdIds`: `post.created` when `createdIds.includes(posts[0].id)` else `post.updated`; metadata `{ state, integrationId, group, publishDate (ISO), creationMethod (created only) }`.
  - `deletePost`: read `getTopLevelPostsByGroup(orgId, group)` BEFORE deleting; one `post.deleted` per row `{ group, integrationId }`; nothing when the group is empty.
  - `changePostStatus`: `post.status_changed { from: previousState, to: state }`; `changeDate`: `post.status_changed { from, to }` for action `schedule`, `post.updated { publishDate }` for action `update`; `setPostState`: `post.status_changed { from, to }`.
  - `retryFailedRow`: after a successful claim and `startWorkflow`, `post.retry_requested { includeUnknownOutcome, previousErrorCategory }` (null when none); never for skipped rows.
  - `ApprovalService.requestApproval`: `post.approval_requested { approvalId }` only when `created`. `approve`/`reject`: `post.approval_resolved { approvalId, decision }` with the ambient actor; `resolveGuestReview`: `actor: null`, metadata `{ approvalId, decision, by: 'guest' }`.
  - `PostActivity.sendWebhooks`: `post.published { integrationId, releaseUrl }` with `actor: SYSTEM_ACTOR`; `_emitPostFailed`: `post.failed { errorCategory, errorRetryable }`, `status: 'error'`, `actor: SYSTEM_ACTOR`. The `releaseUrl` comes from the post row already loaded for the webhook.

- [ ] **Step 1: Write failing tests.**
  - `audit-events.spec.ts`: `AUDIT_EVENT_TYPES` has exactly the nine names in order; `sanitizeAuditMetadata({a:'x'.repeat(300), b:{n:1}, c:[1], content:'secret', d:5, e:null, f:true})` toEqual `{ a:'x'.repeat(200), d:5, e:null, f:true }`; 15 string keys -> 12 keys; non-object input -> `{}`.
  - `audit.logger.resource.spec.ts`: `create` called with `data` toMatchObject `{ organizationId:'o1', operation:'post.created', type:'resource', targetType:'post', targetId:'p1', actorType:'API_KEY', actorApiKeyId:'k1', actorUserId:null, status:'ok', inputHash:null }` under `runWithActor({type:'API_KEY',apiKeyId:'k1'})` and `correlationId` matches a UUID; USER actor sets `actorUserId`; an `OAUTH_CLIENT` actor with `userId:'u7'` sets `actorType:'OAUTH_CLIENT'`, `actorOAuthClientId` and `actorUserId:'u7'`; inside `runWithActor(userActor, fn, { impersonatedBy: 'admin-1' })` the stored `metadata` contains `impersonatedBy:'admin-1'` and outside it the key is absent; `actor: null` gives `actorType:null` and all actor ids null; default actor outside a run is `SYSTEM`; `create` rejecting does not reject `logResourceEvent` and `console.error` was called; the existing `logSecurityEvent`/`logAuthEvent` specs still pass (they must not set `targetType`).
  - `post-audit.spec.ts`: `recordPostEvent(undefined, e)` resolves; an `audit.logResourceEvent` that throws synchronously resolves; one that rejects resolves.
  - `posts.service.audit.spec.ts` (`Object.create(PostsService.prototype)` with stubs, as `posts.retry-failed.spec.ts` does): `createPost` with `createdIds` containing the first post emits `post.created` with `creationMethod` in metadata; with an empty `createdIds` emits `post.updated` without `creationMethod`; no metadata value contains the post content (assert `JSON.stringify(metadata)` lacks the content string); `logResourceEvent` rejecting still lets `createPost` resolve with its normal result; `_audit` undefined also resolves; `deletePost` emits one event per returned top-level row and none for an empty group; `changePostStatus` emits `{from:'DRAFT',to:'QUEUE'}`; `changeDate` schedule vs update emit the two different events; `retryFailedByGroup` over rows A requeued, B skipped emits exactly one `post.retry_requested` (for A).
  - `approval.service.audit.spec.ts`: `created:false` emits nothing; `created:true` emits `post.approval_requested` once; `approve` emits `post.approval_resolved` with `decision:'APPROVED'`; guest resolve emits with `actor: null` and `by:'guest'`.
  - `post.activity.audit.spec.ts` (build `PostActivity` as `post.activity.spec.ts` does, passing the audit stub last): `sendWebhooks` emits `post.published` with `{integrationId,releaseUrl}`; `markPublishFailed` emits `post.failed` with status `'error'` and the category, once; v1.0.8 `changeState(...,'ERROR',...)` also emits once; a rejecting audit stub leaves both activities resolving.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/audit libraries/nestjs-libraries/src/database/prisma/posts/posts.service.audit.spec.ts libraries/nestjs-libraries/src/database/prisma/approval/approval.service.audit.spec.ts apps/orchestrator/src/activities/post.activity.audit.spec.ts --coverage=false`. Expected: FAIL.
- [ ] **Step 3: Implement** the Interfaces. `logResourceEvent` reuses `AuditLogger.log`'s error-swallowing style but writes the new columns directly (do not widen the `AuditEntry` interface; keep `log()` untouched).
- [ ] **Step 4: Re-run Step 2 command, then** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma apps/orchestrator/src --coverage=false` and `pnpm run build:backend && pnpm run build:orchestrator`. Expected: PASS, builds exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/orchestrator/src
GIT commit -m "feat(audit): post lifecycle audit events written best-effort"
```

---

### Task 9: Audit read API, `audit:read` scope and post activity

**Files:**
- Create: `libraries/nestjs-libraries/src/database/prisma/audit/audit-events.service.ts`, `libraries/nestjs-libraries/src/dtos/audit/list-audit-events.dto.ts`, `libraries/nestjs-libraries/src/dtos/audit/public-audit-event.dto.ts`, `apps/backend/src/public-api/routes/v1/public.audit.controller.ts`
- Modify: `libraries/nestjs-libraries/src/services/public-api-scopes.ts`, `libraries/nestjs-libraries/src/services/public-api-oauth-scopes.ts`, `posts.repository.ts` + `posts.service.ts` (group ids lookup), `database.module.ts` (provider), `apps/backend/src/public-api/public.api.module.ts` (register controller), `public.integrations.controller.ts` (inject `AuditEventsService`, add the activity route)
- Test: `audit-events.service.spec.ts`, `apps/backend/src/public-api/routes/v1/public.audit.http.spec.ts`, extend `public.integrations.scopes.spec.ts`, `public-api.openapi.spec.ts`, `public-api-oauth-scopes.spec.ts` (if present on this branch, else add `libraries/nestjs-libraries/src/services/public-api-scopes.audit.spec.ts`)

**Interfaces:**
- Consumes: `AUDIT_EVENT_TYPES` (Task 8).
- Produces (`audit-events.service.ts`, `@Injectable()`, constructor `(private _auditLog: PrismaRepository<'auditLog'>)`):
```ts
export type AuditEventItem = { id: string; type: string; createdAt: Date; actor: { type: PostActorType | 'GUEST'; userId?: string; apiKeyId?: string; oauthClientId?: string }; target: { type: string; id: string }; metadata: Record<string, unknown> };
export interface AuditEventFilters { targetType?: string; targetIds?: string[]; type?: AuditEventType; from?: Date; to?: Date; limit: number; cursor?: string }
list(orgId: string, f: AuditEventFilters): Promise<{ events: AuditEventItem[]; nextCursor: string | null }>
static encodeCursor(createdAt: Date, id: string): string   // base64url of JSON {t: ISO string, i: id}
static decodeCursor(cursor: string): { createdAt: Date; id: string }   // BadRequestException('Invalid cursor')
static toItem(row: any): AuditEventItem   // actor.type: row.actorType ?? (row.metadata?.by === 'guest' ? 'GUEST' : 'SYSTEM'); userId from row.actorUserId; metadata null -> {}
```
`list` rules: `where` always has `organizationId: orgId` and `targetType: f.targetType ?? { not: null }`; `targetId: { in: f.targetIds }` when given (empty array returns `{ events: [], nextCursor: null }` without querying); `operation: f.type`; `createdAt` gte/lte; cursor adds `OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }]`; `orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]`; `take: limit + 1`; `nextCursor` is the cursor of the last returned item when an extra row existed, else `null`.
- `ListAuditEventsDto`: `targetType?` (`IsString MaxLength(50)`), `targetId?` (`IsString MaxLength(100)`), `type?` (`IsIn(AUDIT_EVENT_TYPES)`), `from?`/`to?` (`IsISO8601`), `limit?` (`@Type(() => Number) IsInt Min(1) Max(100)`, default 25 applied in the controller), `cursor?` (`IsString MaxLength(200)`).
- `PostsRepository.getPostIdsInGroupIncludingDeleted(orgId: string, postId: string): Promise<string[] | null>`: finds the row by `{ id, organizationId }` WITHOUT a `deletedAt` filter; null when absent; otherwise ids of all rows with the same `group` and `organizationId` (deleted included, comments included). Same-named passthrough on `PostsService`.
- Routes: `PublicAuditController` (`@Controller('/public/v1')`, `@UseGuards(PublicApiScopeGuard)`-style exactly like the other public controllers, `@ApiTags('Public API')`) `@Get('/audit-events') @RequirePublicApiScopes('audit:read')`. In `PublicIntegrationsController`: `@Get('/posts/:id/activity') @RequirePublicApiScopes('posts:read')` using `getPostIdsInGroupIncludingDeleted` (null -> `HttpException({ msg: 'Post not found' }, 404)`), then `list(org.id, { targetType: 'post', targetIds, limit, cursor, from, to, type })`. Both clamp `limit` default 25. `from > to` -> 400.
- Scopes: append `'audit:read'` to `PUBLIC_API_SCOPES`; `LEGACY_PUBLIC_API_SCOPES` filter becomes `!scope.startsWith('webhooks:') && scope !== 'audit:read'`; `grantedScopesForOAuth` unchanged (a test pins that no input list grants it).

- [ ] **Step 1: Write failing tests.**
  - Service: `where` for a plain call toMatchObject `{ organizationId:'org-1', targetType:{ not:null } }`; filters map to `operation`, `targetId.in`, `createdAt.gte/lte`; `take` equals `limit+1`; with `limit+1` rows returned the result has `limit` events and a non-null `nextCursor` that decodes to the last returned row, and with fewer rows `nextCursor` is `null`; a cursor adds the `OR` clause with `lt` on `createdAt` and the tie-break on `id`; `decodeCursor('###')`, a cursor whose JSON lacks `t`/`i`, and a cursor with `t:'nope'` each throw `BadRequestException`; empty `targetIds` returns empty without calling `findMany`; `toItem` cases: `API_KEY` row with `actorApiKeyId:'k1'` -> `actor` toEqual `{type:'API_KEY',apiKeyId:'k1'}`; USER row -> `userId` from `actorUserId`; row with `actorType:null` and `metadata:{by:'guest'}` -> `GUEST`; `actorType:null` otherwise -> `SYSTEM`; `metadata:null` -> `{}`; the item has no `correlationId`, `inputHash`, `organizationId` keys.
  - HTTP (`public.audit.http.spec.ts`, harness like `public.retry-failed.http.spec.ts`, stubs `AuditEventsService`, `PostsService`): `GET /audit-events` with scopes lacking `audit:read` -> 403; with it -> 200 and `list` called with `('org-1', { limit: 25 })`; `?limit=101` -> 400; `?limit=0` -> 400; `?type=post.exploded` -> 400; `?from=2026-02-01&to=2026-01-01` -> 400; a malformed `cursor` (service throws `BadRequestException`) -> 400; `?targetType=post&targetId=p1&type=post.published&limit=10` passes the parsed filters (`limit: 10` as a number); the org passed is always `req.org.id` even when the query contains `organizationId=other`. `GET /posts/p1/activity` with `posts:read` -> 200 and `list` called with `targetType:'post'` and the ids from `getPostIdsInGroupIncludingDeleted`; unknown or foreign id (stub returns `null`) -> 404 and `list` not called; scopes `['audit:read']` only -> 403.
  - Scopes: `PUBLIC_API_SCOPES` contains `audit:read`; `LEGACY_PUBLIC_API_SCOPES` does not; `grantedScopesForOAuth(['posts:read','posts:write','channels:write'])` does not; `grantedScopesForOAuth(undefined)` (legacy OAuth) does not; `CreateApiKeyDto` validation accepts `scopes:['audit:read']`. Extend `public.integrations.scopes.spec.ts` `it.each` with `['getPostActivity', ['posts:read']]`; add a controller contract for `PublicAuditController`: exactly one handler, scopes `['audit:read']`. OpenAPI spec: document has `/public/v1/audit-events` get and `/public/v1/posts/{id}/activity` get, and `components.schemas.PublicAuditEventDto` exists.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/audit libraries/nestjs-libraries/src/services apps/backend/src/public-api --coverage=false`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** per the Interfaces. Add `@ApiOperation`/`@ApiOkResponse` to both routes (description names the nine events and says metadata never contains post content). Register `AuditEventsService` in `DatabaseModule.providers`; register `PublicAuditController` in `authenticatedController` of `public.api.module.ts` (it then gets the existing auth middleware and request-id middleware). Do not add routes to `PublicWorkspaceController` (its handler count is frozen at 14).
- [ ] **Step 4: Re-run Step 2 command, then** `pnpm run build:backend`. Expected: PASS, build exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src
GIT commit -m "feat(api): audit events read API with audit:read scope and post activity route"
```

---

### Task 10: Expose actor and provenance on posts and webhooks

**Files:**
- Create: `libraries/nestjs-libraries/src/dtos/posts/public-post-identity.dto.ts`
- Modify: `posts.repository.ts` (`getPosts` select ~330; new `getPostIdentity`), `posts.service.ts` (`getPostIdentity`), `post.activity.ts` (`sendWebhooks`, `_emitPostFailed`), `approval.service.ts` (`emitWebhook`), `libraries/nestjs-libraries/src/services/public-webhook-events.ts` (samples), `public.integrations.controller.ts` (`@ApiExtraModels` and descriptions)
- Test: extend `posts.exposure.spec.ts`; `posts.identity.spec.ts`, `apps/orchestrator/src/activities/post.activity.identity.spec.ts`, `approval.service.webhook.spec.ts`, `public-webhook-events.identity.spec.ts`, `apps/backend/src/public-api/routes/v1/public.identity.openapi.spec.ts`

**Interfaces:**
- Consumes: `actorViewFromColumns`, `provenanceView` (Tasks 2, 5), `approvalDecidedByView` (Task 6).
- Produces: `PostsRepository.getPostIdentity(orgId: string, postId: string)` selecting the 8 actor columns and 5 provenance columns of `{ id: postId, organizationId: orgId }` (deleted rows included). `PostsService.getPostIdentity(orgId: string, postId: string): Promise<{ actor: { createdBy: ActorView | null; lastModifiedBy: ActorView | null }; provenance: Record<ProvenanceField, string | null> }>` (all-null shape when the row is missing; never throws). Webhook data additions (additive): `post.published` and `post.failed` gain `actor` and `provenance`; `approval.requested` and `approval.resolved` gain `actor`, `provenance` and `approval: { requestedBy: ActorView | null; decidedBy: ApprovalDeciderView | null }`. `PublicPostIdentityFieldsDto` documents the 13 raw columns for OpenAPI.

- [ ] **Step 1: Write failing tests.**
  - `posts.exposure.spec.ts` (extend): `getPosts` select toMatchObject `{ createdByType:true, createdByUserId:true, createdByApiKeyId:true, createdByOAuthClientId:true, lastModifiedByType:true, lastModifiedByUserId:true, lastModifiedByApiKeyId:true, lastModifiedByOAuthClientId:true, agentName:true, workflowId:true, runId:true, externalRef:true, source:true }` while the Phase 1 keys remain; `getPost` result rows carry `createdByType`, `agentName` etc. through, and still no integration `token`, `refreshToken`, `customInstanceDetails`.
  - `posts.identity.spec.ts`: row with `createdByType:'API_KEY', createdByApiKeyId:'k1', lastModifiedByType:'SYSTEM', agentName:'bot', source:'mcp'` -> `{ actor:{ createdBy:{type:'API_KEY',apiKeyId:'k1'}, lastModifiedBy:{type:'SYSTEM'} }, provenance:{ agentName:'bot', workflowId:null, runId:null, externalRef:null, source:'mcp' } }`; legacy row with all nulls -> `{ actor:{createdBy:null,lastModifiedBy:null}, provenance: all null }`; missing row -> same all-null shape; repository query always includes `organizationId`.
  - `post.activity.identity.spec.ts`: `sendWebhooks` calls `deliver(orgId,'post.published', data)` with `data` toMatchObject `{ post: expect.anything(), actor: {...}, provenance: {...} }` and the legacy per-webhook body stays `JSON.stringify(post)` unchanged; `_emitPostFailed` data keeps `postId, error, errorCategory, errorRetryable, post` and adds `actor`, `provenance`; `getPostIdentity` rejecting still delivers (identity falls back to the all-null shape).
  - `approval.service.webhook.spec.ts`: `approval.requested` data has `actor`, `provenance` and `approval.requestedBy` equal to the actor view of the approval row; `approval.resolved` by in-app approve has `approval.decidedBy` `{type:'USER',userId}`; guest resolve has `decidedBy` `{type:'GUEST',guestName,guestEmail}`; existing keys `approvalId, postId, status, note` unchanged.
  - `public-webhook-events.identity.spec.ts`: every sample has `actor` and `provenance` objects; the two approval samples also have `approval`; the original sample keys still exist.
  - `public.identity.openapi.spec.ts` (pattern of `public.reliability.openapi.spec.ts`, `extraModels: [PublicPostIdentityFieldsDto]`): the schema exposes the 13 property names.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/posts libraries/nestjs-libraries/src/database/prisma/approval libraries/nestjs-libraries/src/services apps/orchestrator/src/activities apps/backend/src/public-api --coverage=false`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** per the Interfaces. In `ApprovalService.emitWebhook` accept an `approvalRow` and build `approval` from it (`actorViewFromColumns(row,'requestedBy')`, `approvalDecidedByView(row)`); re-read the row after `resolve`/`resolveByGuestToken` (one extra `getById`-style read, org scoped) so `decidedBy` is accurate. Identity lookups are best effort: wrap in try/catch and fall back to the all-null shape, so identity can never block an event.
- [ ] **Step 4: Re-run Step 2 command, then** `pnpm run build:backend && pnpm run build:orchestrator`. Expected: PASS, builds exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/orchestrator/src apps/backend/src
GIT commit -m "feat(api): expose verified actor and claimed provenance on posts and webhooks"
```

---

### Task 11: MCP source header, agent name, `postsider_get_post_activity` and frozen lists

**Files:**
- Modify: `apps/mcp/src/client.ts` (headers in `request` ~269; `setAgentName`), `apps/mcp/src/server.ts` (register the tool after `postsider_get_post` ~417; wire `oninitialized`), `apps/mcp/src/__tests__/tool-inventory.ts`, `apps/mcp/src/__tests__/http-transport.spec.ts:218`, `apps/mcp/scripts/tarball-smoke.mjs` (`EXPECTED_TOOL_COUNT`), `apps/mcp/README.md` (count line 139, Read table), `apps/mcp/server.json` (`toolCount`), `apps/mcp/chatgpt-app-submission.json`, `apps/mcp/CHANGELOG.md`
- Test: `apps/mcp/src/__tests__/client.spec.ts` (extend), `server.spec.ts` (extend), `tool-inventory.ts` (edit)

**Interfaces:**
- Consumes: REST routes `GET /posts/:id/activity` (Task 9).
- Produces: `PostsiderClient.setAgentName(name: string | undefined): void`; every request sends `X-Postsider-Source: mcp`, and `X-Postsider-Agent: <sanitized name>` once a name is set (sanitize: keep printable ASCII `0x20-0x7E`, collapse runs of whitespace, trim, cut to 255, omit when empty). Tool `postsider_get_post_activity`, input `{ postId: nonEmptyId, limit?: number (int 1..100), cursor?: string (1..200) }`, annotations `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }`, calls `client.get('/posts/' + encodeURIComponent(postId) + '/activity', { limit, cursor })` and returns `ok(result)`. Description (no dashes): `List who did what to a post and when: created, edited, approval requested or decided, published, failed, retried or deleted. Each event shows the verified actor (user, API key, OAuth client or system) and a small metadata object, never post content. Newest first; pass nextCursor back as cursor for older events. Use it to explain how a post reached its current state.` In `createPostSiderMcpServer`, after creating `server`, set `server.server.oninitialized = () => { const name = server.server.getClientVersion()?.name; if (typeof (client as any).setAgentName === 'function') (client as any).setAgentName(name); }` (the scope-guarded HTTP client has no `setAgentName`, which is correct: the stateless HTTP transport never sees `initialize`, so no agent name is sent there).
- Counts: 39 over HTTP, 40 on stdio. Frozen lists to update: `EXPECTED_TOOL_NAMES` (+1, keep sorted as the file does), `EXPECTED_TOOL_COUNT = 39`, `EXPECTED_TOOL_ANNOTATIONS` entry, `toHaveLength(39)`, tarball-smoke `EXPECTED_TOOL_COUNT = 39`, README line becomes `39 tools (40 on the local stdio server), all prefixed \`postsider_\`.` and a Read-table row `postsider_get_post_activity | Who did what to a post and when (verified actor, approvals, publish and retry events), newest first.`, `server.json` `"toolCount": 39`, `chatgpt-app-submission.json` entry mirroring `postsider_get_post` (read-only justification: reads the audit trail of the caller's own post).

- [ ] **Step 1: Write failing tests / edit frozen lists first.** `tool-inventory.ts` and `http-transport.spec.ts` as above. `client.spec.ts` (fetch mocked as that file does): every request has header `X-Postsider-Source` equal to `mcp`; after `setAgentName('Claude Desktop')` header `X-Postsider-Agent` equals `Claude Desktop`; names `'bad\nnameé'` -> `'badname'`, a 300-char name -> exactly 255 chars, `undefined` and `'   '` -> header absent; the existing `Authorization`, `Content-Type`, `Idempotency-Key` header tests still pass. `server.spec.ts`: using the in-memory client that file already uses with `clientInfo.name = 'test-agent'`, one tool call results in an outbound request carrying `X-Postsider-Agent: test-agent`; calling `postsider_get_post_activity` with `{ postId: 'p 1', limit: 10, cursor: 'abc' }` requests exactly `/posts/p%201/activity?limit=10&cursor=abc` with method GET; `limit: 0` and `limit: 101` are rejected by the schema; the tool's registered annotations equal the frozen entry.
- [ ] **Step 2: Run** `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --runInBand`. Expected: FAIL (inventory mismatch, tool and header missing).
- [ ] **Step 3: Implement** per the Interfaces; update README, `server.json`, ChatGPT submission file and CHANGELOG (`Unreleased / Added`: the new tool; every request now identifies itself with `X-Postsider-Source: mcp` and, on stdio, the MCP client name as `X-Postsider-Agent`).
- [ ] **Step 4: Run** `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --runInBand` -> PASS; then `pnpm --filter @postsider/mcp run typecheck && pnpm --filter @postsider/mcp run typecheck:tests && pnpm --filter @postsider/mcp run version:gate && pnpm --filter @postsider/mcp run validate:registry && pnpm --filter @postsider/mcp run smoke:tarball` -> all exit 0.
- [ ] **Step 5: Commit**
```
GIT add apps/mcp
GIT commit -m "feat(mcp): source and agent headers, postsider_get_post_activity and frozen lists"
```

---

### Task 12: Audit retention (365 days, resource events only)

**Files:**
- Modify: `apps/orchestrator/src/activities/webhook.delivery.activity.ts` (`purgeExpiredPublicApiRecords`). Do NOT change `apps/orchestrator/src/workflows/public.api.retention.workflow.ts`: it already calls `purgeExpiredPublicApiRecords()` daily and ignores the return value, so extending the activity is enough.
- Test: `apps/orchestrator/src/activities/webhook.delivery.activity.spec.ts` (extend; it already tests the purge with fake delegates)

**Interfaces:**
- Produces: `export const AUDIT_RESOURCE_RETENTION_DAYS = 365;` and `purgeExpiredPublicApiRecords(now?: Date): Promise<{ deliveries: number; idempotency: number; auditEvents: number }>` (one new key). The audit purge uses the existing private `purgeInBatches` with `this._prisma.auditLog` and `where: { type: 'resource', createdAt: { lt: now - 365 days } }` (batches of `PURGE_BATCH`, uses the existing `AuditLog_createdAt_idx`). The `where` has exactly those two conditions: `type` is the literal `'resource'`, so security and sign-in rows (`type: 'security'`, other categories, `null`) are never matched.

- [ ] **Step 1: Write the failing tests** (extend the existing spec's fake-prisma setup with an `auditLog` delegate): the call returns `{ deliveries, idempotency, auditEvents }` with `auditEvents` equal to the deleted count; the `auditLog.findMany` `where` toEqual `{ type: 'resource', createdAt: { lt: <now minus 365 days> } }` (assert the exact date for a fixed `now`, and that a row 364 days old is outside the filter); `where` has no `OR`, no `type: { not: ... }` and no `operation` key; batching loops while a full batch of 5000 is returned and stops on a short batch; an `auditLog.deleteMany` failure does not stop the delivery and idempotency purges that ran first, but is rethrown after them so Temporal retries (order: deliveries, idempotency, audit); the existing assertions on `deliveries`/`idempotency` still pass (switch any `toEqual({deliveries, idempotency})` to `toMatchObject`). If `publicApiRetentionWorkflow` has a spec, it still passes unchanged.
- [ ] **Step 2: Run** `pnpm exec jest -c jest.config.ts apps/orchestrator/src/activities/webhook.delivery.activity.spec.ts apps/orchestrator/src/workflows/public.api.retention.workflow.spec.ts --coverage=false`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement** the constant, the third purge and the return key. Confirm `PrismaService` exposes `auditLog` (it does, as a generated delegate); no module wiring changes.
- [ ] **Step 4: Re-run Step 2 command, then** `pnpm run build:orchestrator`. Expected: PASS, build exit 0.
- [ ] **Step 5: Commit**
```
GIT add apps/orchestrator/src/activities
GIT commit -m "feat(audit): purge resource audit events older than 365 days"
```

---

### Task 13: Documentation, skill text and final verification

**Files:**
- Modify: `README.md` (new subsections after `### Webhooks` ~266 and a scope mention in the Public API section), `docs/API-MCP-TRUST.md` (route table near line 35, scoped credentials section ~84, errors), `apps/mcp/skills/postsider-approval-workflow/SKILL.md`, `libraries/helpers/src/swagger/load.swagger.ts` description only if it lists scopes (check first)
- Test: `apps/mcp/src/__tests__/manifests.spec.ts` and the full suites below (no new spec; docs are verified by grep)

**Interfaces:** none (docs). Content requirements:
- README `### Who did what: actor, claimed provenance and audit events`: verified actor (`createdBy*`, `lastModifiedBy*`, types USER, API_KEY, OAUTH_CLIENT, SYSTEM; an OAuth client actor also records the user who authorized it; set by the server, cannot be supplied; `creationMethod` is a hint only), claimed provenance (`provenance` body object and the five headers, 255 character limit, body wins, never put prompts or post content in it, treat as untrusted text), legacy organization keys show as an API key without an id, `GET /public/v1/audit-events` (scope `audit:read`, not granted by default, filters, cursor, newest first), `GET /public/v1/posts/:id/activity`, the nine event names, webhook `actor` and `provenance` fields.
- README audit retention and impersonation: resource audit events are kept 365 days and security/sign-in rows are never purged by this job; when a super admin impersonates a user the recorded actor is the impersonated user and events carry `metadata.impersonatedBy` (the super admin id); this is documented as a known residual, not a fix.
- README `### Approval requests`: `request-approval` is idempotent (`created: false`, HTTP 200, nothing re-sent), real attribution, guest reviewers give name and email, the guest page now asks for name and email, and the `GUEST_REVIEW_REQUIRE_IDENTITY` switch exists only for deploy ordering (default on).
- `docs/API-MCP-TRUST.md`: route table rows for `GET /audit-events` and `GET /posts/{id}/activity`; a short "Actor versus claimed provenance" section; the approval idempotency contract; statement that MCP OAuth tokens cannot read `/audit-events` but can read a post's activity.
- Skill: step 5 of the workflow says `postsider_request_approval` is idempotent: if an approval is already pending it returns it unchanged with `created: false`, without notifying reviewers again, so a retry after an error or timeout is safe; report `created` in the output list. No other behavior change.

- [ ] **Step 1: Write the docs** per the requirements above.
- [ ] **Step 2: Verify no dashes were added and docs mention the real names.**
Run:
```
GIT diff -U0 | grep '^+' | LC_ALL=en_US.UTF-8 grep -nP '[\x{2013}\x{2014}]'
GIT diff --cached -U0 | grep '^+' | LC_ALL=en_US.UTF-8 grep -nP '[\x{2013}\x{2014}]'
grep -n "audit:read\|GUEST_REVIEW_REQUIRE_IDENTITY\|post.retry_requested\|X-Postsider-Run-Id" README.md docs/API-MCP-TRUST.md
```
Expected: the two dash greps print nothing; the last grep shows all four terms in the docs.
- [ ] **Step 3: Full verification.**
Run:
```
pnpm exec jest -c jest.config.ts --coverage=false
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --runInBand
pnpm run build:backend && pnpm run build:orchestrator
DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp pnpm exec prisma migrate diff --from-url postgresql://postgres@localhost:55432/ps_cp --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma --exit-code
```
Expected: all suites PASS (the root run includes every spec added above), builds exit 0, migrate diff exits 0. If a pre-existing unrelated root spec fails, confirm it fails identically on `feat/control-plane-p1-reliability` (`GIT stash` is forbidden; use `GIT worktree` or `GIT diff --stat` reasoning) before ignoring it.
- [ ] **Step 4: Commit**
```
GIT add README.md docs/API-MCP-TRUST.md apps/mcp/skills
GIT commit -m "docs: actor versus provenance, audit events API, approval idempotency"
```

---

## Self-Review

- Spec coverage: R1 (Tasks 1, 2, 3, 4), R2 (Tasks 1, 5, 11), R3 (Tasks 1, 6, 7), R4 (Tasks 1, 8), R5 (Tasks 7 for the scope checkbox, 9, 11), R6 (Tasks 10, 11), R7 (frontend exception limited to Task 7; only env var `GUEST_REVIEW_REQUIRE_IDENTITY`, Task 6), R8 (Tasks 11, 13), R9 retention (Task 12). The PR #36 overlap and rollout live in the spec (sections 5 and 6).
- Type consistency: `PostActor`/`ActorView`/`actorToColumns` (Task 2, OAUTH_CLIENT now carries `userId`) are consumed unchanged by Tasks 3, 4, 6, 8, 10; `currentImpersonator` (Task 2) is set in Task 3 and read in Task 8; `PostProvenance` (Task 5) replaces the inline type introduced in Task 4; `ApprovalRequestResult.created` (Task 6) is read by Task 8 hooks; the guest body fields (Task 6) are what Task 7 sends; `AUDIT_EVENT_TYPES` (Task 8) feeds `ListAuditEventsDto` (Task 9); `approvalDecidedByView` (Task 6) is reused in Task 10; the `type = 'resource'` category written in Task 8 is the only thing Task 12 deletes.
- Known ordering hazard: Task 4 references provenance before Task 5 defines the type; the inline structural type in Task 4 makes each task compile on its own. The manual check in Task 7 Step 5 uses the audit route from Task 9, so run that last sentence after Task 9.
