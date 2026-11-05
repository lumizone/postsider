# Control Plane Phase 1: Reliable Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make publishing at-most-once with a persisted, API-visible error taxonomy, add a safe "retry failed destinations" operation, and replace in-process public webhook delivery with a durable outbox (log, replay, test, retention).

**Architecture:** A new Temporal workflow `postWorkflowV109` (v1.0.8 stays untouched for replay) calls new provider activities that run with `maximumAttempts: 1` and return classified failures as values; a pure classifier maps errors to the `PublishErrorCategory` taxonomy which is persisted on `Post`. Webhook events are written to a `PublicWebhookDelivery` table and delivered by a one-minute Temporal cron using a `FOR UPDATE SKIP LOCKED` claim with a lease and exponential backoff.

**Tech Stack:** NestJS, Prisma 6.5.0 (PostgreSQL), Temporal (`@temporalio/workflow`, `nestjs-temporal-core`), Jest 29 + ts-jest, MCP SDK (ESM) for `apps/mcp`.

**Spec:** `docs/superpowers/specs/2026-11-04-control-plane-phase1-reliable-publishing.md` (read it first; it holds the verified facts, corrections to the brief, the category table and the PR #36 overlap list).

## Global Constraints

Every task implicitly includes these.

- Git binary: `/Library/Developer/CommandLineTools/usr/bin/git` (`/usr/bin/git` exits 69 on this host). In commands below `GIT` means that path. Work only in the worktree `postsider-wt-control-plane` on branch `feat/control-plane-p1-reliability`. Never push, never force.
- Commit trailer, on every commit message: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Prisma: schema changes ship ONLY as a migration file under `libraries/nestjs-libraries/src/database/prisma/migrations/`. Never `db push`. Schema path: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (`SCHEMA` below).
- No em dashes or en dashes (U+2014, U+2013) in any user-facing copy, API messages, docs, README, error messages, MCP descriptions, or comments you add. Use `-` or rewrite.
- `postWorkflowV108` and older workflow files are NEVER edited (Temporal replay). Activity methods used by v1.0.8 keep their names and signatures; only add new ones.
- Every DB query on tenant data includes `organizationId`. Cross-tenant ids return 404, never 403 and never data.
- API/webhook changes are additive only: do not rename or remove existing response keys, headers, events.
- Scopes already exist: `posts:read`, `posts:write`, `webhooks:read`, `webhooks:write` (`@RequirePublicApiScopes`). Do not add scopes.
- Enum string values (exact): `PublishErrorCategory` = `AUTH_EXPIRED, PERMISSION_MISSING, RATE_LIMITED, INVALID_CONTENT, PROVIDER_UNAVAILABLE, UNKNOWN_OUTCOME, UNKNOWN`; `PublicWebhookDeliveryStatus` = `PENDING, SUCCEEDED, FAILED`.
- No frontend changes, no billing changes, no provider publish-logic changes beyond error classification, no MCP OAuth changes (D8).
- Test commands: root specs `pnpm exec jest -c jest.config.ts <path> --coverage=false`; MCP specs `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs <path>`. Run from the worktree root. Specs live next to the source as `*.spec.ts`. Specs that import code touching `isomorphic-dompurify` start with `jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));`.
- Conventions: imports use the `@postsider/*` aliases; Nest classes use `private _name` constructor fields in older code and `private readonly name` in the webhook code (match the file you edit); keep functions small.

## Review Focus

The failure modes the spec implies that a person is most likely to hit. Each has a test in the owning task.

1. The provider call times out or the connection resets after the request was sent: the post must end `ERROR` / `UNKNOWN_OUTCOME` with exactly ONE provider call and no retry (Task 6, Task 2).
2. A repeat-post run (`postNow`) for a post that already has a `releaseId` must still publish, while a normal run with a `releaseId` must not (Task 5, Task 6).
3. `retry-failed` on a group that mixes `PUBLISHED`, `ERROR`, `UNKNOWN_OUTCOME` and `QUEUE` rows, with the same `Idempotency-Key` sent twice, and with another organization's group id (Task 8).
4. The webhook receiver is down for hours: delivery rows survive, back off 1m, 5m, 30m, 2h, 6h, 12h, then `FAILED`; two workers never claim the same row; a crashed worker's lease expires (Task 10, Task 11).
5. Replay, test and delivery listing for another organization's subscription return 404 and leak nothing (Task 12).
6. Re-arming an `ERROR` post shows no stale error, category or retryable flag (Task 4).
7. Retention never deletes `PENDING` deliveries (Task 13).

## File Structure

New files:
- `libraries/nestjs-libraries/src/database/prisma/migrations/20261104090000_control_plane_reliability/migration.sql` - one additive migration.
- `libraries/nestjs-libraries/src/database/prisma/schema.control-plane.spec.ts` - guards enum/field names against the generated client.
- `libraries/nestjs-libraries/src/integrations/publish-error.classifier.ts` (+ `.spec.ts`) - pure classifier, `PublishFailure`, `PrePublishError`, constants.
- `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.9.ts` (+ `.spec.ts`) - new publish workflow.
- `libraries/nestjs-libraries/src/dtos/posts/retry-failed.dto.ts`, `public-post-failure.dto.ts` - request body DTO and OpenAPI schema DTO.
- `apps/orchestrator/src/activities/webhook.delivery.activity.ts` (+ `.spec.ts`) - cron activities (delivery worker, retention).
- `apps/orchestrator/src/workflows/webhook.delivery.workflow.ts`, `public.api.retention.workflow.ts` (+ specs).
- `libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-delivery.claim.integration.spec.ts` - optional real-Postgres concurrency spec.

Modified (main ones): `schema.prisma`, `posts.repository.ts`, `posts.service.ts`, `social.abstract.ts`, `post.activity.ts`, `workflows/index.ts`, `app.module.ts` (orchestrator), `infinite.workflow.register.ts`, `public.integrations.controller.ts`, `public-webhook-delivery.service.ts`, `public-webhook-subscriptions.controller.ts`, `public-webhook-subscriptions.service.ts`, `public-webhook-events.ts`, `apps/mcp/src/server.ts` and its frozen lists, `README.md`, `load.swagger.ts`, `docs/API-MCP-TRUST.md`.

Order note vs the brief: the brief suggested workflow before re-arm. Here the repository layer (Task 4: `changeState` meta, attempt counter, clearing) comes BEFORE activities and workflow (Tasks 5, 6) because they call it. A new Task 3 tags `BadBody` with a `kind` so the classifier can see 429/5xx/network (without it every provider failure is `INVALID_CONTENT`). The brief's retry-failed, MCP, outbox, worker, routes, retention, docs follow as Tasks 8 to 14.

## Validating the Prisma migration without production

Docker is NOT running on this host; Homebrew `postgres`/`psql` 17 exist; Prisma 6.5.0 is local.
1. `DATABASE_URL=postgresql://u:p@localhost:5432/x pnpm exec prisma validate --schema $SCHEMA` must print `is valid` (verified to work offline).
2. Offline SQL diff (no DB): `GIT show origin/main:$SCHEMA > $SCRATCH/old.prisma` then `pnpm exec prisma migrate diff --from-schema-datamodel $SCRATCH/old.prisma --to-schema-datamodel $SCHEMA --script`. Compare statements with the migration file by eye (ordering may differ).
3. Real apply (recommended, ~2 minutes): see Task 1 Step 6 (throwaway cluster on port 55432). `$SCRATCH` is the session scratchpad directory.
4. `pnpm exec prisma generate --schema $SCHEMA` regenerates the client into `node_modules` (not source). Needed before TypeScript sees the new fields.

---

### Task 1: Schema and migration

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (`model Post` at ~402, `model PublicWebhookSubscription` at ~652, enums near `enum State` ~925)
- Create: `libraries/nestjs-libraries/src/database/prisma/migrations/20261104090000_control_plane_reliability/migration.sql`
- Test: `libraries/nestjs-libraries/src/database/prisma/schema.control-plane.spec.ts`

**Interfaces:**
- Produces: Prisma enum `PublishErrorCategory`, enum `PublicWebhookDeliveryStatus`, `Post.errorCategory PublishErrorCategory?`, `Post.errorRetryable Boolean?`, `Post.publishAttempts Int @default(0)`, `Post.lastPublishAttemptAt DateTime?`, model `PublicWebhookDelivery` (client accessor `prisma.publicWebhookDelivery`), relation `PublicWebhookSubscription.deliveries`.

- [ ] **Step 1: Write the failing test** `schema.control-plane.spec.ts`

```ts
import { Prisma, PublishErrorCategory, PublicWebhookDeliveryStatus } from '@prisma/client';

const model = (name: string) =>
  Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;

describe('control plane schema', () => {
  it('PublishErrorCategory has exactly the taxonomy', () => {
    expect(Object.values(PublishErrorCategory).sort()).toEqual(
      ['AUTH_EXPIRED','INVALID_CONTENT','PERMISSION_MISSING','PROVIDER_UNAVAILABLE','RATE_LIMITED','UNKNOWN','UNKNOWN_OUTCOME'].sort()
    );
  });
  it('PublicWebhookDeliveryStatus has PENDING, SUCCEEDED, FAILED', () => {
    expect(Object.values(PublicWebhookDeliveryStatus).sort()).toEqual(['FAILED','PENDING','SUCCEEDED']);
  });
  it('Post has the new failure fields with the right shape', () => {
    const f = (n: string) => model('Post').fields.find((x) => x.name === n)!;
    expect(f('errorCategory')).toMatchObject({ type: 'PublishErrorCategory', isRequired: false });
    expect(f('errorRetryable')).toMatchObject({ type: 'Boolean', isRequired: false });
    expect(f('publishAttempts')).toMatchObject({ type: 'Int', isRequired: true, hasDefaultValue: true });
    expect(f('lastPublishAttemptAt')).toMatchObject({ type: 'DateTime', isRequired: false });
  });
  it('PublicWebhookDelivery has the outbox columns', () => {
    const names = model('PublicWebhookDelivery').fields.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining([
      'id','organizationId','subscriptionId','eventId','event','payload','status',
      'attempts','nextAttemptAt','lastStatusCode','lastError','createdAt','deliveredAt',
    ]));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**
Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/schema.control-plane.spec.ts --coverage=false`
Expected: FAIL (`PublishErrorCategory` undefined / model not found).

- [ ] **Step 3: Edit `schema.prisma`.** Add to `model Post` after `error String?`: `errorCategory PublishErrorCategory?`, `errorRetryable Boolean?`, `publishAttempts Int @default(0)`, `lastPublishAttemptAt DateTime?`. Add to `model PublicWebhookSubscription`: `deliveries PublicWebhookDelivery[]`. Add after the subscription model:

```prisma
model PublicWebhookDelivery {
  id             String                      @id @default(uuid())
  organizationId String
  subscriptionId String
  eventId        String
  event          String
  payload        Json
  status         PublicWebhookDeliveryStatus @default(PENDING)
  attempts       Int                         @default(0)
  nextAttemptAt  DateTime?
  lastStatusCode Int?
  lastError      String?
  createdAt      DateTime                    @default(now())
  deliveredAt    DateTime?
  subscription   PublicWebhookSubscription   @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)

  @@index([status, nextAttemptAt])
  @@index([subscriptionId, createdAt])
  @@index([createdAt])
}

enum PublicWebhookDeliveryStatus {
  PENDING
  SUCCEEDED
  FAILED
}

enum PublishErrorCategory {
  AUTH_EXPIRED
  PERMISSION_MISSING
  RATE_LIMITED
  INVALID_CONTENT
  PROVIDER_UNAVAILABLE
  UNKNOWN_OUTCOME
  UNKNOWN
}
```

- [ ] **Step 4: Create `migration.sql`** (additive; the extra `createdAt` index serves retention):

```sql
CREATE TYPE "PublishErrorCategory" AS ENUM ('AUTH_EXPIRED','PERMISSION_MISSING','RATE_LIMITED','INVALID_CONTENT','PROVIDER_UNAVAILABLE','UNKNOWN_OUTCOME','UNKNOWN');
CREATE TYPE "PublicWebhookDeliveryStatus" AS ENUM ('PENDING','SUCCEEDED','FAILED');

ALTER TABLE "Post"
  ADD COLUMN "errorCategory" "PublishErrorCategory",
  ADD COLUMN "errorRetryable" BOOLEAN,
  ADD COLUMN "publishAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastPublishAttemptAt" TIMESTAMP(3);

CREATE TABLE "PublicWebhookDelivery" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "PublicWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "lastStatusCode" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  CONSTRAINT "PublicWebhookDelivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PublicWebhookDelivery_status_nextAttemptAt_idx" ON "PublicWebhookDelivery"("status","nextAttemptAt");
CREATE INDEX "PublicWebhookDelivery_subscriptionId_createdAt_idx" ON "PublicWebhookDelivery"("subscriptionId","createdAt");
CREATE INDEX "PublicWebhookDelivery_createdAt_idx" ON "PublicWebhookDelivery"("createdAt");
ALTER TABLE "PublicWebhookDelivery" ADD CONSTRAINT "PublicWebhookDelivery_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "PublicWebhookSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 5: Validate and generate**
Run:
```
DATABASE_URL=postgresql://u:p@localhost:5432/x pnpm exec prisma validate --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
GIT show origin/main:libraries/nestjs-libraries/src/database/prisma/schema.prisma > "$SCRATCH/old.prisma"
pnpm exec prisma migrate diff --from-schema-datamodel "$SCRATCH/old.prisma" --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma --script
pnpm exec prisma generate --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
```
Expected: `is valid`; the diff script contains the same statements as `migration.sql`; generate succeeds.

- [ ] **Step 6: Apply the full migration chain on a throwaway Postgres (recommended)**
```
PGDATA="$SCRATCH/pgdata"; initdb -D "$PGDATA" -A trust -U postgres >/dev/null
pg_ctl -D "$PGDATA" -o "-p 55432 -k $SCRATCH" -l "$SCRATCH/pg.log" start
createdb -h localhost -p 55432 -U postgres ps_cp
export DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp
pnpm exec prisma migrate deploy --schema libraries/nestjs-libraries/src/database/prisma/schema.prisma
pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel libraries/nestjs-libraries/src/database/prisma/schema.prisma --exit-code
```
Expected: all migrations apply; the final diff exits 0 (no drift). Keep the cluster running for Tasks 11 to 13 integration tests, stop with `pg_ctl -D "$PGDATA" stop` at the end.

- [ ] **Step 7: Run the Step 1 test again.** Expected: PASS (4 tests).

- [ ] **Step 8: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/schema.prisma libraries/nestjs-libraries/src/database/prisma/migrations/20261104090000_control_plane_reliability libraries/nestjs-libraries/src/database/prisma/schema.control-plane.spec.ts
GIT commit -m "feat(db): publish error taxonomy columns and webhook delivery outbox table"
```

---

### Task 2: Pure error classifier (TDD)

**Files:**
- Create: `libraries/nestjs-libraries/src/integrations/publish-error.classifier.ts`
- Test: `libraries/nestjs-libraries/src/integrations/publish-error.classifier.spec.ts`

**Interfaces:**
- Consumes: Task 1 enum (test only).
- Produces (exact exports, used by Tasks 3, 5, 6, 8):
```ts
export const PUBLISH_ERROR_CATEGORIES: readonly [...7 names...];
export type PublishErrorCategoryName = (typeof PUBLISH_ERROR_CATEGORIES)[number];
export type AutoRetryPolicy = 'refresh' | 'delay' | 'none';
export type BadBodyKind = 'rate_limited' | 'provider_unavailable' | 'pre_connection' | 'unknown_outcome';
export interface PublishFailure { category: PublishErrorCategoryName; retryable: boolean; autoRetry: AutoRetryPolicy; message: string }
export const PRE_CONNECTION_CODES: readonly ['ECONNREFUSED','ENOTFOUND','EAI_AGAIN'];
export const AUTO_RETRY_DELAYS: readonly ['2 minutes','10 minutes'];
export const MAX_AUTH_REFRESHES = 2;
export const UNKNOWN_OUTCOME_MESSAGE: string;
export class PrePublishError extends Error {}           // thrown when nothing was sent to the provider
export function sanitizeFailureMessage(value: unknown, fallback: string): string;
export function isPreConnectionError(err: unknown): boolean;
export function classifyPublishError(err: unknown): PublishFailure;
```
The module must import nothing (no `@temporalio`, no `@prisma/client`, no node built-ins) so it is safe inside the Temporal workflow sandbox.

- [ ] **Step 1: Write the failing test.** Cases (use real `BadBody`, `RefreshToken`, `NotEnoughScopes` from `./social.abstract` for the first three, and object literals for Temporal shapes). Expected results are exact:

```ts
import { BadBody, RefreshToken, NotEnoughScopes } from './social.abstract';
import { classifyPublishError, sanitizeFailureMessage, isPreConnectionError,
  PUBLISH_ERROR_CATEGORIES, UNKNOWN_OUTCOME_MESSAGE, PrePublishError } from './publish-error.classifier';
import { PublishErrorCategory } from '@prisma/client';

const wrapped = (cause: unknown) => ({ name: 'ActivityFailure', message: 'Activity task failed', cause });
const net = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } });

it('refresh_token -> AUTH_EXPIRED, retryable false, autoRetry refresh', () => {
  expect(classifyPublishError(new RefreshToken('x','{}','', 'expired'))).toEqual({
    category: 'AUTH_EXPIRED', retryable: false, autoRetry: 'refresh', message: 'expired' });
});
it('same through an ActivityFailure wrapper', () => {
  expect(classifyPublishError(wrapped(new RefreshToken('x','{}','', 'expired'))).category).toBe('AUTH_EXPIRED');
});
it('not_enough_scopes -> PERMISSION_MISSING false none', () => {
  expect(classifyPublishError(new NotEnoughScopes())).toMatchObject({ category: 'PERMISSION_MISSING', retryable: false, autoRetry: 'none' });
});
it('bad_body without kind -> INVALID_CONTENT false none, keeps provider message', () => {
  expect(classifyPublishError(new BadBody('x','{}','', 'Text too long'))).toEqual({
    category: 'INVALID_CONTENT', retryable: false, autoRetry: 'none', message: 'Text too long' });
});
it.each([
  ['rate_limited', 'RATE_LIMITED', true, 'delay'],
  ['provider_unavailable', 'PROVIDER_UNAVAILABLE', false, 'none'],
  ['pre_connection', 'PROVIDER_UNAVAILABLE', true, 'delay'],
  ['unknown_outcome', 'UNKNOWN_OUTCOME', false, 'none'],
])('bad_body kind %s', (kind, category, retryable, autoRetry) => {
  const err = Object.assign(new BadBody('x','{}','', 'm'), { details: [{ identifier: 'x', json: '{}', body: '', kind }] });
  expect(classifyPublishError(err)).toMatchObject({ category, retryable, autoRetry });
});
it.each(['ECONNREFUSED','ENOTFOUND','EAI_AGAIN'])('%s before connect -> PROVIDER_UNAVAILABLE retryable delay', (code) => {
  expect(classifyPublishError(net(code))).toMatchObject({ category: 'PROVIDER_UNAVAILABLE', retryable: true, autoRetry: 'delay' });
  expect(isPreConnectionError(net(code))).toBe(true);
});
it('Temporal timeout is UNKNOWN_OUTCOME with the exact message', () => {
  expect(classifyPublishError(wrapped({ name: 'TimeoutFailure', timeoutType: 'START_TO_CLOSE' }))).toEqual({
    category: 'UNKNOWN_OUTCOME', retryable: false, autoRetry: 'none', message: UNKNOWN_OUTCOME_MESSAGE });
});
it.each([
  Object.assign(new Error('x'), { name: 'AbortError' }), Object.assign(new Error('x'), { name: 'TimeoutError' }),
  net('ECONNRESET'), net('ETIMEDOUT'), net('UND_ERR_SOCKET'), new Error('boom'), 'a string', undefined, null,
])('ambiguous %# is UNKNOWN_OUTCOME', (e) => {
  expect(classifyPublishError(e)).toMatchObject({ category: 'UNKNOWN_OUTCOME', retryable: false, autoRetry: 'none' });
  expect(isPreConnectionError(e)).toBe(false);
});
it('PrePublishError is UNKNOWN, not retryable, nothing sent', () => {
  expect(classifyPublishError(new PrePublishError('No active subscription'))).toEqual({
    category: 'UNKNOWN', retryable: false, autoRetry: 'none', message: 'No active subscription' });
});
it('messages are capped at 500 chars and contain no em/en dash', () => {
  const m = sanitizeFailureMessage('a\u2014b\u2013c' + 'x'.repeat(600), 'fallback');
  expect(m.length).toBe(500); expect(m).not.toMatch(/[\u2013\u2014]/); expect(m.startsWith('a-b-c')).toBe(true);
  expect(sanitizeFailureMessage('', 'fallback')).toBe('fallback');
  expect(UNKNOWN_OUTCOME_MESSAGE).not.toMatch(/[\u2013\u2014]/);
});
it('category list equals the Prisma enum', () => {
  expect([...PUBLISH_ERROR_CATEGORIES].sort()).toEqual(Object.values(PublishErrorCategory).sort());
});
```

- [ ] **Step 2: Run to verify it fails.**
Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/integrations/publish-error.classifier.spec.ts --coverage=false`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Exact constants: `UNKNOWN_OUTCOME_MESSAGE = 'The platform did not confirm whether this post was published. Check the channel before retrying to avoid a duplicate.'`, `AUTO_RETRY_DELAYS = ['2 minutes','10 minutes']`, `MAX_AUTH_REFRESHES = 2`. Algorithm for `classifyPublishError(err)`:
  1. Build the cause chain: `err`, `err.cause`, ... up to 8 nodes, only while the node is a non-null object.
  2. First pass over the chain, first node with `typeof node.type === 'string'` that is one of the three ApplicationFailure types wins: `refresh_token` -> AUTH_EXPIRED/false/`refresh` (message = sanitize(node.message, 'The channel authorization expired. Reconnect the channel.')); `not_enough_scopes` -> PERMISSION_MISSING/false/none (message default 'The channel is missing required permissions. Reconnect it and grant all scopes.'); `bad_body` -> read `node.details?.[0]?.kind`: `rate_limited` -> RATE_LIMITED/true/delay (default message 'The platform rate limit was reached.'), `provider_unavailable` -> PROVIDER_UNAVAILABLE/false/none ('The platform reported an error.'), `pre_connection` -> PROVIDER_UNAVAILABLE/true/delay ('Could not reach the platform.'), `unknown_outcome` -> the UNKNOWN_OUTCOME result, no kind -> INVALID_CONTENT/false/none (default 'The platform rejected the post.').
  3. A node with `name === 'PrePublishError'` -> UNKNOWN/false/none with `sanitize(node.message)`.
  4. Second pass: any node whose `code` is in `PRE_CONNECTION_CODES` -> PROVIDER_UNAVAILABLE/true/delay.
  5. Everything else (TimeoutFailure, AbortError, resets, unknown) -> UNKNOWN_OUTCOME/false/none with `UNKNOWN_OUTCOME_MESSAGE`.
  `PrePublishError` is `class PrePublishError extends Error { constructor(m: string){ super(m); this.name = 'PrePublishError'; } }`. `isPreConnectionError` is step 4 as a boolean (also true when a chain node is an ApplicationFailure of type `bad_body` with kind `pre_connection`).

- [ ] **Step 4: Run to verify it passes.** Same command. Expected: PASS (all). The Prisma-enum test needs Task 1's `prisma generate`.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/integrations/publish-error.classifier.ts libraries/nestjs-libraries/src/integrations/publish-error.classifier.spec.ts
GIT commit -m "feat(publishing): pure publish error classifier with persisted taxonomy"
```

---

### Task 3: Tag provider failures with a `kind` (social.abstract)

**Files:**
- Modify: `libraries/nestjs-libraries/src/integrations/social.abstract.ts` (`BadBody` ~lines 28-37, `runInConcurrent` ~190-218, `fetch` ~220-290)
- Test: `libraries/nestjs-libraries/src/integrations/social.abstract.spec.ts` (extend; keep existing tests)

**Interfaces:**
- Consumes: `BadBodyKind`, `isPreConnectionError` from Task 2.
- Produces: `new BadBody(identifier, json, body, message = '', kind?: BadBodyKind)`; the kind is stored as `details[0].kind` (the Temporal `type` stays `'bad_body'`, so v1.0.8 behavior is unchanged). `SocialAbstract.fetch(url, options, identifier, totalRetries, ignoreConcurrency, lastRetry?: 'rate_limit' | 'server_error')` (new optional 6th parameter, recursion only).

- [ ] **Step 1: Write failing tests** (append to `social.abstract.spec.ts`; add `jest.mock('@postsider/helpers/utils/timer', () => ({ timer: jest.fn().mockResolvedValue(undefined) }));` at top; subclass `class T extends SocialAbstract { identifier = 't'; }`):
  - `fetch` with `global.fetch` returning `{status: 429, text: async () => '{}'}` four times rejects with `BadBody` whose `details[0].kind === 'rate_limited'` and `fetch` was called 4 times.
  - `fetch` returning `{status: 500, text: async () => '{}'}` four times rejects with kind `provider_unavailable`.
  - `fetch` returning `{status: 502, text: async () => '{}'}` once rejects with kind `provider_unavailable` (called once).
  - `fetch` returning `{status: 400, text: async () => '{"error":"bad"}'}` rejects with `BadBody` whose `details[0].kind` is `undefined`.
  - `runInConcurrent(() => { throw net('ECONNREFUSED') })` rejects with `BadBody` kind `pre_connection`.
  - `runInConcurrent(() => { throw new Error('boom') })` rejects with `BadBody` kind `unknown_outcome`.
  - `runInConcurrent(() => { throw new BadBody('x','{}','', 'm', 'rate_limited') })` rejects with `BadBody` kind `rate_limited` (inner kind preserved).
  - `runInConcurrent` of a function that throws an object where `handleErrors` returns `{type:'bad-body', value:'nope'}` (subclass overrides `handleErrors`) rejects with kind `undefined` (a definite platform rejection).

- [ ] **Step 2: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/integrations/social.abstract.spec.ts --coverage=false`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement.**
  - `BadBody`: add the 5th constructor parameter; `details` becomes `[{ identifier, json, body, ...(kind ? { kind } : {}) }]`.
  - `fetch`: the `totalRetries > 2` branch throws `new BadBody(identifier,'{}',options.body || '{}','', lastRetry === 'rate_limit' ? 'rate_limited' : lastRetry === 'server_error' ? 'provider_unavailable' : undefined)`. In the rate limit branch pass `'rate_limit'` when `request.status === 429 || json.includes('rate_limit_exceeded') || json.includes('Rate limit')`, pass `'server_error'` when the condition is only `request.status === 500 && !handleError`; the `handleError?.type === 'retry'` branch passes `undefined`. Before the final `throw new BadBody(...)` add: if `request.status >= 500` throw it with kind `'provider_unavailable'`.
  - `runInConcurrent`: compute `innerKind = (globalErr as any)?.details?.[0]?.kind`; `kind = innerKind ?? (isPreConnectionError(globalErr) ? 'pre_connection' : (!handle && typeof (globalErr as any)?.type !== 'string' ? 'unknown_outcome' : undefined))` and pass it as the 5th argument of the existing `BadBody` construction. The `RefreshToken` branch is unchanged.

- [ ] **Step 4: Run to verify pass**; also run `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/integrations --coverage=false` to confirm no provider spec regressed. Expected: PASS.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/integrations/social.abstract.ts libraries/nestjs-libraries/src/integrations/social.abstract.spec.ts
GIT commit -m "feat(publishing): tag BadBody failures with rate limit, 5xx and network kinds"
```

---

### Task 4: Persistence layer: error meta, attempts, re-arm clearing

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts` (`changeState` ~608, `updatePost` ~581, `changeDate` ~665, `createOrUpdatePost` ~710 `updateData`), `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` (`changeState` ~1585, `startWorkflow` failure path ~1020)
- Test: `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.reliability.spec.ts` (new)

**Interfaces:**
- Consumes: `PublishErrorCategoryName` from Task 2.
- Produces:
```ts
export interface PostErrorMeta { category: PublishErrorCategoryName; retryable: boolean }
// PostsRepository
changeState(id: string, state: State, err?: any, body?: any, orgId?: string, meta?: PostErrorMeta): Promise<Post & {...}>
recordPublishAttempt(orgId: string, id: string): Promise<unknown>
claimErrorForRetry(orgId: string, id: string): Promise<boolean>   // conditional ERROR -> QUEUE, clears error fields
getTopLevelPostsByGroup(orgId: string, group: string): Promise<Array<{ id: string; state: State; integrationId: string; errorCategory: PublishErrorCategory | null; releaseId: string | null; integration: { providerIdentifier: string } }>>
// PostsService: changeState gains the same 6th param; recordPublishAttempt, claimErrorForRetry, getTopLevelPostsByGroup pass through with the same signatures.
```
Behavior of `changeState`: state `ERROR` writes `error` (as before, only when `err` truthy), `errorCategory = meta?.category ?? 'UNKNOWN'`, `errorRetryable = meta?.retryable ?? false`. State `QUEUE` or `DRAFT` with no `err` writes `error: null, errorCategory: null, errorRetryable: null`. Other states do not write these keys. `updatePost` (PUBLISHED) also writes the three nulls. `changeDate` with action `schedule` and `createOrUpdatePost` for states `draft|schedule|now` (not `update`) write the three nulls plus `releaseId: null, releaseURL: null`.

- [ ] **Step 1: Write failing tests** in `posts.repository.reliability.spec.ts`. Build the repository exactly as `posts.repository.update-semantics.spec.ts` does (`new PostsRepository(post as any, {} as any, {} as any, {} as any, tagsPostsMock as any, errorsMock as any, {} as any)`), with `post.model.post.{update, updateMany, findMany, upsert, findFirst}` as `jest.fn()`. Cases:
  - `changeState('p1','ERROR','boom',[{}],'org-1',{category:'RATE_LIMITED',retryable:true})` calls `update` with `data` containing `state:'ERROR', error:'boom', errorCategory:'RATE_LIMITED', errorRetryable:true`.
  - `changeState('p1','ERROR','boom')` (update mock returns `{organizationId:'o',integration:{providerIdentifier:'x'},id:'p1'}`) writes `errorCategory:'UNKNOWN', errorRetryable:false`.
  - `changeState('p1','QUEUE',undefined,undefined,'org-1')` writes `error:null, errorCategory:null, errorRetryable:null`; same for `'DRAFT'`; for `'HELD'` and `'PUBLISHED'` the `data` has no `errorCategory` key (`expect(data).not.toHaveProperty('errorCategory')`).
  - `updatePost('p1','rel-1','https://x')` data includes `state:'PUBLISHED', releaseId:'rel-1'` and the three nulls.
  - `changeDate('org','p1','2026-12-01T10:00:00Z', false, 'schedule')` data includes `state:'QUEUE', releaseId:null, releaseURL:null, error:null, errorCategory:null, errorRetryable:null`; with action `'update'` it has none of those keys.
  - `recordPublishAttempt('org-1','p1')` calls `update` with `where:{id:'p1',organizationId:'org-1'}` and `data:{publishAttempts:{increment:1}, lastPublishAttemptAt: expect.any(Date)}`.
  - `claimErrorForRetry('org-1','p1')` calls `updateMany` with `where:{id:'p1',organizationId:'org-1',state:'ERROR',deletedAt:null}` and `data` containing `state:'QUEUE'` and the three nulls; resolves `true` when mock returns `{count:1}`, `false` for `{count:0}`.
  - `getTopLevelPostsByGroup('org-1','g1')` calls `findMany` with `where:{organizationId:'org-1',group:'g1',deletedAt:null,parentPostId:null}`.
  - `createOrUpdatePost('schedule','org-1','2026-12-01T10:00:00Z',{integration:{id:'c'},settings:{__type:'x'},value:[{content:'hi',image:[]}]} as any,[],'API' as any)`: the `upsert` call's `update` and `create` objects both include the three nulls and `releaseId:null`; with `'update'` neither does.

- [ ] **Step 2: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.reliability.spec.ts --coverage=false`
Expected: FAIL.

- [ ] **Step 3: Implement** the repository changes above. `getTopLevelPostsByGroup` selects `{ id, state, integrationId, errorCategory, releaseId, integration: { select: { providerIdentifier: true } } }`. In `PostsService.startWorkflow`'s failure branch change the existing `this._postRepository.changeState(postId,'ERROR','Could not schedule ...', undefined, orgId)` call to pass `{ category: 'UNKNOWN', retryable: true }` as 6th argument. Add the three pass-through service methods.

- [ ] **Step 4: Run Step 2 command plus** `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/posts --coverage=false`. Expected: PASS, no existing posts spec broken.

- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src/database/prisma/posts
GIT commit -m "feat(publishing): persist error category, attempt counter and clear stale errors on re-arm"
```

---

### Task 5: Provider-call activities that never throw, plus failure persistence

**Files:**
- Modify: `apps/orchestrator/src/activities/post.activity.ts` (new methods; `postSocial` pre-call throws at ~215-228; `changeState` ~395-428; `searchForMissingThreeHoursPosts` ~115)
- Test: `apps/orchestrator/src/activities/post.activity.spec.ts` (extend + update the existing `post.failed` assertion)

**Interfaces:**
- Consumes: `classifyPublishError`, `PublishFailure`, `PrePublishError` (Task 2); `PostsService.recordPublishAttempt`, `changeState(..., meta)` (Task 4).
- Produces (new `@ActivityMethod()`s on `PostActivity`):
```ts
export type PublishAttemptResult =
  | { outcome: 'published'; results: PostResponse[] }
  | { outcome: 'already_published'; releaseId: string }
  | { outcome: 'failed'; failure: PublishFailure };

publishPostById(orgId: string, integrationId: string, posts: Post[], allowRepublish: boolean): Promise<PublishAttemptResult>
publishCommentById(orgId: string, integrationId: string, id: string, postId: string | undefined, posts: Post[]): Promise<PublishAttemptResult>
markPublishFailed(orgId: string, postId: string, failure: PublishFailure, body?: unknown): Promise<void>
```
`PostResponse` is imported from `@postsider/nestjs-libraries/integrations/social/social.integrations.interface` (type only).

Behavior:
- `publishPostById`: (1) pre-call phase in its own `try`: `row = await this._postService.getPostById(posts[0].id, orgId)`; if `!allowRepublish && row?.releaseId && row.releaseId !== 'missing'` then, only if `row.state === 'QUEUE'`, call `this._postService.updatePost(row.id, row.releaseId, row.releaseURL ?? '', orgId)`, and return `{ outcome: 'already_published', releaseId: row.releaseId }`; otherwise `await this._postService.recordPublishAttempt(orgId, posts[0].id)` and `integration = await this._loadIntegration(orgId, integrationId)`. Any throw in the pre-call phase returns `{ outcome:'failed', failure:{ category:'UNKNOWN', retryable:true, autoRetry:'none', message: 'Publishing could not start: ' + sanitizeFailureMessage(e?.message, 'internal error') } }`. (2) provider phase: `try { return { outcome:'published', results: await this.postSocial(integration, posts) } } catch (e) { return { outcome:'failed', failure: classifyPublishError(e) } }`.
- `publishCommentById`: same pattern without the releaseId guard; records the attempt on `posts[0].id`; provider phase calls `this.postComment(id, postId, integration, posts)`.
- `postSocial`: change the two pre-provider `throw new Error(...)` (no subscription, provider no longer supported) to `throw new PrePublishError(...)` with the same messages.
- `markPublishFailed`: `await this._postService.changeState(postId,'ERROR', failure.message, body, orgId, {category: failure.category, retryable: failure.retryable})` then emits `post.failed` through a new private `_emitPostFailed(orgId, postId, errorText, meta)`.
- `changeState` (legacy, used by v1.0.8): when `state === 'ERROR'` and `err` is a non-string object, derive `meta = classifyPublishError(err)` and pass `{category, retryable}`; for string/absent `err` pass `{category:'UNKNOWN', retryable:false}`. The `post.failed` payload becomes `{ postId, error, errorCategory, errorRetryable, post }` (shared `_emitPostFailed`).
- `searchForMissingThreeHoursPosts`: `signalWithStart('postWorkflowV109', ...)`.

- [ ] **Step 1: Write failing tests** (extend `createActivity()` so `posts` mock also has `getPostById`, `updatePost`, `recordPublishAttempt`; give the activity a `_integrationService.getIntegrationById` stub returning an integration, and spy `activity.postSocial`/`postComment` with `jest.spyOn(activity, 'postSocial')`). Cases:
  - already published (`releaseId:'rel-1'`, state `PUBLISHED`), `allowRepublish=false`: result `{outcome:'already_published', releaseId:'rel-1'}`, `postSocial` not called, `recordPublishAttempt` not called, `updatePost` not called.
  - same row with state `QUEUE`: `updatePost` called once with `('p1','rel-1', 'https://x', 'org-1')`, `postSocial` not called.
  - `releaseId:'missing'` publishes (guard does not apply); `releaseId:'rel-1'` with `allowRepublish=true` publishes.
  - success: `recordPublishAttempt('org-1','p1')` called BEFORE `postSocial` (use `mock.invocationCallOrder`), result `{outcome:'published', results:[...]}`.
  - provider throws `new RefreshToken('x','{}','','exp')` -> `{outcome:'failed', failure:{category:'AUTH_EXPIRED', autoRetry:'refresh', ...}}`; throws `net('ECONNRESET')` -> `UNKNOWN_OUTCOME`; the method itself never rejects.
  - `getPostById` rejects -> failure category `UNKNOWN`, retryable true, message starts with `Publishing could not start:`, `postSocial` not called.
  - `markPublishFailed('org-1','p1',{category:'RATE_LIMITED',retryable:true,autoRetry:'delay',message:'slow down'})` -> `posts.changeState` called with `('p1','ERROR','slow down', undefined,'org-1',{category:'RATE_LIMITED',retryable:true})` and `publicWebhooks.deliver` called with `('org-1','post.failed', expect.objectContaining({ postId:'p1', error:'slow down', errorCategory:'RATE_LIMITED', errorRetryable:true }))`.
  - legacy `changeState('post-1','ERROR','provider failure',[{integration:{organizationId:'org-1'}}])`: update the existing assertion to expect `errorCategory:'UNKNOWN', errorRetryable:false` in the delivered payload and `posts.changeState` called with meta `{category:'UNKNOWN', retryable:false}`; with an object error `new BadBody('x','{}','','m','rate_limited')` meta is `{category:'RATE_LIMITED', retryable:true}`.
  - `searchForMissingThreeHoursPosts` calls `workflow.signalWithStart` with `'postWorkflowV109'` (stub `_temporalService.client.getRawClient()` -> `{ workflow: { signalWithStart: jest.fn() } }`; `posts.searchForMissingThreeHoursPosts` returns one post).

- [ ] **Step 2: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts apps/orchestrator/src/activities/post.activity.spec.ts --coverage=false`
Expected: FAIL.

- [ ] **Step 3: Implement** per the behavior above.
- [ ] **Step 4: Run the same command.** Expected: PASS (existing 3 plus new).
- [ ] **Step 5: Commit**
```
GIT add apps/orchestrator/src/activities/post.activity.ts apps/orchestrator/src/activities/post.activity.spec.ts
GIT commit -m "feat(publishing): classified provider activities with at-most-once guard"
```

---

### Task 6: `postWorkflowV109` (no generic retry) and switch the starters

**Files:**
- Create: `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.9.ts`
- Modify: `apps/orchestrator/src/workflows/index.ts` (add export line after v1.0.8), `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` (`startWorkflow` line ~1000: `'postWorkflowV108'` -> `'postWorkflowV109'`)
- Test: `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.9.spec.ts`, `libraries/nestjs-libraries/src/database/prisma/posts/posts.start-workflow.spec.ts`

**Interfaces:**
- Consumes: Task 5 activities; `classifyPublishError`, `PublishFailure`, `AUTO_RETRY_DELAYS`, `MAX_AUTH_REFRESHES` (Task 2).
- Produces: exported function `postWorkflowV109({ taskQueue, postId, organizationId, postNow = false }: { taskQueue: string; postId: string; organizationId: string; postNow?: boolean }): Promise<boolean | void>`.

- [ ] **Step 1: Write the failing workflow test.** Mock `@temporalio/workflow` like `r2.multipart.cleanup.workflow.v1.spec.ts` (variables prefixed `mock`): `proxyActivities: jest.fn(() => mockActivities)` where `mockActivities` is one object holding `jest.fn()` for `getPostsListForPublish, getPostForPublish, claimPostForPublish, inAppNotification, changeState, updatePost, sendWebhooks, isCommentableById, publishPostById, publishCommentById, markPublishFailed, refreshTokenWithCauseById, internalPlugsById, globalPlugsById, processInternalPlug, processPlug`; also mock `sleep`, `defineSignal: jest.fn(()=>'poke')`, `setHandler: jest.fn()`, `startChild: jest.fn()`, and export `ActivityFailure`/`ApplicationFailure` stubs (empty classes). Defaults in `beforeEach`: `getPostForPublish -> {publishDate: new Date(0), state:'QUEUE'}`, `claimPostForPublish -> {outcome:'publish'}`, `getPostsListForPublish -> [{ id:'p1', organizationId:'org', settings:'{}', intervalInDays:null, firstComment:null, integration:{ id:'int1', organizationId:'org', providerIdentifier:'x', name:'N', refreshNeeded:false, disabled:false, deletedAt:null } }]`, `internalPlugsById -> []`, `globalPlugsById -> []`, `publishPostById -> {outcome:'published', results:[{postId:'rel1', releaseURL:'https://x/1', status:'completed'}]}`. Run with `await postWorkflowV109({taskQueue:'x', postId:'p1', organizationId:'org'})`. Cases:
  1. success: `publishPostById` called once with `('org','int1',[expect.objectContaining({id:'p1'})], false)`; `updatePost('p1','rel1','https://x/1')`; `sendWebhooks('rel1','org','int1')`; `markPublishFailed` not called.
  2. `postNow:true` passes `true` as the 4th argument.
  3. `already_published` -> resolves; `updatePost`, `sendWebhooks`, `markPublishFailed` not called.
  4. rate limited once then success: first result `{outcome:'failed', failure:{category:'RATE_LIMITED',retryable:true,autoRetry:'delay',message:'slow'}}`; `sleep` called with `'2 minutes'` (and not with other values); `publishPostById` called twice; no `markPublishFailed`.
  5. always rate limited: `publishPostById` called exactly 3 times, `sleep` called with `'2 minutes'` then `'10 minutes'`, then `markPublishFailed('org','p1', expect.objectContaining({category:'RATE_LIMITED'}), expect.anything())`; resolves `false`.
  6. activity rejects with `{ name:'ActivityFailure', cause:{ name:'TimeoutFailure', timeoutType:'START_TO_CLOSE' } }`: `publishPostById` called exactly ONCE, no `sleep`, `markPublishFailed` called with category `UNKNOWN_OUTCOME` and `retryable:false`.
  7. AUTH_EXPIRED + `autoRetry:'refresh'`, `refreshTokenWithCauseById -> true` once then publish succeeds: refresh called once with `('org','int1', 'msg')`; publish called twice.
  8. AUTH_EXPIRED, refresh returns `false`: publish called once; `markPublishFailed` category `AUTH_EXPIRED`, `retryable:false`.
  9. AUTH_EXPIRED forever with refresh always `true`: `publishPostById` called exactly 3 times (1 + `MAX_AUTH_REFRESHES`), then `markPublishFailed`.
  10. `non-retryable` failure (`INVALID_CONTENT`, `autoRetry:'none'`): one call, `markPublishFailed` once, `inAppNotification` called once.
  11. `updatePost` rejects after a successful publish: `publishPostById` called once, `markPublishFailed` called with category `UNKNOWN_OUTCOME`, `retryable:false`, and a message containing `https://x/1`.
  12. `integration.refreshNeeded: true` -> `markPublishFailed` category `AUTH_EXPIRED`, `retryable:false`, message `Refresh channel needed`; `publishPostById` not called. `integration.disabled: true` -> `markPublishFailed` category `UNKNOWN`, message `Channel disabled`. `integration.deletedAt` set -> message `Channel deleted`. `getPostForPublish -> false` -> `changeState('p1','ERROR','No Post')` exactly as v1.0.8 does (the post row may not exist, so `markPublishFailed` is not used there).
  13. thread: two rows in `getPostsListForPublish` with `isCommentableById -> true`; first publish succeeds, `publishCommentById` called with `('org','int1','rel1',undefined,[row2])`; a comment failure marks no ERROR on row 1 (`markPublishFailed` not called) and calls `inAppNotification`.
  14. `postSocialById` and `postCommentById` are never referenced (they are absent from `mockActivities`, so a call would throw).

- [ ] **Step 2: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.9.spec.ts --coverage=false`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Copy `post.workflow.v1.0.8.ts` to `post.workflow.v1.0.9.ts`, then apply EXACTLY these edits:
  1. Header comment: describe v1.0.9 (no generic retry, provider activities run once and return classified failures, `releaseId` guard lives in the activity). Rename `postWorkflowV108` to `postWorkflowV109` everywhere in the file (function name and the `startChild(postWorkflowV108, ...)` reference).
  2. Imports: add `import { classifyPublishError, AUTO_RETRY_DELAYS, MAX_AUTH_REFRESHES, PublishFailure } from '@postsider/nestjs-libraries/integrations/publish-error.classifier';` and `import type { PublishAttemptResult } from '@postsider/orchestrator/activities/post.activity';`. Drop the now unused `ActivityFailure, ApplicationFailure` imports from the main code (keep nothing that is unused).
  3. Keep `proxyTaskQueue` as it is (3 attempts, 2 minute interval: used for token refresh, plugs, `isCommentableById`). Add next to it:
```ts
// Provider-calling activities run exactly once: Temporal must never re-run a call
// that may already have published. Failures come back as values, not exceptions.
const proxyOnce = (taskQueue: string) =>
  proxyActivities<PostActivity>({ startToCloseTimeout: '10 minute', taskQueue, retry: { maximumAttempts: 1 } });
```
     In the workflow body destructure `publishPostById, publishCommentById` from `proxyOnce(taskQueue)` and drop `postSocialById, postCommentById` from the existing destructuring. Add `markPublishFailed` to the top-level retrying proxy list (next to `changeState`).
  4. The three early `changeState(..., 'ERROR', ...)` calls for refresh-needed, channel deleted, channel disabled become `markPublishFailed(post.organizationId, postsListBefore[0].id, { category, retryable:false, autoRetry:'none', message }, postsListBefore)` with: refresh needed `AUTH_EXPIRED` / `'Refresh channel needed'`; deleted `UNKNOWN` / `'Channel deleted'`; disabled `UNKNOWN` / `'Channel disabled'`. The `No Post` calls (two of them) stay `changeState(postId,'ERROR','No Post')`.
  5. Replace the whole block from `// list of all the saved results` to the end of the `for (let i = 0; i < postsList.length; i++)` loop (everything up to the line `// send webhooks for the post`) with:
```ts
  const postsResults: PostResponse[] = [];
  for (let i = 0; i < postsList.length; i++) {
    if (i > 0 && postsList[i].delay) {
      await sleep(60000 * Math.max(0, Number(postsList[i].delay ?? 0)));
    }
    let refreshes = 0;
    let delays = 0;
    let outcome!: PublishAttemptResult;
    for (;;) {
      try {
        outcome =
          i === 0
            ? await publishPostById(organizationId, post.integration.id, [postsList[i]], postNow)
            : await publishCommentById(organizationId, post.integration.id, postsResults[0].postId,
                postsResults.length === 1 ? undefined : postsResults[i - 1].postId, [postsList[i]]);
      } catch (err) {
        // Includes Temporal timeouts: the call may have published, never retry it.
        outcome = { outcome: 'failed', failure: classifyPublishError(err) };
      }
      if (outcome.outcome !== 'failed') break;
      const failure: PublishFailure = outcome.failure;
      if (failure.autoRetry === 'refresh' && refreshes < MAX_AUTH_REFRESHES) {
        refreshes++;
        if (await refreshTokenWithCauseById(organizationId, post.integration.id, failure.message)) continue;
        outcome = { outcome: 'failed', failure: { ...failure, retryable: false, autoRetry: 'none' } };
        break;
      }
      if (failure.autoRetry === 'delay' && delays < AUTO_RETRY_DELAYS.length) {
        await sleep(AUTO_RETRY_DELAYS[delays++]);
        continue;
      }
      break;
    }

    if (outcome.outcome === 'already_published') {
      return; // at-most-once: the row already carries a release id
    }
    if (outcome.outcome === 'failed') {
      if (i === 0) {
        await markPublishFailed(post.organizationId, postsList[0].id, outcome.failure, postsList);
      }
      await inAppNotification(post.organizationId,
        i === 0 ? `Error posting on ${post.integration?.providerIdentifier} for ${post?.integration?.name}`
                : `Comment publishing failed on ${post.integration?.providerIdentifier}`,
        i === 0 ? `An error occurred while posting on ${post.integration?.providerIdentifier}: ${outcome.failure.message}`
                : `The main post was published, but a comment or thread could not be published: ${outcome.failure.message}`,
        true, false, 'fail');
      return false;
    }

    postsResults.push(...outcome.results);
    try {
      await updatePost(postsList[i].id, postsResults[i].postId, postsResults[i].releaseURL);
    } catch (updateErr) {
      // Published on the platform, result not saved: never call the provider again.
      await markPublishFailed(post.organizationId, postsList[i].id, {
        category: 'UNKNOWN_OUTCOME', retryable: false, autoRetry: 'none',
        message: `Published on the platform (${postsResults[i].releaseURL}) but PostSider could not save the result. Do not retry. Check the channel.`,
      }, postsList);
      return false;
    }
    // (copy from v1.0.8, unchanged) when i === 0: the best-effort inAppNotification success block
    // and the best-effort first-comment block, each in their own try/catch.
  }
```
     Keep the v1.0.8 success notification and first-comment blocks verbatim inside `if (i === 0) { ... }` after `updatePost`.
  6. Everything after `// send webhooks for the post` stays identical (plugs, repeat-post `startChild(postWorkflowV109, ...)`).
  Then: add `export * from './post-workflows/post.workflow.v1.0.9';` to `workflows/index.ts`; change `'postWorkflowV108'` to `'postWorkflowV109'` in `PostsService.startWorkflow`.

- [ ] **Step 4: Write `posts.start-workflow.spec.ts`**: `Object.create(PostsService.prototype)` with `_temporalService = { client: { getRawClient: () => ({ workflow: { list: () => (async function*(){})(), start } }) } }`; `await service.startWorkflow('x','p1','org-1','QUEUE')` -> `start` called with `'postWorkflowV109'`, options `workflowId:'post_p1'` and `workflowIdConflictPolicy:'TERMINATE_EXISTING'`; with state `'DRAFT'` -> `start` not called.

- [ ] **Step 5: Run both specs, then the build.**
Run: `pnpm exec jest -c jest.config.ts apps/orchestrator/src/workflows/post-workflows libraries/nestjs-libraries/src/database/prisma/posts/posts.start-workflow.spec.ts --coverage=false` -> PASS.
Run: `pnpm run build:orchestrator` -> exits 0 (the workflow bundle compiles; the classifier must import nothing). Then `pnpm run build:backend` -> exits 0.

- [ ] **Step 6: Commit**
```
GIT add apps/orchestrator/src/workflows apps/orchestrator/src/activities libraries/nestjs-libraries/src/database/prisma/posts
GIT commit -m "feat(publishing): postWorkflowV109 with at-most-once provider calls and bounded safe retries"
```

---

### Task 7: Expose the taxonomy on the API, webhook sample and OpenAPI

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts` (`getPosts` `select` ~320), `libraries/nestjs-libraries/src/services/public-webhook-events.ts`, `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` (`getPost`, `getPosts` decorators), `libraries/helpers/src/swagger/load.swagger.ts` is NOT touched here (Task 14)
- Create: `libraries/nestjs-libraries/src/dtos/posts/public-post-failure.dto.ts`
- Test: `libraries/nestjs-libraries/src/database/prisma/posts/posts.exposure.spec.ts`, `libraries/nestjs-libraries/src/services/public-webhook-events.spec.ts`, `apps/backend/src/public-api/routes/v1/public.reliability.openapi.spec.ts`

**Interfaces:**
- Produces: `PublicPostFailureFieldsDto` (class with `@ApiPropertyOptional` for `errorCategory` (enum of the 7 names, nullable), `errorRetryable` (boolean, nullable), `publishAttempts` (integer), `lastPublishAttemptAt` (date-time, nullable)); `getPosts` rows and `PostsService.getPost(...).posts[n]` carry `errorCategory, errorRetryable, publishAttempts, lastPublishAttemptAt`; `PUBLIC_WEBHOOK_EVENT_SAMPLES['post.failed']` gains `errorCategory: 'RATE_LIMITED'` and `errorRetryable: true` (existing keys kept).

- [ ] **Step 1: Write failing tests.**
  - `posts.exposure.spec.ts`: (a) repository: `getPosts('org-1',{startDate:'2026-06-01',endDate:'2026-06-30'} as any)` with `findMany` mocked to `[]` -> the `select` argument has `errorCategory: true, errorRetryable: true, publishAttempts: true, lastPublishAttemptAt: true`, and its previous keys (`id, state, releaseId, group, ...`) are still true. (b) service: `PostsService.prototype.getPost` with `(service as any).getPostsRecursively = async () => [{ id:'p1', group:'g', integrationId:'i', settings:'{}', image:'[]', errorCategory:'UNKNOWN_OUTCOME', errorRetryable:false, publishAttempts:2, lastPublishAttemptAt: new Date('2026-11-04T10:00:00Z'), integration:{ id:'i', picture:null, token:'secret' } }]` and `updateMedia` stubbed -> `result.posts[0]` has the four fields and `result.posts[0].integration` has no `token`.
  - `public-webhook-events.spec.ts`: every `PUBLIC_WEBHOOK_EVENTS` entry has a sample; `PUBLIC_WEBHOOK_EVENT_SAMPLES['post.failed']` has `postId, error, post, errorCategory, errorRetryable` with `errorCategory` a member of `PUBLISH_ERROR_CATEGORIES`.
  - `public.reliability.openapi.spec.ts`: build `Test.createTestingModule({ controllers: [PublicIntegrationsController] }).useMocker(() => ({}))`, `jest.mock('isomorphic-dompurify', ...)` as in `public.http.spec.ts`, `SwaggerModule.createDocument(app, new DocumentBuilder().build(), { extraModels: [PublicPostFailureFieldsDto] })`; assert `document.components.schemas.PublicPostFailureFieldsDto.properties.errorCategory.enum` equals the 7 names, and `document.paths['/public/v1/posts/{id}'].get.description` contains `errorCategory`.

- [ ] **Step 2: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.exposure.spec.ts libraries/nestjs-libraries/src/services/public-webhook-events.spec.ts apps/backend/src/public-api/routes/v1/public.reliability.openapi.spec.ts --coverage=false`
Expected: FAIL.

- [ ] **Step 3: Implement.** Add the four `true` selections to `getPosts`. Update the sample. Create the DTO. On `PublicIntegrationsController` add `@ApiExtraModels(PublicPostFailureFieldsDto)` and `@ApiOperation({ summary, description })` to `getPost` and `getPosts`; the `getPost` description text: `Returns the post group. Each post row includes errorCategory (AUTH_EXPIRED, PERMISSION_MISSING, RATE_LIMITED, INVALID_CONTENT, PROVIDER_UNAVAILABLE, UNKNOWN_OUTCOME, UNKNOWN or null), errorRetryable, publishAttempts and lastPublishAttemptAt. UNKNOWN_OUTCOME means the platform may have published the post: check the channel before retrying.` (no dashes).
- [ ] **Step 4: Run Step 2 command.** Expected: PASS. Also run `pnpm exec jest -c jest.config.ts apps/backend/src/public-api --coverage=false` -> PASS (no regression in `public.get-posts.spec.ts`, `public.http.spec.ts`).
- [ ] **Step 5: Commit**
```
GIT add libraries apps/backend/src/public-api
GIT commit -m "feat(api): expose publish error category, retryable flag and attempts on posts and post.failed"
```

---

### Task 8: `POST /posts/group/:group/retry-failed`

**Files:**
- Create: `libraries/nestjs-libraries/src/dtos/posts/retry-failed.dto.ts`
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` (new method + public re-arm helper), `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` (new route next to `deletePostByGroup` ~537)
- Test: `libraries/nestjs-libraries/src/database/prisma/posts/posts.retry-failed.spec.ts`, `apps/backend/src/public-api/routes/v1/public.retry-failed.http.spec.ts`

**Interfaces:**
- Consumes: `getTopLevelPostsByGroup`, `claimErrorForRetry` (Task 4); `startWorkflow` (existing); `PublicApiIdempotencyService.claim/complete/release` (existing).
- Produces:
```ts
export class RetryFailedPostsDto { includeUnknownOutcome?: boolean }   // @IsOptional() @IsBoolean()
export type RetryFailedResult = { postId: string; integrationId: string; previousState: State;
  action: 'requeued' | 'skipped';
  reason?: 'not_in_error_state' | 'unknown_outcome_requires_confirmation' | 'already_published' | 'rearm_failed' };
// PostsService
retryFailedByGroup(orgId: string, group: string, opts: { includeUnknownOutcome: boolean }): Promise<{ group: string; results: RetryFailedResult[] }>
```
Behavior of `retryFailedByGroup`: `rows = getTopLevelPostsByGroup`; if empty throw `NotFoundException('Group not found')`; `await this.assertOrgNotPausedForSchedule(orgId)` only if at least one row is `ERROR` (a paused org throws its existing exception for the whole call). For each row in order: non-`ERROR` -> skipped `not_in_error_state`; `errorCategory === 'UNKNOWN_OUTCOME' && !includeUnknownOutcome` -> skipped `unknown_outcome_requires_confirmation`; `releaseId && releaseId !== 'missing'` -> skipped `already_published`; otherwise (TikTok rows run `tiktokProblemsForStoredPost`, problems -> `rearm_failed`) `claimErrorForRetry`; if it returns false (another call won) -> skipped `not_in_error_state`; if true -> `startWorkflow(providerIdentifier.split('-')[0].toLowerCase(), id, orgId, 'QUEUE')` inside try/catch (failure -> skipped `rearm_failed`, logged; `startWorkflow` already marks the row ERROR itself) else `requeued`. `previousState` is the state read at the start.
Controller route: `@Post('/posts/group/:group/retry-failed') @RequirePublicApiScopes('posts:write')` with `@Param('group') group`, `@Body() body: RetryFailedPostsDto`, `@Headers('idempotency-key') key?`; idempotency claim body is `{ route: 'retry-failed', group, includeUnknownOutcome: body.includeUnknownOutcome === true }`; same replay/complete/release pattern as `createPost`.

- [ ] **Step 1: Write failing service tests** (`Object.create(PostsService.prototype)` with stubs `getTopLevelPostsByGroup`, `claimErrorForRetry`, `startWorkflow`, `assertOrgNotPausedForSchedule`, `tiktokProblemsForStoredPost`, a logger). Rows: `A` ERROR (category `RATE_LIMITED`), `B` PUBLISHED, `C` ERROR `UNKNOWN_OUTCOME`, `D` QUEUE, `E` ERROR with `releaseId:'rel9'`, `F` ERROR category null. Expected with default options: A requeued, B skipped `not_in_error_state`, C skipped `unknown_outcome_requires_confirmation`, D skipped `not_in_error_state`, E skipped `already_published`, F requeued; `claimErrorForRetry` called only for A and F; `startWorkflow` called twice with `(…,'QUEUE')`. With `{includeUnknownOutcome:true}` C is requeued too. `claimErrorForRetry` -> false for A: A skipped `not_in_error_state`, `startWorkflow` not called for A. `startWorkflow` rejects for A: A skipped `rearm_failed`, others unaffected. No rows -> rejects `NotFoundException` with message `Group not found`. A group with no ERROR rows does not call `assertOrgNotPausedForSchedule`. `assertOrgNotPausedForSchedule` rejecting propagates and nothing is claimed. Result `previousState` equals the input row state; response shape is exactly `{ group, results }`.
- [ ] **Step 2: Write failing HTTP tests** (`public.retry-failed.http.spec.ts`): copy the harness of `public.http.spec.ts` (real Nest app, `useMocker`, stub middleware sets `req.org = { id:'org-1', ...}` and `req.publicApiScopes`), with `PostsService` stub `retryFailedByGroup` and `PublicApiIdempotencyService` stub `{claim, complete, release}`. Cases: 200 with the stub result; body `{includeUnknownOutcome:'yes'}` -> 400; scopes `['posts:read']` -> 403; `retryFailedByGroup` called with `('org-1','g1',{includeUnknownOutcome:false})`; with header `Idempotency-Key: k1`, `claim` called with `('org-1','k1',{route:'retry-failed',group:'g1',includeUnknownOutcome:false})`; a `{kind:'replay', response:{replayed:true}}` claim returns that body without calling `retryFailedByGroup`; on service rejection `release` is called; a 404 from the service is a 404 response and the same for another org's group (service throws `NotFoundException`).
- [ ] **Step 3: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.retry-failed.spec.ts apps/backend/src/public-api/routes/v1/public.retry-failed.http.spec.ts --coverage=false`
Expected: FAIL.
- [ ] **Step 4: Implement** per the behavior block. Add the route to `docs/API-MCP-TRUST.md` is Task 14, not here.
- [ ] **Step 5: Run Step 3 command** -> PASS, then `pnpm run build:backend` -> exit 0.
- [ ] **Step 6: Commit**
```
GIT add libraries/nestjs-libraries apps/backend/src/public-api
GIT commit -m "feat(api): retry failed destinations of a post group with unknown-outcome confirmation"
```

---

### Task 9: MCP tool `postsider_retry_failed_posts` and the frozen lists

**Files:**
- Modify: `apps/mcp/src/server.ts` (register after `postsider_update_post_status` ~900; update the `postsider_get_post` description ~419), `apps/mcp/src/__tests__/tool-inventory.ts`, `apps/mcp/src/__tests__/http-transport.spec.ts:218`, `apps/mcp/README.md` (line 139 and the Write table ~170), `apps/mcp/server.json` (`toolCount`), `apps/mcp/CHANGELOG.md` (Unreleased entry), `apps/mcp/chatgpt-app-submission.json` (new tool entry mirroring `postsider_update_post_status`)
- Test: `apps/mcp/src/__tests__/server.spec.ts` (extend), `apps/mcp/src/__tests__/tool-inventory.ts` (edit)

**Interfaces:**
- Consumes: `client.post(path, body, idempotencyKey)`; REST route from Task 8.
- Produces: tool `postsider_retry_failed_posts` with input `{ groupId: string (nonEmptyId), includeUnknownOutcome?: boolean, idempotencyKey?: string (1..255) }`; annotations `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }`; it calls `client.post('/posts/group/' + encodeURIComponent(groupId) + '/retry-failed', { includeUnknownOutcome: includeUnknownOutcome === true }, idempotencyKey)` and returns `ok(result)`. Description (no dashes): `Re-queue only the destinations of a post group that are in ERROR, never published, queued, draft or pending approval rows. Read the group first with postsider_get_post. Rows whose errorCategory is UNKNOWN_OUTCOME may already be live on the platform: they are skipped unless includeUnknownOutcome is true, and you must only set it after the user confirmed on the platform that the post is not published. The result lists every row as requeued or skipped with a reason. Do not call this repeatedly; read the posts back to see the new state.`

- [ ] **Step 1: Edit `tool-inventory.ts` first (this is the failing test).** Add `'postsider_retry_failed_posts'` to `EXPECTED_TOOL_NAMES`, set `EXPECTED_TOOL_COUNT = 38`, add the annotation entry above to `EXPECTED_TOOL_ANNOTATIONS`. Change `http-transport.spec.ts:218` from `toHaveLength(37)` to `toHaveLength(38)`. In `server.spec.ts` add a test: connect, call `postsider_retry_failed_posts` with `{ groupId: 'g 1', includeUnknownOutcome: true, idempotencyKey: 'k1' }` against a mocked client/fetch and assert the request was `POST /posts/group/g%201/retry-failed` with JSON body `{"includeUnknownOutcome":true}` and header `Idempotency-Key: k1`; and a second test that without `includeUnknownOutcome` the body is `{"includeUnknownOutcome":false}`. (Reuse the fetch-mock approach already in `publishing-workflow.spec.ts` / `server.spec.ts`.) Add one assertion that the `postsider_get_post` description contains `errorCategory`.
- [ ] **Step 2: Run to verify failure.**
Run: `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --runInBand`
Expected: FAIL (inventory mismatch, tool missing).
- [ ] **Step 3: Implement** the tool in `server.ts` and update the `postsider_get_post` description by appending: `Each post row also carries errorCategory, errorRetryable, publishAttempts and lastPublishAttemptAt; UNKNOWN_OUTCOME means check the platform before retrying.` Update README (count line becomes `38 tools (39 on the local stdio server)`; add a Write-table row `postsider_retry_failed_posts | Re-queue only the failed destinations of a post group; unknown-outcome rows need explicit confirmation. | Re-publishes failed rows`), `server.json` `toolCount: 38`, CHANGELOG Unreleased bullet, and the `chatgpt-app-submission.json` entry (`readOnlyHint false`, `openWorldHint true`, `destructiveHint false`, justifications: re-queues failed posts for publishing to the user's connected channels; does not delete or overwrite content). Do NOT bump the package version.
- [ ] **Step 4: Run** `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --runInBand` -> PASS; then `pnpm --filter @postsider/mcp run typecheck && pnpm --filter @postsider/mcp run typecheck:tests && pnpm --filter @postsider/mcp run version:gate && pnpm --filter @postsider/mcp run validate:registry` -> all exit 0.
- [ ] **Step 5: Commit**
```
GIT add apps/mcp
GIT commit -m "feat(mcp): postsider_retry_failed_posts tool and failure fields in get_post"
```

---

### Task 10: Outbox enqueue and single-attempt delivery

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-delivery.service.ts` (rewrite), `libraries/nestjs-libraries/src/services/public-webhook-events.ts` (add test event export)
- Test: `libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-delivery.service.spec.ts` (rewrite), `libraries/nestjs-libraries/src/services/public-webhook-events.spec.ts` (extend)

**Interfaces:**
- Consumes: `prisma.publicWebhookDelivery`, `prisma.publicWebhookSubscription`, `prisma.$queryRaw` (Task 1); `signWebhook`, `subscriptions.deriveSecret`, `ssrfSafeDispatcher` (existing).
- Produces (exact):
```ts
// public-webhook-events.ts
export const PUBLIC_WEBHOOK_TEST_EVENT = 'webhook.test' as const;
export type PublicWebhookDeliveryEvent = PublicWebhookEvent | typeof PUBLIC_WEBHOOK_TEST_EVENT;
// public-webhook-delivery.service.ts
export const WEBHOOK_BACKOFF_MS: readonly [60000, 300000, 1800000, 7200000, 21600000, 43200000];
export const WEBHOOK_MAX_ATTEMPTS = 7;
export const WEBHOOK_LEASE_MS = 300000;
export interface ClaimedDelivery { id: string; organizationId: string; subscriptionId: string; eventId: string; event: string; payload: PublicWebhookEnvelope; attempts: number; createdAt: Date }
export type AttemptOutcome = 'SUCCEEDED' | 'RETRY' | 'FAILED' | 'SKIPPED';
class PublicWebhookDeliveryService {
  deliver<T>(organizationId: string, event: PublicWebhookEvent, data: T): Promise<{ eventId: string; attempted: number; delivered: number; failed: number }>; // signature unchanged
  enqueue(organizationId: string, event: PublicWebhookDeliveryEvent, data: unknown, only?: { subscriptionId: string }): Promise<{ eventId: string; deliveryIds: string[] }>;
  claimDue(opts: { limit: number; ids?: string[] }): Promise<ClaimedDelivery[]>;
  attempt(row: ClaimedDelivery): Promise<AttemptOutcome>;
  processDue(limit?: number): Promise<{ claimed: number; succeeded: number; retried: number; failed: number }>;
}
```
Behavior:
- `enqueue`: envelope `{ id: 'evt_' + randomUUID(), event, createdAt: new Date().toISOString(), organizationId, data }`. Targets = `publicWebhookSubscription.findMany({ where: { organizationId, active: true, events: { has: event } }, select: { id: true } })` (exactly the old `where`), or, when `only` is given (test sends), that one subscription regardless of `active` and `events`. `publicWebhookDelivery.createMany({ data: rows })` with client side `id: randomUUID()`, `organizationId`, `subscriptionId`, `eventId: envelope.id`, `event`, `payload: envelope`, `status: 'PENDING'`, `attempts: 0`, `nextAttemptAt: new Date()`.
- `claimDue`: one `prisma.$queryRaw` (tagged template, `Prisma.sql`) running
```sql
UPDATE "PublicWebhookDelivery" d
SET "attempts" = d."attempts" + 1,
    "nextAttemptAt" = (NOW() AT TIME ZONE 'UTC') + make_interval(secs => 300)
WHERE d."id" IN (
  SELECT "id" FROM "PublicWebhookDelivery"
  WHERE "status" = 'PENDING'
    AND "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC')
    AND (${ids}::text[] IS NULL OR "id" = ANY(${ids}::text[]))
  ORDER BY "nextAttemptAt" ASC
  LIMIT ${limit}
  FOR UPDATE SKIP LOCKED)
RETURNING d."id", d."organizationId", d."subscriptionId", d."eventId", d."event", d."payload", d."attempts", d."createdAt"
```
  (`ids` is `null` when not given).
- `attempt(row)`: load subscription (`findUnique` by id: `url, secretVersion, active`). If missing or `!active` and the event is not `webhook.test`: update row `status:'FAILED', nextAttemptAt:null, lastError:'subscription_inactive'` and return `'SKIPPED'` (no counter change). Otherwise POST `JSON.stringify(row.payload)` with the SAME headers as today, `X-Webhook-Attempt: String(row.attempts)`, `X-Postsider-Event: row.event`, `X-Postsider-Event-Id: row.eventId`, signature over `${timestamp}.${body}`, `redirect: 'error'`, 10 s timeout, SSRF dispatcher (dynamic import path unchanged). Outcomes: `response.ok` -> row `SUCCEEDED, deliveredAt: now, nextAttemptAt: null, lastStatusCode, lastError: null`; subscription `consecutiveFailures: 0, lastDeliveryAt: now, lastFailureAt: null` (non-test only); bookkeeping errors are swallowed and logged (never throw, never re-send). Non-ok or thrown: `lastStatusCode` (or null), `lastError` = `HTTP <status>` or `String(error)` truncated to 500 chars. Permanent = status 400..499 except 429, OR `event === 'webhook.test'`, OR `row.attempts >= WEBHOOK_MAX_ATTEMPTS`: row `FAILED, nextAttemptAt:null`; for non-test events run the old `recordFailure` (increment `consecutiveFailures`, set `lastFailureAt`, deactivate with `disabledAt` at 10) and return `'FAILED'`. Otherwise row stays `PENDING` with `nextAttemptAt = now + WEBHOOK_BACKOFF_MS[row.attempts - 1]` and return `'RETRY'`.
- `deliver`: `enqueue` then `claimDue({ limit: deliveryIds.length, ids: deliveryIds })` then `Promise.all(attempt)`; returns `{ eventId, attempted: deliveryIds.length, delivered: count SUCCEEDED, failed: attempted - delivered }`. With zero targets it returns `{ eventId, attempted:0, delivered:0, failed:0 }` without calling `createMany`.
- `processDue(limit = 50)`: `claimDue({ limit })`, attempts each with bounded concurrency 5, returns counts.

- [ ] **Step 1: Rewrite the spec.** Keep the helper `makeService(model)` style but the Prisma mock now has `publicWebhookSubscription: { findMany, findUnique, update }`, `publicWebhookDelivery: { createMany, update }`, `$queryRaw: jest.fn()`. Cases (each with exact assertions):
  1. tenant and event filter (old test kept): `findMany` called with `where: { organizationId:'org-1', active:true, events:{ has:'post.published' } }`; zero targets -> `{attempted:0,delivered:0,failed:0}` and `createMany` not called.
  2. `enqueue` writes rows: `createMany` data[0] has `organizationId, subscriptionId, eventId: /^evt_/, event, status:'PENDING', attempts:0, nextAttemptAt: expect.any(Date)` and `payload` equal to `{ id: eventId, event, createdAt: <iso>, organizationId, data }`; returns the same `deliveryIds`.
  3. `deliver` success: `$queryRaw` mock returns one claimed row (attempts 1, payload envelope); fetch called once; headers include `X-Webhook-Attempt:'1'`, `X-Postsider-Event-Id` equal to `payload.id`, `X-Postsider-Signature: /^sha256=/`, `redirect:'error'`; body equals `JSON.stringify(payload)`; row update has `status:'SUCCEEDED'`, `lastStatusCode:204`, `deliveredAt: expect.any(Date)`; subscription update `consecutiveFailures:0`; result `{attempted:1,delivered:1,failed:0}`.
  4. 500 response, `attempts:1`: row update `status` NOT `FAILED`, has `nextAttemptAt` about `Date.now()+60000` (within 2 s), `lastStatusCode:500`, `lastError:'HTTP 500'`; subscription counter NOT incremented. Table test `attempt` outcome `RETRY` for attempts 1..6 with delays `[60000,300000,1800000,7200000,21600000,43200000]`.
  5. attempts = 7 and 500: row `FAILED`, `nextAttemptAt:null`, subscription `consecutiveFailures:{increment:1}`; outcome `FAILED`.
  6. 400: `FAILED` immediately at attempts 1, one fetch, counter incremented once. 429: `RETRY`.
  7. thrown fetch error: `RETRY`, `lastError` contains the error text.
  8. `attempts` header reflects the row: claimed row `attempts:3` sends `X-Webhook-Attempt:'3'`.
  9. 2xx but row update rejects: no throw, fetch called once.
  10. 10th consecutive failure deactivates: subscription `update` mock returns `{consecutiveFailures:10}` -> a second `update` with `data: { active:false, disabledAt: expect.any(Date) }`.
  11. `webhook.test` event: one fetch, on 500 row `FAILED`, subscription `update` never called with `consecutiveFailures`; works when subscription `active:false`.
  12. inactive subscription for a normal event: no fetch, row `FAILED` with `lastError:'subscription_inactive'`, outcome `SKIPPED`.
  13. `processDue(10)`: `$queryRaw` called once; with two claimed rows both attempted.
  14. `enqueue(..., only:{subscriptionId:'s1'})` for `webhook.test`: `findMany` NOT used; `findUnique` used with `where:{ id:'s1', organizationId:'org-1' }`; an unknown id yields `deliveryIds: []`.
- [ ] **Step 2: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/webhooks libraries/nestjs-libraries/src/services/public-webhook-events.spec.ts --coverage=false`
Expected: FAIL.
- [ ] **Step 3: Implement** per the behavior block; the constructor stays `(prisma: PrismaService, subscriptions: PublicWebhookSubscriptionsService)`. Existing callers (`post.activity.ts`, `approval.service.ts`) need no change.
- [ ] **Step 4: Run Step 2 command**, plus `pnpm exec jest -c jest.config.ts apps/orchestrator/src/activities/post.activity.spec.ts libraries/nestjs-libraries/src/database/prisma/approval --coverage=false`. Expected: PASS.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries/src
GIT commit -m "feat(webhooks): durable outbox with single-attempt delivery and exponential backoff"
```

---

### Task 11: Delivery worker cron

**Files:**
- Create: `apps/orchestrator/src/activities/webhook.delivery.activity.ts`, `apps/orchestrator/src/workflows/webhook.delivery.workflow.ts`
- Modify: `apps/orchestrator/src/workflows/index.ts` (export), `apps/orchestrator/src/app.module.ts` (add to `activities`), `libraries/nestjs-libraries/src/temporal/infinite.workflow.register.ts` (add `{ type: 'webhookDeliveryWorkflow', id: 'webhook-delivery-workflow' }` to `crons`)
- Test: `apps/orchestrator/src/activities/webhook.delivery.activity.spec.ts`, `apps/orchestrator/src/workflows/webhook.delivery.workflow.spec.ts`, `libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-delivery.claim.integration.spec.ts`

**Interfaces:**
- Consumes: `PublicWebhookDeliveryService.processDue` (Task 10).
- Produces: `class WebhookDeliveryActivity` (`@Injectable() @Activity()`, constructor `(private _delivery: PublicWebhookDeliveryService)`) with `@ActivityMethod() processDueWebhookDeliveries(): Promise<{ claimed: number; succeeded: number; retried: number; failed: number }>`; exported workflow function `webhookDeliveryWorkflow()`.

Workflow (follow `media.cleanup.workflow.ts`): `proxyActivities<WebhookDeliveryActivity>({ startToCloseTimeout: '5 minute', retry: { maximumAttempts: 3, backoffCoefficient: 1, initialInterval: '30 seconds' } })`; `ITERATIONS_PER_RUN = 120`; each iteration: `try { let r = await processDueWebhookDeliveries(); while (r.claimed >= 50) r = await processDueWebhookDeliveries(); } catch (err) { log.error(...) }` then `await sleep('1 minute')`; finish with `continueAsNew<typeof webhookDeliveryWorkflow>()`.

- [ ] **Step 1: Write failing tests.**
  - Activity spec: `processDueWebhookDeliveries()` delegates to `delivery.processDue` (called once with no args) and returns its result.
  - Workflow spec (mock `@temporalio/workflow` as in `r2.multipart.cleanup.workflow.v1.spec.ts`): first iteration calls the activity once and `sleep('1 minute')`; if the activity returns `{claimed:50,...}` once then `{claimed:3,...}` it is called twice before sleeping; an activity rejection is logged via `log.error` and the loop still sleeps (make `sleep` reject on the second call to stop the loop); `continueAsNew` is called after 120 iterations (set `mockSleep` to resolve and count calls).
  - Integration spec (skipped unless `process.env.PS_TEST_DATABASE_URL` is set; use `const d = process.env.PS_TEST_DATABASE_URL ? describe : describe.skip;`): create `new PrismaClient({ datasources: { db: { url } } })`, seed `organization.create({ data: { name: 'claim-test' } })`, one `publicWebhookSubscription` (events `['post.published']`, `secretVersion:'v'`, `url:'https://example.com/h'`) and 40 `publicWebhookDelivery` rows `PENDING` with `nextAttemptAt` 1 minute in the past; build two `PublicWebhookDeliveryService` instances over the same client; `await Promise.all([a.claimDue({limit:25}), b.claimDue({limit:25}), a.claimDue({limit:25})])`; assert the union of returned ids has no duplicates and size 40, every returned `attempts` is 1, and a second `claimDue({limit:50})` immediately returns `[]` (lease: `nextAttemptAt` is about 5 minutes ahead). Then set one row's `nextAttemptAt` to the past again and assert it becomes claimable (lease expiry) with `attempts` 2. Clean up rows and org in `afterAll`.
- [ ] **Step 2: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts apps/orchestrator/src/activities/webhook.delivery.activity.spec.ts apps/orchestrator/src/workflows/webhook.delivery.workflow.spec.ts --coverage=false` -> FAIL.
- [ ] **Step 3: Implement** the activity, workflow, export, module registration (`WebhookDeliveryActivity` in the `activities` array of `app.module.ts`; `PublicWebhookDeliveryService` is already provided by `DatabaseModule`), and the cron entry.
- [ ] **Step 4: Run Step 2 command** -> PASS. Run the integration spec against the Task 1 cluster:
`PS_TEST_DATABASE_URL=postgresql://postgres@localhost:55432/ps_cp pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-delivery.claim.integration.spec.ts --coverage=false` -> PASS. Without the variable the suite reports skipped. Then `pnpm run build:orchestrator` -> exit 0 and `pnpm run build:backend` -> exit 0.
- [ ] **Step 5: Commit**
```
GIT add apps/orchestrator libraries/nestjs-libraries
GIT commit -m "feat(webhooks): one-minute Temporal worker draining the delivery outbox"
```

---

### Task 12: Deliveries list, replay and test routes

**Files:**
- Modify: `apps/backend/src/public-api/routes/v1/public-webhook-subscriptions.controller.ts`, `libraries/nestjs-libraries/src/database/prisma/database.module.ts` (provider)
- Create: `libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-deliveries.service.ts` (a NEW service: adding these methods to `PublicWebhookSubscriptionsService` would create a DI cycle, because the delivery service already injects it)
- Test: `libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-deliveries.service.spec.ts`, `apps/backend/src/public-api/routes/v1/public-webhook-deliveries.controller.spec.ts`

**Interfaces:**
- Consumes: `PublicWebhookDeliveryService.enqueue/claimDue/attempt` (Task 10), `PUBLIC_WEBHOOK_TEST_EVENT`.
- Produces:
```ts
export interface DeliverySummary { id: string; eventId: string; event: string; status: 'PENDING'|'SUCCEEDED'|'FAILED'; attempts: number;
  nextAttemptAt: Date | null; lastStatusCode: number | null; lastError: string | null; createdAt: Date; deliveredAt: Date | null }
class PublicWebhookDeliveriesService {   // constructor(prisma: PrismaService, delivery: PublicWebhookDeliveryService)
  list(organizationId: string, subscriptionId: string, opts: { limit?: number; cursor?: string }): Promise<{ deliveries: DeliverySummary[]; nextCursor: string | null }>;
  replay(organizationId: string, subscriptionId: string, deliveryId: string): Promise<DeliverySummary>;
  sendTest(organizationId: string, subscriptionId: string): Promise<DeliverySummary>;
}
```
Controller additions on `PublicWebhookSubscriptionsController` (constructor gains `private readonly deliveries: PublicWebhookDeliveriesService`): `@Get('/:id/deliveries') @RequirePublicApiScopes('webhooks:read')` with `@Query('limit') limit?: string, @Query('cursor') cursor?: string`; `@Post('/:id/deliveries/:deliveryId/replay') @RequirePublicApiScopes('webhooks:write')`; `@Post('/:id/test') @RequirePublicApiScopes('webhooks:write')`. Order of declaration: the existing `@Get('/events')` stays before `@Get('/:id')`; add the new routes after `rotateSecret` (distinct method+path shapes, no collision).

Behavior:
- Every method first runs the ownership check `publicWebhookSubscription.findFirst({ where: { id: subscriptionId, organizationId }, select: { id: true } })`, 404 `HttpException('Webhook subscription not found', 404)` otherwise.
- `list`: `limit` parsed, clamped to 1..100, default 25 (non-numeric -> 25). `findMany({ where: { subscriptionId, organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: <summary fields only, no payload> })`; `nextCursor` = id of the last returned row when an extra row existed, else `null`. `lastError` is truncated to 500 chars in the summary.
- `replay`: `findFirst({ where: { id: deliveryId, subscriptionId, organizationId } })` else 404 `Delivery not found`; status `PENDING` -> `HttpException('Delivery is still pending', 409)`; creates a new row (new uuid, same `eventId`, same `payload`, same `event`, `attempts:0`, `PENDING`, `nextAttemptAt: new Date()`), claims it by id, attempts it, re-reads and returns its summary.
- `sendTest`: `delivery.enqueue(organizationId, 'webhook.test', { message: 'This is a test event from PostSider.', subscriptionId }, { subscriptionId })`, claim, attempt, return the row summary (404 if no row was created).

- [ ] **Step 1: Write failing tests.** Service spec with Prisma and delivery mocks:
  - `list` org isolation: foreign subscription (`findFirst` -> null) rejects with status 404 and `delivery.findMany` is NOT called; owned: `findMany` called with `where:{ subscriptionId:'s1', organizationId:'org-1' }`, `orderBy` newest first, `take: 26` for default, `select` has no `payload` key; 27 returned rows -> 25 returned and `nextCursor` equals the 25th id; `limit=1000` -> `take: 101`; `limit=abc` -> `take: 26`; `limit=0` -> `take: 2` (clamped to 1); cursor passes `cursor:{id}, skip:1`.
  - `replay`: foreign subscription 404 and nothing created; delivery of another subscription/org (`findFirst` -> null) 404 `Delivery not found`; `PENDING` row 409; `FAILED` row creates exactly one new row whose `eventId` and `payload` equal the original and whose `id` differs, `attempts:0`; `claimDue`/`attempt` invoked for the new id; returns the new summary; the original row is not updated.
  - `sendTest`: foreign subscription 404 and `enqueue` not called; owned: `enqueue` called with `('org-1','webhook.test', expect.objectContaining({ subscriptionId:'s1' }), { subscriptionId:'s1' })`.
  - Controller spec (instantiate with `Object.create` or `Test.createTestingModule` + mocks): the three handlers delegate with `organization.id`; metadata check via `Reflect.getMetadata` on the scope decorator key used by `RequirePublicApiScopes` (look at `public-api-scope.decorator.ts`) proves `webhooks:read` for list and `webhooks:write` for replay and test.
  - Extend the existing OpenAPI spec file `public-api.openapi.spec.ts`? NO (PR #36 overlap). Instead add to the new controller spec: build the Swagger document with `PublicWebhookSubscriptionsController` and assert `paths['/public/v1/webhook-subscriptions/{id}/deliveries'].get`, `.../deliveries/{deliveryId}/replay` `.post` and `.../{id}/test` `.post` exist.
- [ ] **Step 2: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-deliveries.service.spec.ts apps/backend/src/public-api/routes/v1/public-webhook-deliveries.controller.spec.ts --coverage=false` -> FAIL.
- [ ] **Step 3: Implement.** Register `PublicWebhookDeliveriesService` in `DatabaseModule` providers (and exports, matching how `PublicWebhookSubscriptionsService` is exported there). Existing `public-webhook-subscriptions.controller.spec.ts` constructs the controller; update its construction to pass a stub for the new dependency.
- [ ] **Step 4: Run Step 2 command plus** `pnpm exec jest -c jest.config.ts apps/backend/src/public-api/routes/v1/public-webhook-subscriptions.controller.spec.ts apps/backend/src/public-api/routes/v1/public-api.openapi.spec.ts --coverage=false` -> PASS; `pnpm run build:backend` -> exit 0.
- [ ] **Step 5: Commit**
```
GIT add libraries/nestjs-libraries apps/backend/src/public-api
GIT commit -m "feat(api): webhook delivery log, replay and test send"
```

---

### Task 13: Retention purge

**Files:**
- Create: `apps/orchestrator/src/workflows/public.api.retention.workflow.ts`
- Modify: `apps/orchestrator/src/activities/webhook.delivery.activity.ts` (new method; constructor becomes `(private _delivery: PublicWebhookDeliveryService, private _prisma: PrismaService)`), `apps/orchestrator/src/workflows/index.ts`, `libraries/nestjs-libraries/src/temporal/infinite.workflow.register.ts` (add `{ type: 'publicApiRetentionWorkflow', id: 'public-api-retention-workflow' }`), update the Task 11 activity spec construction
- Test: `apps/orchestrator/src/activities/webhook.delivery.activity.spec.ts` (extend), `apps/orchestrator/src/workflows/public.api.retention.workflow.spec.ts`

**Interfaces:**
- Produces: `@ActivityMethod() purgeExpiredPublicApiRecords(now?: Date): Promise<{ deliveries: number; idempotency: number }>` and workflow `publicApiRetentionWorkflow()` (loop: activity, `sleep('24 hours')`, 60 iterations, `continueAsNew`; activity proxy `startToCloseTimeout '10 minute'`, 3 attempts, 5 minute interval; failure logged and retried next day like `mediaCleanupWorkflow`).
- Constants: `DELIVERY_RETENTION_DAYS = 30`, `IDEMPOTENCY_RETENTION_DAYS = 7`, `PURGE_BATCH = 5000` (exported from the activity file).

Behavior: deliveries cutoff `now - 30 days`; loop `ids = publicWebhookDelivery.findMany({ where: { createdAt: { lt: cutoff }, status: { not: 'PENDING' } }, select: { id: true }, take: 5000 })`, `deleteMany({ where: { id: { in: ids } } })`, repeat while `ids.length === 5000`; same loop for `publicApiIdempotency` with cutoff `now - 7 days` and no status filter; return summed counts.

- [ ] **Step 1: Write failing tests.** Activity: with `now = new Date('2026-11-04T00:00:00Z')`, `findMany` first call arguments equal `where:{ createdAt:{ lt: new Date('2026-10-05T00:00:00Z') }, status:{ not:'PENDING' } }, select:{ id:true }, take:5000` for deliveries and `where:{ createdAt:{ lt: new Date('2026-10-28T00:00:00Z') } }` for idempotency; 5000 ids then 3 ids -> `deleteMany` called twice and total count 5003; empty -> `deleteMany` not called and `{deliveries:0, idempotency:0}`; `status` filter never includes `PENDING` rows (assert the exact `not:'PENDING'`). Workflow spec like the Task 11 one: activity once, `sleep('24 hours')`, `continueAsNew` after 60 iterations, rejection logged and loop continues.
- [ ] **Step 2: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts apps/orchestrator/src/activities/webhook.delivery.activity.spec.ts apps/orchestrator/src/workflows/public.api.retention.workflow.spec.ts --coverage=false` -> FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run Step 2 command** -> PASS; `pnpm run build:orchestrator` -> exit 0. Optional real check against the Task 1 cluster: insert one `PENDING` delivery and one `SUCCEEDED` delivery both dated 40 days ago plus a 10 day old `PublicApiIdempotency` row (`psql -h localhost -p 55432 -U postgres ps_cp`) and call the activity once from a ts-node script; only the non-pending delivery and the idempotency row disappear.
- [ ] **Step 5: Commit**
```
GIT add apps/orchestrator libraries/nestjs-libraries/src/temporal
GIT commit -m "feat(retention): daily purge of old webhook deliveries and idempotency keys"
```

---

### Task 14: Documentation drift fixes

**Files:**
- Modify: `README.md` (line 253 and a new Webhooks section placed after the MCP/plugin section), `libraries/helpers/src/swagger/load.swagger.ts` (description at line 9), `docs/API-MCP-TRUST.md` (route table near line 40: add the retry row), `apps/mcp/skills/postsider-content-publishing/SKILL.md` (line 33: mention `postsider_retry_failed_posts` for group retries and the `UNKNOWN_OUTCOME` rule)
- Test: `libraries/helpers/src/swagger/load.swagger.spec.ts` (new); the other doc checks are the shell greps in Step 4

**Interfaces:** none produced.

Required content:
- README line 253 becomes: `This repository also contains the Claude Code plugin metadata and five skills: postsider-agency-operations, postsider-approval-workflow, postsider-calendar-review, postsider-content-publishing and postsider-performance-reporting.`
- `load.swagger.ts` description becomes: `PostSider REST API. The public API is served under /public/v1 and authenticated with an OAuth token (pos_) or an organization API key.` (remove every `agt_` and "Agent Bridge" mention in that string; leave `initialize.sentry.ts` scrubbing patterns alone, they are defensive).
- README "Webhooks" section (plain prose, no dashes) must contain: the four events (`post.published`, `post.failed`, `approval.requested`, `approval.resolved`) and that `webhook.test` is sent only by the test endpoint; the envelope `{ id, event, createdAt, organizationId, data }`; the `post.failed` data keys `postId, error, errorCategory, errorRetryable, post`; the headers (`X-Postsider-Event`, `X-Postsider-Event-Id`, `X-Postsider-Timestamp`, `X-Postsider-Signature`, `X-Webhook-Attempt`); the signature rule (`HMAC-SHA256` over `<timestamp>.<raw body>` with the subscription secret); delivery is at least once and receivers dedupe on the event id; the retry schedule `1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours`, 7 attempts in total, then the delivery is `FAILED`; non-429 4xx responses are not retried; a subscription is deactivated after 10 consecutive failed deliveries; the routes `GET /public/v1/webhook-subscriptions/:id/deliveries`, `POST .../deliveries/:deliveryId/replay`, `POST .../:id/test` with their scopes; retention 30 days for deliveries and 7 days for idempotency keys; and `POST /public/v1/posts/group/:group/retry-failed` with the `UNKNOWN_OUTCOME` confirmation rule.

- [ ] **Step 1: Write failing tests.** `load.swagger.spec.ts`: import the module and assert the document description string contains `OAuth token (pos_)` and does not contain `agt_` (read the source file text with `fs.readFileSync` if the loader has side effects that need a Nest app). Shell checks listed in Step 4 are the other tests.
- [ ] **Step 2: Run to verify failure.**
Run: `pnpm exec jest -c jest.config.ts libraries/helpers/src/swagger/load.swagger.spec.ts --coverage=false` -> FAIL.
- [ ] **Step 3: Implement** the edits above.
- [ ] **Step 4: Verify.**
```
pnpm exec jest -c jest.config.ts libraries/helpers/src/swagger/load.swagger.spec.ts --coverage=false          # PASS
grep -n "postsider-workflow" README.md                                                                      # no output
grep -n "agt_" libraries/helpers/src/swagger/load.swagger.ts                                                 # no output
grep -n "retry-failed\|webhook.test\|deliveries" README.md docs/API-MCP-TRUST.md                             # matches in both files
GIT diff origin/main -- README.md docs/API-MCP-TRUST.md apps/mcp/skills libraries/helpers/src/swagger | grep -nP '^\+.*[\x{2013}\x{2014}]'   # no output (no em/en dashes added)
```
Expected results as commented.
- [ ] **Step 5: Final full verification, then commit.**
Run each and expect exit 0: `pnpm exec jest -c jest.config.ts apps/orchestrator libraries/nestjs-libraries apps/backend/src/public-api --coverage=false`; `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs --runInBand`; `pnpm run build:backend`; `pnpm run build:orchestrator`; `pnpm --filter @postsider/mcp build`. Stop the throwaway Postgres: `pg_ctl -D "$SCRATCH/pgdata" stop`.
```
GIT add README.md docs/API-MCP-TRUST.md libraries/helpers apps/mcp/skills
GIT commit -m "docs: fix skill and agent-token drift, document webhooks, delivery log, replay and retry-failed"
```

---

## Self-Review

- Spec coverage: R1 -> Tasks 5, 6; R2 -> Tasks 1 to 5; R3 -> Task 7 (+ webhook payload in Task 5); R4 -> Tasks 8, 9; R5 -> Tasks 10, 11, 12; R6 -> Task 13; R7 -> Task 14; compat/rollout and overlap are in the spec. Known gap by design: sleeping v1.0.8 workflows keep old retry behavior (spec section 5, open question 1).
- Names used across tasks: `PublishFailure`, `classifyPublishError`, `PrePublishError`, `AUTO_RETRY_DELAYS`, `MAX_AUTH_REFRESHES`, `PostErrorMeta`, `recordPublishAttempt`, `claimErrorForRetry`, `getTopLevelPostsByGroup`, `publishPostById`, `publishCommentById`, `markPublishFailed`, `postWorkflowV109`, `enqueue/claimDue/attempt/processDue`, `PUBLIC_WEBHOOK_TEST_EVENT`, `PublicWebhookDeliveriesService` are defined once and reused with the same signatures.
- Proportion: code is given in full only for the non-trivial pieces (workflow loop, schema, migration, claim SQL); everything else is signatures plus concrete test assertions.
