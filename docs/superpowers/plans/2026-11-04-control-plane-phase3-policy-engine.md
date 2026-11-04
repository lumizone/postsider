# Control Plane Phase 3: Policy Engine v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner limit what an automation may do: per API key action and channel limits, plus organization policy rules (require approval or block) evaluated by one pure evaluator at write time and again at publish time, with a scoped management API, a dry run route and one MCP tool.

**Architecture:** A pure policy module (`libraries/nestjs-libraries/src/policies/*`) holds condition parsing, window math and `evaluatePolicies`. A service layer loads rules and daily counts and builds contexts. A write-time gate service sits above `PostsService` and `ApprovalService` and is called by the public controllers; a publish-time guard runs in the `publishPostById` activity pre-call phase and reuses the frozen v1.0.9 workflow outcomes (`failed`, `already_published`). Key limits live on `ApiKey` and are enforced from an ambient context set by the public auth middleware.

**Tech Stack:** NestJS, Prisma 6.5.0 (PostgreSQL), Temporal activities (orchestrator), Jest 29 + ts-jest, class-validator, MCP SDK (ESM) for `apps/mcp`.

**Spec:** `docs/superpowers/specs/2026-11-04-control-plane-phase3-policy-engine.md` (read it first; it holds the verified facts, the corrections to the decisions, the exact condition semantics and the open questions).

## Global Constraints

Every task implicitly includes these.

- Git binary: `/Library/Developer/CommandLineTools/usr/bin/git` (`/usr/bin/git` exits 69 on this host). In commands below `GIT` means that path. Work only in the worktree `postsider-wt-control-plane-p3` on branch `feat/control-plane-p3-policy`. Never push, never force, never `git stash` without a unique tag.
- Commit trailer on every commit message: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prisma: schema changes ship ONLY as migration files under `libraries/nestjs-libraries/src/database/prisma/migrations/`. Never `db push`. Schema path: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (`SCHEMA` below).
- No em dashes or en dashes (U+2014, U+2013) in any added line: user-facing copy, API messages, docs, README, MCP descriptions, comments, rule failure messages. Use `-` or rewrite.
- Exact names. `PostAction`: `DRAFT`, `SCHEDULE`, `PUBLISH_NOW`. `PolicyCondition`: `ALWAYS`, `CONTAINS_LINK`, `CONTAINS_WORDS`, `OUTSIDE_WINDOW`, `DAILY_CAP_EXCEEDED`, `PUBLISH_NOW`, `HAS_VIDEO`. `PolicyEffect`: `REQUIRE_APPROVAL`, `BLOCK`. New `PublishErrorCategory` value: `POLICY_BLOCKED`. New audit event: `post.policy_evaluated`. Error codes: `key_action_not_allowed`, `key_channel_not_allowed`, `policy_blocked`, `policy_limit_reached`. Scopes: `policies:read`, `policies:write`. MCP tool: `postsider_check_policy`. Limits: rule name 1 to 120; priority 0 to 1000 (default 100); filter arrays at most 100; at most 50 enabled and 200 non-deleted rules per organization; words 1 to 100 entries of 1 to 100 characters; key `allowedIntegrationIds` at most 100.
- Workflow files (`post.workflow.v1.0.*.ts`) and `publicApiRetentionWorkflow` are never edited. No frontend change. No billing change. No MCP OAuth flow change.
- Every DB query on tenant data includes `organizationId`. Cross-tenant ids return 404 (never 403, never data); a rule filter or key limit that names another organization's channel or key is a 400.
- API, webhook and MCP changes are additive: do not rename or remove existing response keys, headers, events or MCP tools.
- Audit and policy audit writes are best effort and never throw to the caller (use `recordPostEvent`). Policy EVALUATION failures at publish time fail closed (R4.7); at write time they bubble as a 500, never as ALLOW.
- Test commands: root specs `pnpm exec jest -c jest.config.ts <path> --coverage=false`; MCP specs `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs <path>`. Run from the worktree root. Specs live next to the source as `*.spec.ts`. Specs that import code touching `isomorphic-dompurify` start with `jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));`.
- Conventions: imports use the `@postsider/*` aliases; new optional constructor dependencies use a trailing `@Optional() private _x?: T` so existing positional `new X(...)` specs keep compiling; Prisma access goes through `PrismaRepository<'model'>` like the neighbours; pure modules import nothing from Nest or Prisma except `import type`.

## Review Focus

The failure modes the spec implies that a person is most likely to hit. Each has a test in the owning task.

1. Bypass by editing: an automation that edits a QUEUE post to add a link, or a human who touches an automation-authored post, must not escape REQUIRE_APPROVAL or BLOCK (Tasks 8 and 10: the edit is re-routed to approval, and publish time matches either `createdBy` or `lastModifiedBy`).
2. Timezone and DST: a window or daily cap evaluated across the Warsaw spring-forward day (23 hours) and fall-back day (25 hours), an overnight window, and a time exactly on `start` and `end` (Task 2).
3. Matching accuracy: `class` must not match `classic`, Polish `łódź` must match case-insensitively, `Node.js` and `v2.0` and an email address are not links, `bit.ly/x` and `www.example.com` and `<a href>` targets are (Task 2).
4. The publish-time guard must never publish when rules cannot be loaded, must not terminate its own running workflow when it moves the post to approval, and must treat an APPROVED approval as satisfying REQUIRE_APPROVAL but never BLOCK (Task 10).
5. Key limits on a multi-channel create: one forbidden channel writes nothing, claims no idempotency key, and an action violation is reported before a channel violation; legacy org keys, OAuth tokens and existing keys with empty limits are unaffected (Tasks 4 and 5).
6. Tenant isolation: another organization's channel id or key id in a rule filter, a key limit or the dry run body; and `policies:*` absent from legacy keys, default-scoped new keys and OAuth grants (Tasks 4, 6, 11, 12).

## File Structure

New files:
- `libraries/nestjs-libraries/src/database/prisma/migrations/20261104150000_publish_error_policy_blocked/migration.sql` - one `ALTER TYPE ... ADD VALUE`.
- `libraries/nestjs-libraries/src/database/prisma/migrations/20261104150100_control_plane_policy_engine/migration.sql` - enums, `ApiKey` columns, `PolicyRule`.
- `libraries/nestjs-libraries/src/database/prisma/schema.control-plane-policy.spec.ts` - guards enum and field names against the generated client.
- `libraries/nestjs-libraries/src/policies/policy-types.ts`, `policy-params.ts`, `policy-text.ts`, `policy-window.ts`, `policy-evaluator.ts`, `key-permissions.ts` (+ `.spec.ts` each) - pure.
- `libraries/nestjs-libraries/src/database/prisma/policies/policy-rules.repository.ts`, `policy-rules.service.ts`, `policy-evaluation.service.ts`, `policy-approval-router.ts`, `post-policy-gate.service.ts`, `publish-policy.guard.ts` (+ `.spec.ts` each).
- `libraries/nestjs-libraries/src/dtos/policies/policy-rule.dto.ts`, `evaluate-policy.dto.ts`, `public-policy.dto.ts` - request DTOs and OpenAPI schema DTOs.
- `apps/backend/src/public-api/routes/v1/public.policies.controller.ts` (+ `.http.spec.ts`).

Modified (main ones): `schema.prisma`, `publish-error.classifier.ts`, `audit-events.ts`, `audit.logger.ts` (type only), `actor-context.ts`, `public.auth.middleware.ts`, `organization.repository.ts`, `settings.controller.ts`, `create-api-key.dto.ts`, `posts.repository.ts`, `posts.service.ts`, `public.integrations.controller.ts`, `public.workspace.controller.ts`, `database.module.ts`, `public.api.module.ts`, `public-api-scopes.ts`, `public-api-oauth-scopes.ts`, `mcp-scope-policy.ts`, `post.activity.ts`, `apps/mcp/src/client.ts`, `server.ts` and its frozen lists, the MCP skill `postsider-content-publishing`, `README.md`, `docs/API-MCP-TRUST.md`.

Order note vs the suggested order: the key-permission work is split in two (Task 4 plumbing and settings API, Task 5 enforcement on the five paths) because the plumbing is useful alone and the enforcement shares controller edits with Tasks 8 and 9. Daily counts and the audit event live with the evaluation service (Task 7), not with the evaluator, so the evaluator stays pure. Publish time (Task 10) comes after both write-time tasks because it reuses the approval router built in Task 8.

## Validating the Prisma migrations without production

The throwaway Postgres on port 55432 database `ps_cp` has Phase 1 and 2 migrations applied (30 migrations).
1. `pg_isready -h localhost -p 55432` must say accepting connections. If not, start it: `LC_ALL=en_US.UTF-8 pg_ctl -D /private/tmp/claude-501/-Users-lukasz-APP-and-DEV-Project-PostSider--Project/418d9155-6f4d-4338-b135-fe3ba9262ba1/scratchpad/pgdata -o "-p 55432 -k /tmp/pgsock55432" -l /private/tmp/claude-501/-Users-lukasz-APP-and-DEV-Project-PostSider--Project/418d9155-6f4d-4338-b135-fe3ba9262ba1/scratchpad/pg.log start`.
2. `DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp pnpm exec prisma validate --schema $SCHEMA` must print `is valid`.
3. `pnpm exec prisma migrate deploy --schema $SCHEMA` applies only the new migrations; `prisma migrate diff --from-url ... --to-schema-datamodel ... --exit-code` must exit 0 (no drift).
4. `pnpm exec prisma generate --schema $SCHEMA` regenerates the client so TypeScript sees the new fields.

---

### Task 1: Schema and migrations

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (`enum PublishErrorCategory` ~717, `model ApiKey` ~1075, `model Organization` back-relation near `apiKeys` ~58, enums near `PostActorType`)
- Create: `.../migrations/20261104150000_publish_error_policy_blocked/migration.sql`, `.../migrations/20261104150100_control_plane_policy_engine/migration.sql`
- Test: `libraries/nestjs-libraries/src/database/prisma/schema.control-plane-policy.spec.ts`

**Interfaces:**
- Produces: Prisma enums `PostAction`, `PolicyCondition`, `PolicyEffect`; `PublishErrorCategory.POLICY_BLOCKED`; `ApiKey.allowedActions PostAction[] @default([])`, `ApiKey.allowedIntegrationIds String[] @default([])`; model `PolicyRule { id String @id @default(uuid()); organizationId String; name String @db.VarChar(120); enabled Boolean @default(true); priority Int @default(100); appliesToActorTypes PostActorType[] @default([]); appliesToApiKeyIds String[] @default([]); appliesToIntegrationIds String[] @default([]); appliesToProviders String[] @default([]); condition PolicyCondition; conditionParams Json @default("{}"); effect PolicyEffect; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt; deletedAt DateTime?; organization Organization @relation(...) }` with `@@index([organizationId, deletedAt, enabled])`; `Organization.policyRules PolicyRule[]`.

- [ ] **Step 1: Write the failing test** `schema.control-plane-policy.spec.ts`:

```ts
import { Prisma, PostAction, PolicyCondition, PolicyEffect, PublishErrorCategory } from '@prisma/client';

const model = (n: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === n)!;
const field = (m: string, f: string) => model(m).fields.find((x) => x.name === f)!;

describe('control plane policy schema', () => {
  it('PostAction has exactly three values', () => {
    expect(Object.values(PostAction).sort()).toEqual(['DRAFT', 'PUBLISH_NOW', 'SCHEDULE']);
  });
  it('PolicyCondition and PolicyEffect have the exact values', () => {
    expect(Object.values(PolicyCondition).sort()).toEqual(
      ['ALWAYS', 'CONTAINS_LINK', 'CONTAINS_WORDS', 'DAILY_CAP_EXCEEDED', 'HAS_VIDEO', 'OUTSIDE_WINDOW', 'PUBLISH_NOW']
    );
    expect(Object.values(PolicyEffect).sort()).toEqual(['BLOCK', 'REQUIRE_APPROVAL']);
  });
  it('PublishErrorCategory gains POLICY_BLOCKED and keeps the rest', () => {
    expect(Object.values(PublishErrorCategory)).toEqual(expect.arrayContaining(['POLICY_BLOCKED', 'UNKNOWN_OUTCOME', 'UNKNOWN']));
  });
  it('ApiKey has list columns that default to empty', () => {
    expect(field('ApiKey', 'allowedActions')).toMatchObject({ type: 'PostAction', isList: true, isRequired: true });
    expect(field('ApiKey', 'allowedIntegrationIds')).toMatchObject({ type: 'String', isList: true });
  });
  it('PolicyRule has the filter, condition and soft delete columns', () => {
    for (const f of ['appliesToApiKeyIds', 'appliesToIntegrationIds', 'appliesToProviders']) {
      expect(field('PolicyRule', f)).toMatchObject({ type: 'String', isList: true });
    }
    expect(field('PolicyRule', 'appliesToActorTypes')).toMatchObject({ type: 'PostActorType', isList: true });
    expect(field('PolicyRule', 'conditionParams').type).toBe('Json');
    expect(field('PolicyRule', 'deletedAt').isRequired).toBe(false);
    expect(field('PolicyRule', 'organizationId').isRequired).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/schema.control-plane-policy.spec.ts --coverage=false`. Expected: FAIL (`PostAction` undefined).

- [ ] **Step 3: Edit `schema.prisma`** exactly as the Interfaces block says (add `POLICY_BLOCKED` last in `PublishErrorCategory`).

- [ ] **Step 4: Create the two migration files.** The first contains only `ALTER TYPE "PublishErrorCategory" ADD VALUE 'POLICY_BLOCKED';`. The second creates `CREATE TYPE "PostAction" AS ENUM ('DRAFT','SCHEDULE','PUBLISH_NOW')`, `"PolicyCondition"`, `"PolicyEffect"`, `ALTER TABLE "ApiKey" ADD COLUMN "allowedActions" "PostAction"[] NOT NULL DEFAULT ARRAY[]::"PostAction"[], ADD COLUMN "allowedIntegrationIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]`, `CREATE TABLE "PolicyRule" (...)` with array defaults written the same way, `ALTER TABLE "PolicyRule" ADD CONSTRAINT ... FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE`, and `CREATE INDEX "PolicyRule_organizationId_deletedAt_enabled_idx" ON "PolicyRule"("organizationId","deletedAt","enabled")`. Additive only.

- [ ] **Step 5: Validate, apply on the throwaway database, generate.**
Run:
```
export DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp
SCHEMA=libraries/nestjs-libraries/src/database/prisma/schema.prisma
pnpm exec prisma validate --schema $SCHEMA
pnpm exec prisma migrate deploy --schema $SCHEMA
pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel $SCHEMA --exit-code
pnpm exec prisma generate --schema $SCHEMA
psql -h localhost -p 55432 -U postgres -d ps_cp -c 'select count(*) from "ApiKey" where cardinality("allowedActions") > 0'
psql -h localhost -p 55432 -U postgres -d ps_cp -c "select unnest(enum_range(null::\"PublishErrorCategory\"))"
```
Expected: `is valid`; both migrations apply (the second must not fail on the new enum value because it never uses it); the diff exits 0; generate succeeds; the count is `0` (existing keys unrestricted); the enum list ends with `POLICY_BLOCKED`.

- [ ] **Step 6: Re-run the Step 2 command.** Expected: PASS.

- [ ] **Step 7: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/schema.prisma libraries/nestjs-libraries/src/database/prisma/migrations/20261104150000_publish_error_policy_blocked libraries/nestjs-libraries/src/database/prisma/migrations/20261104150100_control_plane_policy_engine libraries/nestjs-libraries/src/database/prisma/schema.control-plane-policy.spec.ts
GIT commit -m "feat(db): policy rules, key action limits and POLICY_BLOCKED error category"
```

---

### Task 2: Pure conditions: types, params, text, window (TDD)

**Files:**
- Create: `libraries/nestjs-libraries/src/policies/policy-types.ts`, `policy-params.ts`, `policy-text.ts`, `policy-window.ts`
- Test: `policy-params.spec.ts`, `policy-text.spec.ts`, `policy-window.spec.ts` (same folder)
- Modify: `libraries/nestjs-libraries/src/integrations/publish-error.classifier.ts` (add `'POLICY_BLOCKED'` to `PUBLISH_ERROR_CATEGORIES`), `publish-error.classifier.spec.ts` (list assertion), `libraries/nestjs-libraries/src/dtos/posts/public-post-failure.dto.ts` (enum picks it up; update the description to name POLICY_BLOCKED)

**Interfaces:**
- Produces `policy-types.ts` (no imports except `import type { ActorView, PostActorType } from '../actor/post-actor'`):
```ts
export const POLICY_CONDITIONS = ['ALWAYS','CONTAINS_LINK','CONTAINS_WORDS','OUTSIDE_WINDOW','DAILY_CAP_EXCEEDED','PUBLISH_NOW','HAS_VIDEO'] as const;
export type PolicyConditionName = (typeof POLICY_CONDITIONS)[number];
export const POLICY_EFFECTS = ['REQUIRE_APPROVAL','BLOCK'] as const;
export type PolicyEffectName = (typeof POLICY_EFFECTS)[number];
export const POST_ACTIONS = ['DRAFT','SCHEDULE','PUBLISH_NOW'] as const;
export type PostActionName = (typeof POST_ACTIONS)[number];
export type WindowParams = { days: number[]; start: string; end: string; timezone: string };
export type CapParams = { max: number; scope: 'organization' | 'channel'; timezone?: string };
export type WordsParams = { words: string[] };
export type PolicyRuleInput = { id: string; name: string; enabled: boolean; priority: number; createdAt: Date; appliesToActorTypes: PostActorType[]; appliesToApiKeyIds: string[]; appliesToIntegrationIds: string[]; appliesToProviders: string[]; condition: PolicyConditionName; conditionParams: unknown; effect: PolicyEffectName };
export type PolicyContext = { phase: 'write' | 'publish'; action: PostActionName; actors: ActorView[]; integrationId: string; provider: string; text: string; mediaTypes: Array<'image'|'video'|'audio'>; scheduledAt: Date; approved: boolean; dailyCounts: Record<string, { organization: number; channel: number }> };
export type PolicyMatch = { ruleId: string; name: string; effect: PolicyEffectName; condition: PolicyConditionName };
export type PolicyEvaluation = { effect: 'ALLOW' | PolicyEffectName; matched: PolicyMatch[] };
```
- Produces `policy-params.ts`: `type ParamResult = { ok: true; value: unknown } | { ok: false; field: string; message: string }`; `validateConditionParams(condition: PolicyConditionName, params: unknown): ParamResult` (normalizes: trims words, lowercases timezone-free fields untouched, defaults cap timezone to `'UTC'`, rejects unknown keys with `field` = the key); `isValidTimezone(tz: string): boolean`.
- Produces `policy-text.ts`: `htmlToPolicyText(html: string): string`; `containsLink(text: string): boolean`; `containsAnyWord(text: string, words: string[]): boolean`.
- Produces `policy-window.ts`: `wallClock(date: Date, timezone: string): { day: number; minutes: number }` (day 0 = Sunday, minutes since local midnight); `isInsideWindow(date: Date, w: WindowParams): boolean`; `dayBounds(date: Date, timezone: string): { start: Date; end: Date }` (start inclusive, end exclusive, the local day containing `date`).

- [ ] **Step 1: Write the failing tests.**
  - `policy-params.spec.ts`: `validateConditionParams('ALWAYS', {})` ok; `('ALWAYS', {x:1})` -> `{ok:false, field:'x'}`; `('CONTAINS_WORDS', {words:[]})` fails on `words`; 101 words fails; a 101 character word fails; `{words:[' Foo ','foo']}` fails as a case-insensitive duplicate; `{words:[' Foo ']}` returns `value.words` `['Foo']`; `('OUTSIDE_WINDOW', {days:[1,2], start:'09:00', end:'17:00', timezone:'Europe/Warsaw'})` ok; `days:[7]`, `days:[]`, `days:[1,1]`, `start:'9:00'`, `start:'24:00'`, `end:'17:00'` equal to start, `timezone:'Mars/Base'` each fail with the right `field`; `('DAILY_CAP_EXCEEDED', {max:5, scope:'organization'})` ok and the value has `timezone:'UTC'`; `max:0`, `max:10001`, `max:1.5`, `scope:'team'` fail; `isValidTimezone('Europe/Warsaw')` true, `'nope'` false.
  - `policy-text.spec.ts`: `htmlToPolicyText('<p>Hello&nbsp;<b>world</b> &amp; co</p>')` equals `'Hello world & co'`; `'<a href="https://x.com/a">click</a>'` yields text containing `https://x.com/a`; `containsLink` true for `'see https://x.com'`, `'www.example.com/a'`, `'bit.ly/abc'`, `'go to example.co now'`, `'HTTP://UPPER.COM'`; false for `'Node.js is fine'`, `'version v2.0 e.g. this'`, `'mail me at a@b.com'`, `'Hello. World.'`, empty string. `containsAnyWord('Great CLASSIC car', ['class'])` false; `('a class act', ['Class'])` true; `('Mamy ŁÓDŹ dzis', ['łódź'])` true; `('co-op', ['co'])` true (hyphen is a boundary); `('free  money now', ['free money'])` true across a double space; `('x_free', ['free'])` false (underscore is a word character); regex metacharacters in a word (`'c++'`, `'a.b'`) are matched literally and `'a.b'` does not match `'aXb'`.
  - `policy-window.spec.ts` (all with explicit UTC instants): `wallClock(new Date('2026-03-29T00:30:00Z'), 'Europe/Warsaw')` is Sunday 01:30 (`{day:0, minutes:90}`); at `'2026-03-29T01:30:00Z'` Warsaw is already CEST so minutes `210` (03:30, the 02:xx hour does not exist); on `2026-10-25` the instants `00:30Z` and `01:30Z` both read as 02:30 local (`minutes:150`) (the repeated hour); `isInsideWindow` for `{days:[1..5], start:'09:00', end:'17:00', timezone:'Europe/Warsaw'}`: Monday 2026-11-02 `08:00Z` (09:00 local) inside, `15:59Z` (16:59) inside, `16:00Z` (17:00) outside (end exclusive), `07:59Z` (08:59) outside, Saturday 10:00 local outside; overnight `{days:[5], start:'22:00', end:'06:00'}`: Friday 23:00 inside, Saturday 05:59 inside (belongs to Friday), Saturday 06:00 outside, Saturday 23:00 outside; `dayBounds` for Warsaw on `2026-03-29` spans exactly 23 hours, on `2026-10-25` exactly 25 hours, on `2026-11-02` 24 hours, and `start` equals local midnight; `dayBounds(x, 'UTC')` returns UTC midnight to midnight; a date at `23:59:59.999` local stays in its day and the next millisecond is in the next day's bounds.
  - Classifier spec: `PUBLISH_ERROR_CATEGORIES` includes `'POLICY_BLOCKED'` and still ends with `'UNKNOWN'`.

- [ ] **Step 2: Run them.** Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/policies libraries/nestjs-libraries/src/integrations/publish-error.classifier.spec.ts --coverage=false`. Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the four modules.** Decisions the signatures do not determine: words are matched with a RegExp built from `escapeRegExp(word)` per entry, whitespace runs in a multi-word entry replaced by `\\s+`, flags `iu`, boundaries `(?<![\\p{L}\\p{N}_])` and `(?![\\p{L}\\p{N}_])`. `containsLink` uses three patterns on the text: `\\bhttps?://\\S+`, `\\bwww\\.[\\p{L}\\p{N}-]+\\.\\S+` and a bare-domain pattern `(?<![@\\w.-])[\\p{L}\\p{N}-]+(\\.[\\p{L}\\p{N}-]+)*\\.(com|net|org|io|co|pl|de|uk|eu|fr|es|it|nl|se|no|dk|fi|cz|sk|ru|ua|us|ca|au|app|dev|ai|ly|me|gl|to|be|ch|at|info|biz|xyz|online|site|store|tech)\\b(?![\\p{L}\\p{N}-]*@)` with the preceding-`@` lookbehind excluding email domains. `htmlToPolicyText` replaces `<a ... href="X">` with ` X ` before stripping tags, decodes `&nbsp; &amp; &lt; &gt; &quot; &#39;`, collapses whitespace. `wallClock` uses `Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts`. `dayBounds` finds local midnight by taking the local `Y-M-D` of `date`, guessing `Date.UTC(Y,M,D)`, and correcting by the zone offset at the guess twice; `end` is the same procedure for the next local day. Overnight windows (`end < start`) match when `(day listed and minutes >= start)` or `(previous day listed and minutes < end)`. Add `'POLICY_BLOCKED'` to the classifier array.

- [ ] **Step 4: Re-run the Step 2 command.** Expected: PASS.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/policies libraries/nestjs-libraries/src/integrations/publish-error.classifier.ts libraries/nestjs-libraries/src/integrations/publish-error.classifier.spec.ts libraries/nestjs-libraries/src/dtos/posts/public-post-failure.dto.ts
GIT commit -m "feat(policy): condition params, text matching and timezone window math"
```

---

### Task 3: Pure evaluator (TDD)

**Files:**
- Create: `libraries/nestjs-libraries/src/policies/policy-evaluator.ts`
- Test: `libraries/nestjs-libraries/src/policies/policy-evaluator.spec.ts`

**Interfaces:**
- Consumes: Task 2 types and `containsLink`, `containsAnyWord`, `isInsideWindow`, `dayBounds`.
- Produces:
```ts
export function ruleApplies(rule: PolicyRuleInput, ctx: PolicyContext): boolean; // enabled + actor + key + channel + provider filters
export function conditionHolds(rule: PolicyRuleInput, ctx: PolicyContext): boolean; // params assumed validated; a rule whose params fail validation never holds
export function evaluatePolicies(ctx: PolicyContext, rules: PolicyRuleInput[]): PolicyEvaluation;
export const AUTOMATION_ACTOR_TYPES: readonly ['API_KEY', 'OAUTH_CLIENT'];
```

- [ ] **Step 1: Write the failing test** `policy-evaluator.spec.ts` with a `rule(partial)` and `ctx(partial)` factory (default rule: enabled, priority 100, condition ALWAYS, effect REQUIRE_APPROVAL, empty filters; default ctx: phase `write`, action `SCHEDULE`, one `{type:'API_KEY', apiKeyId:'k1'}` actor, integration `i1`, provider `linkedin`, text `''`, `approved:false`). Cases:
  - No rules -> `{ effect: 'ALLOW', matched: [] }`. Disabled rule ignored.
  - Combination: REQUIRE_APPROVAL only -> `REQUIRE_APPROVAL`; BLOCK + REQUIRE_APPROVAL -> `BLOCK` and `matched` has both; two ALWAYS rules with priorities 5 and 1 list priority 1 first; equal priority orders by `createdAt` then `id`.
  - Actor filter: empty `appliesToActorTypes` applies to `API_KEY` and `OAUTH_CLIENT` actors, not to `USER` or `SYSTEM`; `['USER']` applies to a `USER` actor only; with `actors: [USER, API_KEY]` (publish-time pair) an automation-only rule applies; `appliesToApiKeyIds: ['k2']` does not apply to key `k1`, does not apply to a legacy key (`apiKeyId: null`) or an OAuth actor, applies to `k2`.
  - Channel filters: `appliesToIntegrationIds: ['i2']` skips `i1`; `appliesToProviders: ['x']` skips `linkedin`.
  - Conditions: `CONTAINS_LINK` with `'visit https://a.com'` holds and with `'hello'` does not; `CONTAINS_WORDS` `{words:['guarantee']}` holds for `'We GUARANTEE it'`; `OUTSIDE_WINDOW` (Mon-Fri 09:00 to 17:00 Warsaw) holds for a Saturday `scheduledAt` and not for Monday 10:00 local; `PUBLISH_NOW` holds only for `action: 'PUBLISH_NOW'` (and not for `SCHEDULE`, which is the publish-time action); `HAS_VIDEO` holds for `mediaTypes: ['image','video']`; `DAILY_CAP_EXCEEDED` with `{max:3, scope:'organization'}` and `dailyCounts[rule.id] = {organization:2, channel:0}` does not hold, with `organization:3` holds; scope `channel` reads `channel`; a missing `dailyCounts` entry counts as 0.
  - `approved: true` removes REQUIRE_APPROVAL matches from the outcome (effect `ALLOW` when only those matched) but a BLOCK rule still blocks and appears in `matched`.
  - A rule with invalid `conditionParams` (words as a string) never matches and does not throw.
  - Purity: the same inputs give deep-equal outputs and the input arrays are not mutated (freeze them).

- [ ] **Step 2: Run it.** Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/policies/policy-evaluator.spec.ts --coverage=false`. Expected: FAIL.

- [ ] **Step 3: Implement** the three functions. Re-validate params inside `conditionHolds` with `validateConditionParams` (cheap) so stored garbage cannot throw. Sort a copy of the rules; never read the clock.

- [ ] **Step 4: Re-run.** Expected: PASS (all cases).

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/policies/policy-evaluator.ts libraries/nestjs-libraries/src/policies/policy-evaluator.spec.ts
GIT commit -m "feat(policy): pure evaluator with block over approval over allow"
```

---

### Task 4: Key permissions: pure check, ambient context, settings API

**Files:**
- Create: `libraries/nestjs-libraries/src/policies/key-permissions.ts`, `key-permissions.spec.ts`
- Modify: `libraries/nestjs-libraries/src/actor/actor-context.ts` (+ `actor-context.spec.ts`), `apps/backend/src/services/auth/public.auth.middleware.ts` (+ spec), `libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository.ts`, `organization.service.ts`, `libraries/nestjs-libraries/src/dtos/settings/create-api-key.dto.ts`, `apps/backend/src/api/routes/settings.controller.ts`
- Test: new `apps/backend/src/api/routes/settings.api-key-permissions.spec.ts`

**Interfaces:**
- Produces `key-permissions.ts` (pure):
```ts
export type KeyPermissions = { allowedActions: PostActionName[]; allowedIntegrationIds: string[] };
export type KeyCheck =
  | { allowed: true }
  | { allowed: false; code: 'key_action_not_allowed'; action: PostActionName; allowedActions: PostActionName[] }
  | { allowed: false; code: 'key_channel_not_allowed'; integrationId: string; allowedIntegrationIds: string[] };
export function checkKeyPermission(perms: KeyPermissions | null | undefined, action: PostActionName, integrationIds: readonly string[]): KeyCheck; // empty list = unrestricted; action checked before channels; first offending channel reported
```
- Produces `actor-context.ts`: `runWithActor(actor, fn, opts?: { impersonatedBy?: string; keyPermissions?: KeyPermissions })` and `currentKeyPermissions(): KeyPermissions | null` (null outside a context or for credentials without limits).
- Produces `OrganizationRepository.resolvePublicApiCredential` result `keyPermissions?: KeyPermissions` for `api-key` credentials; `listApiKeys`, `createApiKey`, `updateNamedApiKey` select and accept `allowedActions`, `allowedIntegrationIds`; `OrganizationService.createApiKey(orgId, name, scopes, perms?)` and `updateNamedApiKey(orgId, keyId, { name?, scopes?, allowedActions?, allowedIntegrationIds? })`.
- `req.publicApiCredential` gains `permissions?: KeyPermissions` (only when the key has a non-empty limit).

- [ ] **Step 1: Write the failing tests.**
  - `key-permissions.spec.ts`: `checkKeyPermission(null, 'PUBLISH_NOW', ['a'])` allowed; `{allowedActions:[], allowedIntegrationIds:[]}` allowed for everything; `{allowedActions:['DRAFT']}` + `SCHEDULE` -> `key_action_not_allowed` with `action:'SCHEDULE'` and `allowedActions:['DRAFT']`; `{allowedActions:['DRAFT','SCHEDULE']}` allows `SCHEDULE`; `{allowedIntegrationIds:['a']}` with `['a','b']` -> `key_channel_not_allowed` with `integrationId:'b'`; both violated -> the action code wins; empty `integrationIds` list passes the channel check.
  - `actor-context.spec.ts`: inside `runWithActor(actor, fn, { keyPermissions })` `currentKeyPermissions()` returns it, also after an `await`; outside returns `null`.
  - Middleware spec: an `api-key` credential whose row has `allowedActions:['DRAFT']` sets `req.publicApiCredential.permissions` and `currentKeyPermissions()` inside `next()`; a key with both lists empty sets neither; a `legacy` credential and an `oauth` token set neither even if the mocked service returns the fields (spoof guard).
  - Settings spec (instantiate `SettingsController` with mocked services like the neighbouring settings specs): create with `allowedActions:['DRAFT','DRAFT']` -> 400; `allowedActions:['FOO']` fails DTO validation (`validate(plainToInstance(CreateApiKeyDto, ...))` has an error on `allowedActions`); `allowedIntegrationIds:['c1']` where the org has no active channel `c1` -> 400 naming `c1`; 101 ids -> DTO error; a valid create passes both lists to `createApiKey` and the response/listing includes them; update with only `allowedActions: []` is accepted (no longer "Name or scopes are required") and clears; update with nothing -> 400; the `api_key.create` and `api_key.update` audit inputs contain the lists.

- [ ] **Step 2: Run them.** Expected: FAIL. Command: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/policies/key-permissions.spec.ts libraries/nestjs-libraries/src/actor/actor-context.spec.ts apps/backend/src/services/auth/public.auth.middleware.spec.ts apps/backend/src/api/routes/settings.api-key-permissions.spec.ts --coverage=false`.

- [ ] **Step 3: Implement.** `checkKeyPermission` pure. Extend the ALS store type with `keyPermissions`. In `resolvePublicApiCredential` add the two columns to the `api-key` `select` and return `keyPermissions` only when either list is non-empty. The middleware passes `credential.keyPermissions` to `runWithActor` for the `api-key` branch only. DTO: `@IsOptional() @IsArray() @ArrayMaxSize(3) @ArrayUnique() @IsIn(POST_ACTIONS, { each: true }) allowedActions?` and `@IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(100, { each: true }) allowedIntegrationIds?` (both inherited by `UpdateApiKeyDto`). The controller resolves channel ids against `IntegrationService.getIntegrationsList(org.id)` (active, not deleted) and throws `HttpException({ msg: 'Unknown channel id: <id>' }, 400)`; the "nothing to update" check also accepts the new fields.

- [ ] **Step 4: Re-run the Step 2 command.** Expected: PASS.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/policies/key-permissions.ts libraries/nestjs-libraries/src/policies/key-permissions.spec.ts libraries/nestjs-libraries/src/actor libraries/nestjs-libraries/src/database/prisma/organizations libraries/nestjs-libraries/src/dtos/settings apps/backend/src/services/auth apps/backend/src/api/routes/settings.controller.ts apps/backend/src/api/routes/settings.api-key-permissions.spec.ts
GIT commit -m "feat(api-keys): per key allowed actions and channels, plumbed through the auth context"
```

---

### Task 5: Enforce key permissions on the public write paths

**Files:**
- Create: `libraries/nestjs-libraries/src/policies/key-permission.guard.ts` (+ `.spec.ts`)
- Modify: `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` (`createPost`, `updatePost`, `changePostStatus`, `retryFailedByGroup`), `public.workspace.controller.ts` (`duplicatePost`)
- Test: `apps/backend/src/public-api/routes/v1/public.key-permissions.http.spec.ts`

**Interfaces:**
- Consumes: `checkKeyPermission`, `currentKeyPermissions` (Task 4).
- Produces: `assertKeyAllowed(action: PostActionName, integrationIds: readonly string[]): void` in `key-permission.guard.ts`; throws `HttpException({ error: code, msg, ...details }, 403)` (plain `HttpException`, never `HttpForbiddenException`, which the global filter turns into a 401 logout). Message copy has no dashes: `This API key may not <schedule|publish now|create drafts>.` / `This API key may not post to this channel.`
- Also produces `actionForCreateType(type: 'draft'|'schedule'|'now'): PostActionName` and `actionForStoredState(state: string): PostActionName` (`DRAFT` -> `DRAFT`, anything else `SCHEDULE`) exported from the same file.

- [ ] **Step 1: Write the failing tests.** `key-permission.guard.spec.ts`: inside `runWithActor(..., { keyPermissions: { allowedActions:['DRAFT'], allowedIntegrationIds:[] } })`, `assertKeyAllowed('SCHEDULE', ['a'])` throws with status 403 and `getResponse()` containing `error: 'key_action_not_allowed'`, `action: 'SCHEDULE'`; outside any context it does not throw; mapping helpers. HTTP spec (build the controllers with mocked services as `public.retry-failed.http.spec.ts` does, run inside `runWithActor` with permissions): for each of `POST /posts` (types draft, schedule, now), `PUT /posts/:id` (stored DRAFT vs QUEUE), `PUT /posts/:id/status` (draft, schedule), retry-failed, duplicate, assert the allowed combination reaches the service and the forbidden one answers 403 with the right code and the mocked `createPost`/`changePostStatus`/`retryFailedByGroup`/`duplicatePost` and `_idempotency.claim` are NOT called; a multi-channel `POST /posts` where the second channel is forbidden -> 403 `key_channel_not_allowed` naming the second channel and `createPost` not called; action violation beats channel violation; a key with empty limits and no context behaves exactly as before; `DELETE /posts/:id`, `request-approval` and `release-id` are not restricted for a `DRAFT`-only key.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.** Call `assertKeyAllowed` in each handler right after the body/ids are resolved and before `_idempotency.claim` and before `assertPostsValid` is not required (validation first is fine, the rule is "before any write or claim"). `createPost`: action from `rawBody.type`, channels from `body.posts[].integration.id`. `updatePost`: stored state from `buildPostUpdate`'s `state`, channel from `dto.posts[0].integration.id`. `changePostStatus`: needs the stored post (`getPost`) for the channel; action from `body.status`. `retryFailedByGroup`: load `getTopLevelPostsByGroup`; if any row is `ERROR`, `assertKeyAllowed('SCHEDULE', channels of the ERROR rows)`. `duplicatePost`: `assertKeyAllowed('DRAFT', [channelId ?? source integration])`.

- [ ] **Step 4: Re-run the Step 2 command plus the existing controller specs.** Run: `pnpm exec jest -c jest.config.ts apps/backend/src/public-api libraries/nestjs-libraries/src/policies/key-permission.guard.spec.ts --coverage=false`. Expected: PASS, including the unchanged `public.integrations.scopes.spec.ts` (handler count of the workspace controller stays 14).

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/policies/key-permission.guard.ts libraries/nestjs-libraries/src/policies/key-permission.guard.spec.ts apps/backend/src/public-api
GIT commit -m "feat(api): enforce key action and channel limits on create, edit, status, retry and duplicate"
```

---

### Task 6: Policy rules repository and service

**Files:**
- Create: `libraries/nestjs-libraries/src/database/prisma/policies/policy-rules.repository.ts`, `policy-rules.service.ts` (+ `.spec.ts` each), `libraries/nestjs-libraries/src/dtos/policies/policy-rule.dto.ts` (+ `.spec.ts`)
- Modify: `libraries/nestjs-libraries/src/database/prisma/database.module.ts` (providers: `PolicyRulesRepository`, `PolicyRulesService`)

**Interfaces:**
- Consumes: `validateConditionParams`, `PolicyRuleInput` (Task 2); `IntegrationService.getIntegrationsList(orgId)`; `OrganizationRepository.listApiKeys(orgId)`.
- Produces `PolicyRulesRepository`: `listForOrg(orgId): Promise<PolicyRule[]>` (non-deleted, ordered by `priority asc, createdAt asc`), `listEnabled(orgId): Promise<PolicyRule[]>`, `getById(orgId, id): Promise<PolicyRule | null>`, `create(orgId, data): Promise<PolicyRule>`, `update(orgId, id, data): Promise<PolicyRule | null>` (via `updateMany` on `{id, organizationId, deletedAt: null}` then re-read), `softDelete(orgId, id): Promise<boolean>` (sets `deletedAt` and `enabled=false`), `countEnabled(orgId)`, `countNonDeleted(orgId)`.
- Produces `PolicyRulesService`: `list(orgId)`, `get(orgId, id)` (404 `NotFoundException` when missing or foreign), `create(orgId, dto: CreatePolicyRuleDto)`, `update(orgId, id, dto: UpdatePolicyRuleDto)`, `remove(orgId, id)`, `toRuleInputs(rows): PolicyRuleInput[]`, `toPublicRule(row)` (drops `deletedAt`, `organizationId`).
- Produces DTOs: `CreatePolicyRuleDto { name; enabled?; priority?; appliesToActorTypes?; appliesToApiKeyIds?; appliesToIntegrationIds?; appliesToProviders?; condition; conditionParams?; effect }`, `UpdatePolicyRuleDto extends PartialType(CreatePolicyRuleDto)`; class-validator rules for the limits in Global Constraints.

- [ ] **Step 1: Write the failing tests.**
  - DTO spec: name `''` and 121 characters fail; priority `-1`, `1001`, `1.5` fail, omitted -> service default 100; `appliesToActorTypes:['ADMIN']` fails; 101 filter entries fail; duplicate entries fail; `condition:'NOPE'` fails.
  - Service spec (mock repository, integration service, api key lookup): create with `condition: 'CONTAINS_WORDS'` and `conditionParams: {words: []}` -> `BadRequestException` whose response names `conditionParams.words`; `ALWAYS` with omitted params stores `{}`; `appliesToIntegrationIds:['foreign']` -> 400 naming `foreign`; `appliesToApiKeyIds:['foreign']` -> 400; creating an enabled rule when `countEnabled` is 50 -> 400 `{ error: 'policy_limit_reached' }`; creating when `countNonDeleted` is 200 -> same; creating a disabled rule at 50 enabled succeeds; update that changes `condition` to `OUTSIDE_WINDOW` without new params -> 400 (old params do not fit); update that re-enables a rule at the cap -> 400; update/remove/get on a foreign or deleted id -> `NotFoundException`; `remove` calls `softDelete` and returns `{ id, deleted: true }`; `toRuleInputs` maps `conditionParams` untouched and keeps `createdAt`.
  - Repository spec (mock Prisma model): every call includes `organizationId`; `listEnabled` filters `enabled: true, deletedAt: null`; `update` uses `updateMany` with `organizationId` in `where`.

- [ ] **Step 2: Run them.** Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/policies libraries/nestjs-libraries/src/dtos/policies --coverage=false`. Expected: FAIL.

- [ ] **Step 3: Implement** with the same repository style as `ApprovalRepository`. Validation errors use `new BadRequestException({ msg, field })`; the cap error is `new BadRequestException({ error: 'policy_limit_reached', msg: 'An organization can have at most 50 enabled and 200 stored policy rules.' })`. Provider filter entries are lowercased and trimmed.

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/policies libraries/nestjs-libraries/src/dtos/policies libraries/nestjs-libraries/src/database/prisma/database.module.ts
GIT commit -m "feat(policy): rules repository and service with limits and tenant checks"
```

---

### Task 7: Policy evaluation service, daily counts and audit event

**Files:**
- Create: `libraries/nestjs-libraries/src/database/prisma/policies/policy-evaluation.service.ts` (+ `.spec.ts`)
- Modify: `libraries/nestjs-libraries/src/database/prisma/audit/audit-events.ts` (+ `.spec.ts`: ten names, `post.policy_evaluated` last; `ResourceAuditEntry.targetType: 'post' | 'organization'`), `posts.repository.ts` (+ spec), `database.module.ts`

**Interfaces:**
- Produces `PostsRepository.countAutomationPostsInRange(orgId: string, range: { start: Date; end: Date }, opts: { integrationId?: string; excludePostId?: string }): Promise<number>`: top-level rows (`parentPostId: null`), `deletedAt: null`, `state in (QUEUE, PUBLISHED)`, `publishDate >= start && < end`, `createdByType in (API_KEY, OAUTH_CLIENT)`.
- Produces `PolicyEvaluationService` with:
```ts
export type PolicyTarget = { integrationId: string; provider: string; action: PostActionName; actors: ActorView[]; text: string; mediaTypes: Array<'image'|'video'|'audio'>; scheduledAt: Date; approved: boolean; excludePostId?: string };
export type PolicyOutcome = { effect: PolicyEvaluation['effect']; matched: PolicyMatch[]; channels: Array<{ integrationId: string; effect: PolicyEvaluation['effect']; matched: PolicyMatch[] }> };
evaluateTargets(orgId: string, targets: PolicyTarget[], phase: 'write' | 'publish'): Promise<PolicyOutcome>;
targetsFromDraftBody(orgId: string, body: { type: 'draft'|'schedule'|'now'; date?: string; posts: Array<{ integration: { id: string }; value: Array<{ content: string; image?: Array<{ path: string }> }>; firstComment?: string | null }> }, actor: PostActor): Promise<PolicyTarget[]>; // 404 NotFoundException for a channel of another org
targetFromStoredPost(orgId: string, postId: string, opts: { action: PostActionName; approved: boolean }): Promise<PolicyTarget | null>; // actors = createdBy + lastModifiedBy views, deduplicated; scheduledAt = stored publishDate
recordOutcome(orgId: string, outcome: PolicyOutcome, phase: 'write' | 'publish', target: { postId?: string }): Promise<void>; // no-op for ALLOW; best effort
```
- `PolicyOutcome.matched` is the de-duplicated union over channels in (priority, createdAt, id) order; `effect` is the maximum.

- [ ] **Step 1: Write the failing tests** (`policy-evaluation.service.spec.ts`, mocking the rules repository, posts repository, integration service and `AuditLogger`):
  - With rules `[BLOCK CONTAINS_WORDS ['x']]` and two targets, one containing `x`: `outcome.effect === 'BLOCK'`, `channels` has one `BLOCK` and one `ALLOW`, `matched` has the rule once.
  - Daily cap: a `DAILY_CAP_EXCEEDED {max:2, scope:'organization'}` rule with the repository returning 2 -> matches; returning 1 -> does not; scope `channel` calls the repository with the target `integrationId`; the day range passed to the repository equals `dayBounds(target.scheduledAt, rule timezone)`; `excludePostId` is forwarded; two targets of one request on the same channel in an organization cap of 2 with a repository count of 1 -> the second target sees count 2 (earlier targets of the request are added) and matches; no cap rule loaded -> the repository is never called (no query cost without rules); no rules at all -> `ALLOW` and `rulesRepository.listEnabled` called once.
  - `targetsFromDraftBody`: html content `'<p>See <a href="https://a.com">a</a></p>'` becomes text containing `https://a.com`; the first comment is included; thread values are joined; media types come from path extensions (`.mp4` -> video, `.png` -> image, none -> []); action from `type` (`now` -> `PUBLISH_NOW` with `scheduledAt` close to the provided clock, `schedule` -> `SCHEDULE` with `date`, `draft` -> `DRAFT`); provider comes from the integration's `providerIdentifier`; an unknown channel -> `NotFoundException`.
  - `targetFromStoredPost`: builds actors from the stored `createdBy*`/`lastModifiedBy*` columns (two different actors -> two views, identical -> one); returns `null` for a missing post.
  - `recordOutcome`: ALLOW writes nothing; BLOCK writes `post.policy_evaluated` with `metadata` `{ effect:'BLOCK', phase:'write', matchedCount:1, ruleIds:'r1', ruleNames:'Rule one' }` and `targetType 'post'`; without a post id it writes `targetType 'organization'` with `targetId` = the org id; more than 5 matched rules: `ruleIds` holds 5 ids and `matchedCount` the true count; an audit failure never throws.
  - Audit spec: `AUDIT_EVENT_TYPES` ends with `'post.policy_evaluated'`.

- [ ] **Step 2: Run them.** Expected: FAIL. Command: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/policies/policy-evaluation.service.spec.ts libraries/nestjs-libraries/src/database/prisma/audit libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.spec.ts --coverage=false`.

- [ ] **Step 3: Implement.** `evaluateTargets` loads `listEnabled` once, converts with `toRuleInputs`, and for each target builds `dailyCounts` only for the cap rules that apply (`ruleApplies` first, to avoid pointless queries), then calls `evaluatePolicies`. Reuse the media-type derivation as a small pure exported function (`deriveMediaTypeFromPath`) in `policy-text.ts` rather than reaching into the private `PostsService.deriveMediaType`.

- [ ] **Step 4: Re-run.** Expected: PASS.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/policies libraries/nestjs-libraries/src/database/prisma/audit libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.spec.ts libraries/nestjs-libraries/src/database/prisma/database.module.ts libraries/nestjs-libraries/src/policies/policy-text.ts
GIT commit -m "feat(policy): evaluation service, daily counts and post.policy_evaluated audit event"
```

---

### Task 8: Write-time gate for create, edit and status

**Files:**
- Create: `libraries/nestjs-libraries/src/database/prisma/policies/policy-approval-router.ts`, `post-policy-gate.service.ts` (+ `.spec.ts` each), `libraries/nestjs-libraries/src/policies/policy-errors.ts` (+ spec)
- Modify: `posts.service.ts` (`createPost` option), `public.integrations.controller.ts` (`createPost`, `updatePost`, `changePostStatus`), `database.module.ts`
- Test: `apps/backend/src/public-api/routes/v1/public.policy-write.http.spec.ts`

**Interfaces:**
- Produces `policy-errors.ts`: `class PolicyBlockedException extends HttpException` (status 422, body `{ error: 'policy_blocked', msg, policy: { effect: 'BLOCK', matched, channels } }`; message `This post was blocked by a policy: <names>.`, names sanitized, no dashes).
- Produces `PolicyApprovalRouter.route(orgId: string, postId: string, opts: { terminateWorkflow: boolean }): Promise<{ requested: boolean; approvalId: string | null }>`: if the post is `QUEUE` or `ERROR` it first moves it to DRAFT (`PostsService.changePostStatus(orgId, id, 'draft')` when `terminateWorkflow`, else `PostsService.setPostState(orgId, id, 'DRAFT')`), then calls `ApprovalService.requestApprovalFromApi`; `requested` is the `created` flag; idempotent; errors propagate (fail closed, the post is left a DRAFT).
- Produces `PostPolicyGateService`:
```ts
preflightWrite(orgId: string, body: CreateBodyLike, actor: PostActor): Promise<{ outcome: PolicyOutcome; approvalIntegrationIds: Set<string> }>; // action DRAFT: report only; SCHEDULE/PUBLISH_NOW: BLOCK throws PolicyBlockedException (after recordOutcome), REQUIRE_APPROVAL channels go in approvalIntegrationIds
finishCreate<T extends { postId: string; integration: string }>(orgId: string, created: T[], pre: { outcome: PolicyOutcome; approvalIntegrationIds: Set<string> }): Promise<Array<T & { policy: { effect: string; matched: PolicyMatch[] }; approvalRequested: boolean }>>; // routes approvals, records REQUIRE_APPROVAL outcome per post
gateStatus(orgId: string, postId: string, status: 'draft' | 'schedule'): Promise<{ proceed: boolean; policy: PolicyOutcome; approvalRequested: boolean }>; // draft: reported only; schedule: BLOCK throws, REQUIRE_APPROVAL routes (terminateWorkflow true) and returns proceed false
```
- `PostsService.createPost(orgId, body, creationMethod, options: { provenance?; forceDraftIntegrationIds?: ReadonlySet<string> })`: for a post whose `integration.id` is in the set, `createOrUpdatePost` receives `'draft'` instead of `body.type`, and monthly post slots are reserved only for non-forced posts.

- [ ] **Step 1: Write the failing tests.**
  - `post-policy-gate.service.spec.ts` (mock evaluation service, router, audit): `type: 'draft'` with a matching BLOCK rule -> no throw, `outcome.effect === 'BLOCK'` returned for reporting, `approvalIntegrationIds` empty, `recordOutcome` called; `type: 'schedule'` BLOCK -> throws `PolicyBlockedException` (status 422, `error: 'policy_blocked'`, matched names present) and `recordOutcome` called once with no post id; `schedule` REQUIRE_APPROVAL on channel `b` of two channels -> `approvalIntegrationIds` is `{'b'}`; `finishCreate` calls the router only for posts of `b` with `terminateWorkflow: false`, returns `approvalRequested: true` for `b` and `false` for `a`, and `policy.effect` per channel; a router failure rejects (no swallow); `gateStatus('p', 'draft')` never routes; `gateStatus('p','schedule')` REQUIRE_APPROVAL -> routes with `terminateWorkflow: true` and returns `proceed: false`; ALLOW -> `proceed: true`; a post already `APPROVAL` is not re-evaluated into a loop (the router is idempotent, assert one call and `requested:false` is passed through).
  - `policy-approval-router.spec.ts`: QUEUE post -> `changePostStatus('draft')` then `requestApprovalFromApi`, in that order; DRAFT post -> only the request; `terminateWorkflow:false` uses `setPostState` and never `changePostStatus`; ERROR post -> moved to DRAFT first; request failure propagates.
  - HTTP spec (controllers with mocks + the real gate): `POST /posts` `type: schedule` with BLOCK -> 422 body shape, `createPost` and `_idempotency.claim` not called, then the same request with an idempotency key whose first attempt succeeded replays the stored response including `policy`; REQUIRE_APPROVAL -> `createPost` called with `forceDraftIntegrationIds` and the response array elements carry `policy` and `approvalRequested: true`; ALLOW -> elements carry `policy: { effect: 'ALLOW', matched: [] }`, `approvalRequested: false`; `PUT /posts/:id` on a QUEUE post whose edited content now hits a REQUIRE_APPROVAL rule -> after `createPost` the router is called with `terminateWorkflow: true` (bypass-by-edit); on a DRAFT post -> report only; `PUT /posts/:id/status` `schedule` with BLOCK -> 422 and `changePostStatus` not called; REQUIRE_APPROVAL -> returns `{ id, state: 'APPROVAL', policy, approvalRequested: true }` and `changePostStatus('schedule')` not called; the approval-scheduling path `ApprovalService.scheduleApprovedPost` still calls `PostsService.changePostStatus` directly with no gate (assert the gate is not injected into `ApprovalService`).
  - `posts.service` spec: `createPost` with `forceDraftIntegrationIds` passes `'draft'` to `createOrUpdatePost` for that channel only and does not arm a workflow for it.

- [ ] **Step 2: Run them.** Expected: FAIL. Command: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/policies libraries/nestjs-libraries/src/policies/policy-errors.spec.ts apps/backend/src/public-api/routes/v1/public.policy-write.http.spec.ts libraries/nestjs-libraries/src/database/prisma/posts --coverage=false`.

- [ ] **Step 3: Implement.** In the controller `createPost`, order: parse provenance -> `mapTypeToPost` -> media domain check -> `assertKeyAllowed` (Task 5) -> `assertPostsValid` -> idempotency `claim` and replay return -> inside the `try`: `preflightWrite` (its throw releases the claim) -> `createPost(..., { provenance, forceDraftIntegrationIds })` -> `finishCreate` -> `complete(claim, decorated)`. The gate is a trailing `@Optional()` dependency of the controller so existing positional specs compile. `updatePost` and `changePostStatus` call `preflightWrite`/`gateStatus` as described; for `updatePost` the action is `DRAFT` when the stored state is DRAFT, else `SCHEDULE`, and the target comes from `targetFromStoredPost` after applying the patch text (build the draft body from `dto`). Register the new providers in `DatabaseModule`.

- [ ] **Step 4: Re-run the Step 2 command plus `pnpm exec jest -c jest.config.ts apps/backend/src/public-api --coverage=false`.** Expected: PASS.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src/public-api
GIT commit -m "feat(policy): write-time gate for create, edit and status with approval routing"
```

---

### Task 9: Write-time gate for retry-failed and duplicate

**Files:**
- Modify: `post-policy-gate.service.ts` (+ spec), `posts.service.ts` (`RetryFailedResult` type, `retryFailedByGroup`), `public.integrations.controller.ts` (`retryFailedByGroup`), `public.workspace.controller.ts` (`duplicatePost`), `apps/backend/src/public-api/routes/v1/public.reliability.openapi.spec.ts`, `public.retry-failed.http.spec.ts`
- Test: extend `public.policy-write.http.spec.ts`

**Interfaces:**
- Produces `PostPolicyGateService.gateRetry(orgId: string, group: string, opts: { includeUnknownOutcome: boolean }): Promise<{ policy: PolicyOutcome; approvalPostIds: Set<string> }>`: evaluates the ERROR rows of the group (`SCHEDULE`); any BLOCK throws `PolicyBlockedException` before any row is touched; REQUIRE_APPROVAL rows are collected.
- `RetryFailedResult.action` becomes `'requeued' | 'skipped' | 'approval_requested'`.
- `PostsService.retryFailedByGroup(orgId, group, opts: { includeUnknownOutcome: boolean; routeToApproval?: (postId: string) => Promise<boolean> })`: for a row in `approvalPostIds`, after the existing skip checks (not ERROR, UNKNOWN_OUTCOME without confirmation, already published) the row is handed to `routeToApproval` instead of `claimErrorForRetry`/`startWorkflow`, and reported as `approval_requested`.
- Duplicate: `gateDuplicate` is not needed; the controller calls `preflightWrite` with a `draft` body built from the target so the outcome is reported (`policy` added to the response object) and nothing is enforced.

- [ ] **Step 1: Write the failing tests.** `gateRetry`: a group with two ERROR rows where one matches BLOCK -> throws 422 and neither row is touched; one matches REQUIRE_APPROVAL -> its id is in `approvalPostIds`, the other not; rows not in ERROR are not evaluated; a POLICY_BLOCKED row retried while the rule still blocks -> 422 (Review Focus: retry cannot bypass); after the rule is disabled -> proceeds. Service: `retryFailedByGroup` with `routeToApproval` returns `approval_requested` for the routed row, `requeued` for the other, never calls `startWorkflow` for the routed row, and a routed row whose approval request fails is reported `skipped` with reason `rearm_failed`. HTTP: the retry response has top-level `policy`; the idempotency replay returns it; the OpenAPI reliability spec lists `approval_requested` in the result action enum; duplicate response has `policy` and the created post is still a DRAFT even with a matching BLOCK rule.

- [ ] **Step 2: Run them.** Expected: FAIL. Command: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/policies/post-policy-gate.service.spec.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.retry-failed.spec.ts apps/backend/src/public-api --coverage=false`.

- [ ] **Step 3: Implement.** In the retry controller the order is: `assertKeyAllowed` -> idempotency claim and replay -> inside `try`: `gateRetry` -> `retryFailedByGroup(..., { includeUnknownOutcome, routeToApproval })` -> merge `policy` into the result -> `complete`. `routeToApproval` calls `PolicyApprovalRouter.route(orgId, postId, { terminateWorkflow: false })` (an ERROR row has no live workflow) and returns `requested || approvalAlreadyOpen`. Update the controller `@ApiOperation` description to name `approval_requested` and the 422.

- [ ] **Step 4: Re-run the Step 2 command.** Expected: PASS.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src/public-api
GIT commit -m "feat(policy): evaluate retry-failed and duplicate, route retries to approval"
```

---

### Task 10: Publish-time guard in the `publishPostById` activity

**Files:**
- Create: `libraries/nestjs-libraries/src/database/prisma/policies/publish-policy.guard.ts` (+ `.spec.ts`)
- Modify: `apps/orchestrator/src/activities/post.activity.ts` (`PublishAttemptResult`, `publishPostById`, constructor) and `post.activity.spec.ts`, `database.module.ts`
- Test: `apps/orchestrator/src/activities/post.activity.policy.spec.ts`

**Interfaces:**
- Consumes: `PolicyEvaluationService.targetFromStoredPost/evaluateTargets/recordOutcome`, `PolicyApprovalRouter`, `ApprovalService.getForPost`.
- Produces:
```ts
export type PublishPolicyDecision =
  | { kind: 'allow' }
  | { kind: 'blocked'; failure: PublishFailure }          // category POLICY_BLOCKED, retryable false, autoRetry 'none'
  | { kind: 'approval_requested' }
  | { kind: 'error'; failure: PublishFailure };            // category UNKNOWN, retryable true, autoRetry 'none'
PublishPolicyGuard.checkBeforePublish(orgId: string, postId: string): Promise<PublishPolicyDecision>;
```
- `PublishAttemptResult` gains the optional field on the existing `already_published` member: `{ outcome: 'already_published'; releaseId: string; withheld?: 'policy_approval' }`.
- `PostActivity` constructor gains trailing `@Optional() private _publishPolicy?: PublishPolicyGuard`.

- [ ] **Step 1: Write the failing tests.**
  - `publish-policy.guard.spec.ts`: no rules -> `allow` (and no approval lookup); BLOCK rule matched -> `blocked` with `failure.category === 'POLICY_BLOCKED'`, `retryable === false`, message listing rule names with no dashes and at most 500 characters, `recordOutcome` called with phase `publish` and the post id; REQUIRE_APPROVAL and no approval -> router called with `terminateWorkflow: false`, decision `approval_requested`; REQUIRE_APPROVAL with an `APPROVED` approval -> evaluated with `approved: true` -> `allow`; REQUIRE_APPROVAL with a `PENDING` or `REJECTED` approval -> routed (router idempotent) not allowed; BLOCK plus an APPROVED approval -> still `blocked`; stored post with `createdBy` API_KEY and `lastModifiedBy` USER and an automation-only BLOCK rule -> `blocked` (Review Focus 1); `PUBLISH_NOW` rule never matches at publish time; loading rules throws -> decision `error` with category `UNKNOWN`, `retryable: true` (fail closed); router failure -> `error`; a missing stored post -> `allow` is wrong: it returns `error` (nothing to verify).
  - Activity spec: with the guard returning `blocked`, `publishPostById` returns `{ outcome: 'failed', failure }`, `recordPublishAttempt` and `postSocial` are NOT called; `approval_requested` -> returns `{ outcome: 'already_published', releaseId: '', withheld: 'policy_approval' }` and no provider call; `error` -> `{ outcome: 'failed', failure }`, no provider call; `allow` -> existing behavior unchanged (existing tests still pass); without a guard injected -> unchanged; the guard runs AFTER the already-published short circuit (a row with a release id never evaluates policies) and BEFORE `recordPublishAttempt`; `markPublishFailed` with a POLICY_BLOCKED failure sets ERROR with `errorCategory: 'POLICY_BLOCKED'` and `errorRetryable: false` and the `post.failed` webhook payload carries `errorCategory: 'POLICY_BLOCKED'`.
  - Workflow compatibility: add a case to `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.9.spec.ts` ONLY IF it can be done without editing the workflow file (the spec file is allowed): `publishPostById` mocked to return the `withheld` value -> the workflow returns without calling `markPublishFailed`, `updatePost` or `sendWebhooks`.

- [ ] **Step 2: Run them.** Expected: FAIL. Command: `pnpm exec jest -c jest.config.ts apps/orchestrator/src/activities libraries/nestjs-libraries/src/database/prisma/policies/publish-policy.guard.spec.ts apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.9.spec.ts --coverage=false`.

- [ ] **Step 3: Implement.** `checkBeforePublish` loads the stored post with `targetFromStoredPost(orgId, postId, { action: 'SCHEDULE', approved })` where `approved` comes from `ApprovalService.getForPost` (`status === 'APPROVED'`); the whole body is wrapped so any exception becomes the `error` decision. In `publishPostById` call the guard inside the first `try`, after the `already_published` block and before `recordPublishAttempt`. Do NOT use `changePostStatus` anywhere on this path (it terminates the running workflow); the router with `terminateWorkflow: false` uses `setPostState`. Messages: `Blocked by policy: <rule names>.` and `Publishing paused: waiting for approval under policy <rule names>.`.

- [ ] **Step 4: Re-run the Step 2 command.** Expected: PASS. Then run `pnpm exec jest -c jest.config.ts apps/orchestrator --coverage=false` to confirm no other activity spec broke.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/policies apps/orchestrator/src libraries/nestjs-libraries/src/database/prisma/database.module.ts
GIT commit -m "feat(policy): evaluate again before the provider call, block or hold for approval"
```

---

### Task 11: Scopes and the policy management API

**Files:**
- Create: `apps/backend/src/public-api/routes/v1/public.policies.controller.ts` (+ `.http.spec.ts`), `libraries/nestjs-libraries/src/dtos/policies/public-policy.dto.ts`
- Modify: `libraries/nestjs-libraries/src/services/public-api-scopes.ts`, `public-api-oauth-scopes.ts` (+ specs `public-api-scopes.spec.ts`/`public-api-oauth-scopes.spec.ts`), `apps/backend/src/public-api/public.api.module.ts`, `public.integrations.scopes.spec.ts`, `public-api.openapi.spec.ts`, `apps/frontend/src/app/settings/api/page.tsx` is NOT touched (D6)

**Interfaces:**
- Consumes: `PolicyRulesService` (Task 6), `AuditLogger.logSecurityEvent`.
- Produces: `PUBLIC_API_SCOPES` gains `'policies:read'`, `'policies:write'` (appended after `'audit:read'`); `LEGACY_PUBLIC_API_SCOPES` filter becomes `!scope.startsWith('webhooks:') && !scope.startsWith('policies:') && scope !== 'audit:read'`.
- Produces routes on `PublicPoliciesController` (`@Controller('/public/v1')`, `@UseGuards(PublicApiScopeGuard)`): `GET /policies` (`policies:read`) -> `{ policies: PublicPolicyRule[] }`; `GET /policies/:id` (`policies:read`); `POST /policies` (`policies:write`, 201); `PUT /policies/:id` (`policies:write`); `DELETE /policies/:id` (`policies:write`) -> `{ id, deleted: true }`. `PublicPolicyRule` = the stored row without `organizationId` and `deletedAt`.

- [ ] **Step 1: Write the failing tests.**
  - Scope specs: `PUBLIC_API_SCOPES` includes both; `LEGACY_PUBLIC_API_SCOPES` includes neither; `grantedScopesForOAuth(['posts:read','posts:write','channels:write'])` includes neither; `grantedScopesForOAuth(undefined)` (legacy OAuth) includes neither; a `POST /settings/api-keys` without `scopes` stores no `policies:*` (controller spec from Task 4 extended); `CreateApiKeyDto` accepts `policies:write` when sent explicitly.
  - `public.integrations.scopes.spec.ts`: register `PublicPoliciesController` in the "known scopes on every route" loop and assert the exact scopes per handler (`list`/`get` -> `['policies:read']`, `create`/`update`/`remove` -> `['policies:write']`); the workspace controller still has exactly 14 handlers.
  - `public.policies.http.spec.ts` (mock `PolicyRulesService`): each route passes `org.id` (never a body or query organization); a foreign id -> 404 from the service; create writes a `policy.create` security entry whose input holds `{ policyId, name }` and not `conditionParams`; update and delete likewise; the response never contains `organizationId` or `deletedAt`; `GET /policies` ordered by priority.
  - OpenAPI spec: the document lists the five operations with their scopes and the `policy_limit_reached` 400.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.** Audit actor id for `logSecurityEvent` is the `USER`/`OAUTH_CLIENT` user id from `currentActor()` when present, else `null` (an API key has no user). Register the controller in `authenticatedController` of `public.api.module.ts` so it gets the auth middleware and request id.

- [ ] **Step 4: Run** `pnpm exec jest -c jest.config.ts apps/backend/src/public-api libraries/nestjs-libraries/src/services --coverage=false`. Expected: PASS.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src/public-api
GIT commit -m "feat(api): policies:read and policies:write scopes and the policy management routes"
```

---

### Task 12: Dry run route and MCP scope classification

**Files:**
- Create: `libraries/nestjs-libraries/src/dtos/policies/evaluate-policy.dto.ts` (+ `.spec.ts`)
- Modify: `public.policies.controller.ts` (+ spec), `libraries/nestjs-libraries/src/database/prisma/oauth/mcp-scope-policy.ts` (+ `mcp-scope-policy.spec.ts`), `apps/mcp/src/http/scope-guard.ts` only if its `isChannelAdminRequest` mirror needs the exception (read it first; the spec says keep the two in step), `apps/backend/src/services/auth/public.auth.middleware.scope.spec.ts`

**Interfaces:**
- Produces `EvaluatePolicyDto { type: 'draft'|'schedule'|'now'; date?: string (ISO 8601); posts: EvaluatePolicyPostDto[] (1 to 20) }`, `EvaluatePolicyPostDto { integration: { id: string }; value: Array<{ content: string; image?: Array<{ path: string }> }> (1 to 50); firstComment?: string | null }`; unknown keys (settings, shortLink, tags) are tolerated and ignored (`whitelist` without `forbidNonWhitelisted`, or an explicit `@Allow`).
- Produces `POST /public/v1/policies/evaluate` (`@RequirePublicApiScopes('posts:read')`, HTTP 200) -> `{ effect, matched, channels: [{ integrationId, effect }], key: { allowed: boolean; code?: 'key_action_not_allowed' | 'key_channel_not_allowed' } }`; writes nothing (no audit, no approval, no idempotency).
- `requiredScopeFor('POST', '/public/v1/policies/evaluate')` returns `'posts:read'`; every other POST stays `posts:write`.

- [ ] **Step 1: Write the failing tests.**
  - `mcp-scope-policy.spec.ts`: `POST /public/v1/policies/evaluate` (also with a query string, trailing slash, mixed case, double slashes and `%2F`-style encoding as the existing normalization tests do) -> `posts:read`; `POST /public/v1/policies` and `PUT /public/v1/policies/x` -> `posts:write`; `POST /public/v1/policies/evaluate/extra` -> `posts:write`; `tokenAllows(['posts:read'], 'POST', '/public/v1/policies/evaluate')` allowed; with `['posts:write']` only it is NOT allowed (strict mapping); a read-only token on `POST /posts` is still refused.
  - Middleware scope spec: an MCP OAuth token with only `posts:read` reaches the evaluate route, and reaches no `policies:read` route (403 from the scope guard, `requiredScopes: ['policies:read']`).
  - Controller spec: a body with a BLOCK-matching word returns `effect: 'BLOCK'` and the rule name in `matched` but the mocked `PostPolicyGateService`, approval router, `createPost` and audit logger are never called; the actor used is `currentActor()` (an API-key context with a rule listing that key id matches, another key id does not); with key limits `{allowedActions:['DRAFT']}` and `type: 'schedule'` the response has `key: { allowed: false, code: 'key_action_not_allowed' }` and still evaluates rules; a channel of another organization -> 404; `posts: []` and 21 posts -> 400; `type: 'nope'` -> 400.

- [ ] **Step 2: Run them.** Expected: FAIL.

- [ ] **Step 3: Implement.** The handler calls `targetsFromDraftBody(org.id, body, currentActor())` then `evaluateTargets(org.id, targets, 'write')` and `checkKeyPermission(currentKeyPermissions(), action, integrationIds)`; do not call `recordOutcome`. Add the single exception to `requiredScopeFor` with a regex on the normalized path `^/policies/evaluate/?$` for the `POST` verb only.

- [ ] **Step 4: Run** `pnpm exec jest -c jest.config.ts apps/backend/src libraries/nestjs-libraries/src/database/prisma/oauth libraries/nestjs-libraries/src/dtos/policies --coverage=false` and `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs apps/mcp/src/__tests__/scope-guard.spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src apps/backend/src apps/mcp/src/http
GIT commit -m "feat(api): policy dry run readable with posts:read and classified as a read for MCP tokens"
```

---

### Task 13: MCP tool, client error mapping and frozen lists

**Files:**
- Modify: `apps/mcp/src/server.ts`, `apps/mcp/src/client.ts` (+ `client.spec.ts`), `apps/mcp/src/__tests__/tool-inventory.ts`, `server.spec.ts`, `http-transport.spec.ts` (`toHaveLength(40)`), `apps/mcp/README.md` (tool count and read table), `apps/mcp/server.json` (`toolCount: 40`), `apps/mcp/scripts/tarball-smoke.mjs` (`EXPECTED_TOOL_COUNT = 40`), `apps/mcp/chatgpt-app-submission.json`, `apps/mcp/CHANGELOG.md`, `apps/mcp/skills/postsider-content-publishing/SKILL.md` (+ the skills catalog spec if it snapshots the file)

**Interfaces:**
- Produces tool `postsider_check_policy`: title `Check policy`, input schema `type` (`draft|schedule|now`), `date` (string, optional for `draft`), `posts` (array of `{ channelId, content, firstComment?, images? }`, the same entry type as `postsider_create_post`), annotations all four explicit: `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true`; maps through the existing `buildCreatePostBody` to `POST /policies/evaluate`. Description (no dashes): states it writes nothing, returns `effect` ALLOW, REQUIRE_APPROVAL or BLOCK with the matched rule names and whether the key may perform the action, and tells the agent to call it before scheduling or publishing.
- Produces client mappings: 403 whose body has `error: 'key_action_not_allowed'` -> `This API key may not <action>. Allowed actions: <list>. Ask the owner to change the key limits in Settings, API.`; `key_channel_not_allowed` -> names the channel and allowed channels; 422 with `error: 'policy_blocked'` -> `Blocked by policy: <rule names>. Do not retry with the same content; change the content or ask the owner.`; other 403 and 422 behavior unchanged.

- [ ] **Step 1: Write the failing tests.** Inventory: `EXPECTED_TOOL_NAMES` gains `'postsider_check_policy'`, `EXPECTED_TOOL_COUNT = 40`, `EXPECTED_TOOL_ANNOTATIONS.postsider_check_policy` equals the four-hint read shape; `server.spec.ts` asserts the stdio server has 41 tools (look at how Phase 2 asserted 40) and the hosted one 40; `http-transport.spec.ts` 40; a tool test calls `postsider_check_policy` against the fake client and asserts the request is `POST /policies/evaluate` with the mapped body and that no write endpoint is hit; `client.spec.ts` covers the three new error mappings with a fake `fetch`, including a 403 with unrelated body (unchanged text) and a 422 without a code (unchanged text); a manifest spec asserts `server.json` `toolCount` 40 and the tarball smoke constant; the skill spec (if any) asserts the skill mentions `policy_blocked` and `postsider_check_policy`.

- [ ] **Step 2: Run them.** Run: `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs apps/mcp/src --coverage=false`. Expected: FAIL.

- [ ] **Step 3: Implement.** Register the tool next to `postsider_check_post`. Add the policy sentence to the descriptions of `postsider_create_post`, `postsider_update_post`, `postsider_update_post_status` and `postsider_retry_failed_posts`: responses include `policy`; `approvalRequested: true` means the post is waiting for a human and is NOT scheduled; `policy_blocked` means change the content. Skill text: add a short "Policy outcomes" section (the three outcomes, what the agent does for each: ALLOW proceed, REQUIRE_APPROVAL tell the user the post awaits approval and poll `postsider_get_approval_status`, BLOCK never retry unchanged and never try another channel to dodge the rule) and a line that a key with limits may be refused with `key_action_not_allowed`. No dashes.

- [ ] **Step 4: Re-run the Step 2 command.** Expected: PASS. Then run the packaging gates the Phase 2 plan used: `pnpm --filter @postsider/mcp run version:gate` and `pnpm --filter @postsider/mcp run validate:registry` (script names as in `apps/mcp/package.json`; if a name differs use the one that exists). Expected: both succeed.

- [ ] **Step 5: Commit**
```
GIT add apps/mcp
GIT commit -m "feat(mcp): postsider_check_policy, readable key and policy errors, frozen lists at 40 and 41 tools"
```

---

### Task 14: Docs, OpenAPI exposure and final verification

**Files:**
- Modify: `README.md`, `docs/API-MCP-TRUST.md`, `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` (OpenAPI descriptions of create/update/status/retry: the `policy` field, 403 and 422 bodies), `libraries/nestjs-libraries/src/dtos/posts/public-post-failure.dto.ts` (done in Task 2, verify), `libraries/nestjs-libraries/src/services/public-webhook-events.ts` (the `post.failed` sample comment lists `POLICY_BLOCKED`; sample payload unchanged), `apps/backend/src/public-api/routes/v1/public.policy.openapi.spec.ts` (new)

- [ ] **Step 1: Write the failing test** `public.policy.openapi.spec.ts` (pattern of `public.reliability.openapi.spec.ts`): the generated document describes `POST /public/v1/policies/evaluate`, the five `/policies` operations, the two scopes in the operation security text, the error codes `key_action_not_allowed`, `key_channel_not_allowed`, `policy_blocked` in the descriptions of `POST /posts`, `PUT /posts/{id}`, `PUT /posts/{id}/status`, retry-failed; the `PublicPolicyRule` and evaluate response schemas exist; and a recursive scan of every new description string finds no U+2013 or U+2014.

- [ ] **Step 2: Run it.** Expected: FAIL. Command: `pnpm exec jest -c jest.config.ts apps/backend/src/public-api/routes/v1/public.policy.openapi.spec.ts --coverage=false`.

- [ ] **Step 3: Write the docs and descriptions.**
  - `README.md`: a "Policies and key limits" section: what a key limit is (actions, channels, empty = unrestricted, legacy org keys and OAuth are not limited), the seven conditions with their params in a table, effects, who a rule applies to by default (automation only), write time versus publish time, approved posts and BLOCK, the `policy` response field, `post.policy_evaluated`, `POLICY_BLOCKED`, the dry run route, the scopes, and the honest limits: drafts are reported not enforced, best-effort daily caps, text-only matching, dashboard edits are only caught at publish time, workflows started before this release skip the publish-time check, a human edit of an approved queued post is not re-approved.
  - `docs/API-MCP-TRUST.md`: rows for the policy routes in the endpoint table (scope column), the new error rows (`403 key_action_not_allowed|key_channel_not_allowed`, `422 policy_blocked`) in "Errors that an agent can explain", and a "Policies" section that replaces the sentence saying there is no technical draft-only permission with the new key-limit truth ("a key limited to DRAFT cannot schedule or publish").
  - Controller `@ApiOperation` descriptions as listed above.
  - No em or en dashes anywhere.

- [ ] **Step 4: Final verification.** Run each and expect the stated result:
  - `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries apps/backend apps/orchestrator --coverage=false` -> all suites pass.
  - `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --coverage=false` -> all pass.
  - Typecheck the touched projects with the repo's commands (`pnpm exec tsc --noEmit -p apps/backend/tsconfig.json`, `-p apps/orchestrator/tsconfig.json`, `-p apps/mcp/tsconfig.json`; use the existing tsconfig names) -> 0 errors.
  - Migrations: re-run the "Validating the Prisma migrations" steps 2 to 4 on `ps_cp` -> `is valid`, nothing pending, diff exit 0.
  - Workflow files untouched: `GIT diff --stat 4a105d7..HEAD -- 'apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.*.ts' ':!*.spec.ts'` -> empty output.
  - Dashes: `GIT diff 4a105d7..HEAD -U0 | grep -nP '^\+.*[\x{2013}\x{2014}]'` -> no output.
  - Frozen contract: `grep -rn "toHaveLength(40)\|toolCount\": 40\|EXPECTED_TOOL_COUNT = 40" apps/mcp` -> three hits, and `PublicWorkspaceController` still has 14 handlers (the scope spec passes).
  - Leak check: `GIT diff 4a105d7..HEAD --stat -- apps/frontend` -> empty (D6).

- [ ] **Step 5: Commit**
```
GIT add README.md docs/API-MCP-TRUST.md apps/backend/src/public-api libraries/nestjs-libraries/src
GIT commit -m "docs(policy): README, trust doc and OpenAPI for key limits and policy rules"
```

---

## Self-review

- **Spec coverage:** R1 -> Tasks 1, 4, 5. R2 -> Tasks 1, 2, 6. R3 -> Tasks 2, 3, 7. R4.0 to R4.4 -> Tasks 7, 8, 9. R4.5 to R4.8 -> Task 10. R5 -> Tasks 1 (scope list in 11), 11. R6 -> Task 12. R7 -> Tasks 13, 14. Compatibility section -> Task 1 migration steps and Task 14 verification.
- **Placeholders:** none; where a script or tsconfig name must be confirmed (Tasks 13, 14) the step says to use the one that exists in `package.json`.
- **Type consistency:** `PostActionName`, `PolicyOutcome`, `PolicyTarget`, `PolicyRuleInput`, `KeyPermissions`, `PublishPolicyDecision`, `PolicyApprovalRouter.route(..., { terminateWorkflow })` are defined once (Tasks 2, 4, 7, 8, 10) and used with the same names later. `forceDraftIntegrationIds` is defined in Task 8 and reused in no other task. The `approval_requested` retry action is defined in Task 9 only.
- **Proportion:** the plan is longer than the spec by about 2.5 times, most of it test lists; function bodies appear only for the matching and window algorithms the signatures do not determine.
