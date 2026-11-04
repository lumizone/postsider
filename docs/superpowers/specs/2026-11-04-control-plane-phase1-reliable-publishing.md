# Control Plane Phase 1: Reliable Publishing

Date: 2026-11-04
Branch: `feat/control-plane-p1-reliability` (based on `origin/main` 5a7e1cc)
Plan: `docs/superpowers/plans/2026-11-04-control-plane-phase1-reliable-publishing.md`

## 1. Problem

Publishing is the product. Today a failed publish is opaque and can be unsafe:

- The v1.0.8 publish workflow retries a provider call after a generic error (Temporal activity retry 3 x 2 min, times an inner loop of 5, up to about 15 provider calls). A timeout or an ambiguous response after the request was sent can therefore publish the same post twice.
- A failed post carries only a free text `error` string. Clients (API, MCP, webhooks) cannot tell "reconnect the channel" from "rate limited, retry" from "unknown, check the platform first".
- `changeState` never clears an old error, so a re-armed post can show a stale failure.
- There is no way to retry only the failed destinations of a multi-channel group.
- Public webhooks are delivered in process, 3 attempts within seconds, with no record. A receiver outage longer than a few seconds loses the event for good, and there is no delivery log, replay or test.
- `PublicApiIdempotency` grows forever.
- README and Swagger describe things that do not exist.

## 2. Goals and non-goals

Goals: at-most-once publishing, a persisted error taxonomy exposed through API/webhook/MCP, a safe "retry failed destinations" operation, a durable webhook outbox with replay and test, retention, docs fixes.

Non-goals (binding, from decisions D8): no frontend changes, no billing changes, no changes to providers' publish logic beyond error classification, no MCP OAuth changes. No new MCP webhook tools.

## 3. Verified facts about `origin/main`

Verified against code in this worktree. Corrections to the brief are marked CORRECTION.

1. `Post` has `State { QUEUE, PUBLISHED, ERROR, DRAFT, APPROVAL, HELD }`, `error String?`, `releaseId String?`, `releaseURL String?`, one row per integration, shared `group`. Thread comments are child rows (`parentPostId`) in the same group. Confirmed (`schema.prisma`).
2. Workflow `postWorkflowV108` (`apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.8.ts`). Default proxy: `startToCloseTimeout 10 minute`, `maximumAttempts 3`, `initialInterval 2 minutes`, `backoffCoefficient 1`. Inner `iterate` loop of 5. `refresh_token` refreshes then `continue`s. `bad_body` stops with ERROR. Any other error sets ERROR but the loop keeps going. CORRECTION (nuance): `RefreshToken`, `BadBody` and `NotEnoughScopes` in `social.abstract.ts` are constructed with `nonRetryable = true`, so Temporal does not retry them. The 3 x 2 min activity retry applies only to plain `Error`s (network failures, timeouts of the provider SDK, unknown provider exceptions). Those are exactly the ambiguous ones.
3. CORRECTION (important): `postWorkflowV108` is also used for repeat posts. `startChild(postWorkflowV108, { postNow: true })` re-publishes the SAME post row every `intervalInDays`. That row already has a non-null `releaseId` from the previous run. D1 ("never call a provider for a post that already has a releaseId") must therefore exempt repeat runs (`postNow === true`), otherwise repeat posts would silently stop.
4. CORRECTION (important): Temporal replays running workflows against the code they started with. v1.0.8 cannot be edited in place. A new `postWorkflowV109` is required, and `startWorkflow` (`posts.service.ts` line 1000) and `searchForMissingThreeHoursPosts` (`post.activity.ts` line 115) switch to it. Posts already sleeping in a v1.0.8 workflow keep the old behavior until they fire (see Rollout).
5. `ApplicationFailure` types: `refresh_token`, `bad_body`, `not_enough_scopes` (`social.abstract.ts`). `SocialAbstract.fetch` retries 429, 500-without-handler and `retry`-typed handler results up to 3 times in memory, then throws `BadBody` WITHOUT the status. Any other 5xx falls to a final `BadBody('Unknown Error')`. `runInConcurrent` converts every thrown error (including network errors) into `BadBody`. So today the persisted type cannot distinguish rate limit, 5xx or network failure from bad content. The plan tags `BadBody` with a `kind` detail to fix that without changing its Temporal `type`, so v1.0.8 behavior is untouched.
6. `PostsRepository.changeState` (line 608) writes `state` and `error` only when `err` is truthy; it never clears. Re-arm paths: `PostsService.changePostStatus` (line 1702, used by `PUT /public/v1/posts/:id/status`), `PostsRepository.changeDate` with action `schedule` (clears `releaseId`/`releaseURL`), `createOrUpdatePost` for `schedule`/`now`/`draft` (does not clear `error` or `releaseId`), `resumePublishing`.
7. Public webhooks: events in `libraries/nestjs-libraries/src/services/public-webhook-events.ts`. Delivery `public-webhook-delivery.service.ts` is in process, `MAX_ATTEMPTS = 3` with 1 s/2 s sleeps, `DISABLE_AFTER_FAILURES = 10` counted per delivery. Emitted from `post.activity.ts` (`changeState` ERROR at ~409, `sendWebhooks` at ~448) and `approval.service.ts` ~335. Headers: `Content-Type`, `User-Agent: PostSider-Webhooks/1.0`, `X-Webhook-Attempt`, `X-Postsider-Event`, `X-Postsider-Event-Id`, `X-Postsider-Timestamp`, `X-Postsider-Signature`; `redirect: 'error'`; `ssrfSafeDispatcher`. Confirmed.
8. Scopes `posts:read`, `posts:write`, `webhooks:read`, `webhooks:write` already exist on main and are enforced by `PublicApiScopeGuard` / `@RequirePublicApiScopes`. Controller `public-webhook-subscriptions.controller.ts` exists.
9. `PublicApiIdempotency` has no purge; the service (`idempotency/public-api-idempotency.service.ts`) is used only by `POST /posts`. Its key is unique per `(organizationId, key)` and NOT per route, so the new endpoint hashes `{ route, group, body }` as the request body to avoid cross-route collisions.
10. MCP: 37 tools over HTTP, 38 on stdio (`postsider_upload_media_from_file`). Frozen in four places: `apps/mcp/src/__tests__/tool-inventory.ts` (`EXPECTED_TOOL_NAMES`, `EXPECTED_TOOL_COUNT = 37`, `EXPECTED_TOOL_ANNOTATIONS`), `apps/mcp/src/__tests__/http-transport.spec.ts:218` (`toHaveLength(37)`), `apps/mcp/README.md:139` ("37 tools (38 on the local stdio server)") plus its Write table, `apps/mcp/server.json` (`"toolCount": 37`). Also `apps/mcp/chatgpt-app-submission.json` lists per tool annotations and justifications. `version:gate` checks versions only, not tool counts. There is no tool-name to scope map in the hosted transport. The MCP package version stays 1.1.0 (release is an owner action); the change goes in `CHANGELOG.md` under Unreleased.
11. Docs drift confirmed: `README.md:253` mentions a `postsider-workflow` skill that does not exist; real skills are `apps/mcp/skills/postsider-{agency-operations,approval-workflow,calendar-review,content-publishing,performance-reporting}`. `libraries/helpers/src/swagger/load.swagger.ts:9` claims an "agent token (agt_)". README has no webhooks section today.
12. Cron workflows: workflow functions exported from `apps/orchestrator/src/workflows/index.ts`; activities registered in `apps/orchestrator/src/app.module.ts`; started by name in `libraries/nestjs-libraries/src/temporal/infinite.workflow.register.ts` (list `crons`, `RUN_CRON === 'true'`, `workflowIdConflictPolicy: 'USE_EXISTING'`). Pattern: loop N iterations with try/catch + `sleep`, then `continueAsNew`. Confirmed with `missing.post.workflow.ts`, `media.cleanup.workflow.ts`.
13. Test infra: root `jest.config.ts` (ts-jest, roots `apps` and `libraries`, ignores `apps/mcp`) runs any `*.spec.ts`: `pnpm exec jest -c jest.config.ts <path> --coverage=false` (verified on two existing specs, pass). MCP: `NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs <path>`. The many `jest.*.config.cjs` at the root are narrow, per-feature runners and are not needed here.
14. Local database: the Docker daemon is NOT running on this host (`docker ps` fails). Homebrew `postgres` 17.10 and `psql` binaries exist, so a throwaway local cluster is possible. `pnpm exec prisma validate` works offline with a dummy `DATABASE_URL`. Prisma is 6.5.0.

## 4. Requirements

Numbering follows the decisions D1 to D8. All are binding.

### R1 At-most-once publishing (D1)

R1.1 A provider publish call is never made for a post row whose `releaseId` is non-null and not the sentinel `'missing'`. Such a row is treated as already published: the call is skipped, and the row is never moved to a worse state. If the row is still `QUEUE` it is healed to `PUBLISHED` using the stored `releaseId`/`releaseURL`; any other state is left untouched.
R1.2 Exemption: repeat-post runs (`postNow === true`) set `allowRepublish`, because repeating is the feature.
R1.3 Automatic retry happens ONLY for failures known not to have published:
- `AUTH_EXPIRED` (`refresh_token`): refresh the token, retry. At most 2 refreshes per post run.
- `RATE_LIMITED`: wait and retry.
- pre-connection network errors with `code` in `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`: wait and retry.
Waits for the last two use the schedule `['2 minutes', '10 minutes']`, so at most 3 provider calls per post per run.
R1.4 Everything else is terminal with no retry: the post goes to `ERROR` with the classified category. Activity timeouts, aborted or reset connections, and any unrecognized thrown value after the request may have been sent are `UNKNOWN_OUTCOME` with `errorRetryable = false`.
R1.5 The generic-error retry loop is removed. The provider-calling activities run with `retry: { maximumAttempts: 1 }`. They catch every error they raise and RETURN a classified failure value (so Temporal never retries them). A Temporal-level timeout of the activity is still possible; the workflow classifies it as `UNKNOWN_OUTCOME`. DB-update and notification activities keep the existing retry options.
R1.6 If the provider succeeded but the local `updatePost` fails after its retries, the post is marked `ERROR` / `UNKNOWN_OUTCOME` with a message that includes the release URL and tells the user not to retry. The provider is never called again.

Scope note: the guard protects retries and re-runs. It does not close the pre-existing window where `startWorkflow` uses `TERMINATE_EXISTING` while an old run is in the middle of a provider call (see Risks).

### R2 Persisted error taxonomy (D2)

Prisma enum `PublishErrorCategory { AUTH_EXPIRED, PERMISSION_MISSING, RATE_LIMITED, INVALID_CONTENT, PROVIDER_UNAVAILABLE, UNKNOWN_OUTCOME, UNKNOWN }`.
New `Post` fields: `errorCategory PublishErrorCategory?`, `errorRetryable Boolean?`, `publishAttempts Int @default(0)`, `lastPublishAttemptAt DateTime?`.

Meaning of `errorRetryable`: "retrying with no change by the user may succeed, and it is known not to have published".

| Source | Category | errorRetryable | Auto retry |
|---|---|---|---|
| `refresh_token`, refresh succeeded | (not an error) | | refresh + retry |
| `refresh_token`, refresh failed | `AUTH_EXPIRED` | false | no |
| `not_enough_scopes` | `PERMISSION_MISSING` | false | no |
| `bad_body` without kind | `INVALID_CONTENT` | false | no |
| `bad_body` kind `rate_limited`, or HTTP 429 | `RATE_LIMITED` | true | delay |
| `bad_body` kind `provider_unavailable` (5xx) | `PROVIDER_UNAVAILABLE` | false | no |
| pre-connection code, or `bad_body` kind `pre_connection` | `PROVIDER_UNAVAILABLE` | true | delay |
| Temporal timeout, `AbortError`/`TimeoutError`, `ECONNRESET`, `ETIMEDOUT`, `UND_ERR_*`, any other thrown value from a provider call | `UNKNOWN_OUTCOME` | false | no |
| Failure where no provider request was sent (post missing, channel disabled/deleted, scheduler unavailable, pre-call DB error) | `UNKNOWN` | set explicitly by the caller | no |

Clarification of the brief: the brief says "timeout/ambiguous -> UNKNOWN_OUTCOME, else UNKNOWN". Because an unrecognized exception from inside a provider call may have followed a request that was sent, the classifier maps it to `UNKNOWN_OUTCOME` (conservative), and `UNKNOWN` is reserved for failures where nothing was sent. This keeps the D4 default (UNKNOWN_OUTCOME rows are not blindly retried) meaningful.

R2.1 A pure classifier `classifyPublishError(err: unknown): PublishFailure` (no `@temporalio` or `@prisma` imports; duck typed so it works in the workflow sandbox and in activities) returns `{ category, retryable, autoRetry: 'refresh' | 'delay' | 'none', message }`. Messages are at most 500 characters and contain no em dash or en dash (they are replaced with `-`). The `UNKNOWN_OUTCOME` message is: `The platform did not confirm whether this post was published. Check the channel before retrying to avoid a duplicate.`
R2.2 `publishAttempts` is incremented by 1 and `lastPublishAttemptAt` set to now, on the row that is being published, immediately BEFORE each provider call (main post and each comment row).
R2.3 Re-arming a post (state set to `QUEUE` or `DRAFT` by `changeState` without an error, `changeDate` action `schedule`, `createOrUpdatePost` for `schedule`/`now`/`draft`, the new retry endpoint) clears `error`, `errorCategory`, `errorRetryable`. `publishAttempts` is NOT reset (it is an audit counter). Entering `ERROR` always writes all three.
R2.4 Legacy `ERROR` rows keep `errorCategory = null`. API consumers treat null as "unclassified".

### R3 Exposure (D3)

- `GET /public/v1/posts/:id` already returns the whole row inside `posts[]`; the four new columns appear there (additive). A test pins it.
- `GET /public/v1/posts` list: the Prisma `select` in `PostsRepository.getPosts` adds `errorCategory`, `errorRetryable`, `publishAttempts`, `lastPublishAttemptAt`.
- Webhook `post.failed` data adds `errorCategory`, `errorRetryable`. `PUBLIC_WEBHOOK_EVENT_SAMPLES['post.failed']` updated. The existing keys are unchanged.
- OpenAPI: the controller documents the new fields with `@ApiOkResponse` schemas where the operations are decorated; the retry endpoint is fully documented.
- MCP `postsider_get_post` returns the API body unchanged, so the fields flow through; its description is updated to name them.

### R4 Retry failed destinations (D4)

`POST /public/v1/posts/group/:group/retry-failed`, scope `posts:write`, organization scoped (`organizationId` always in the query).
Body: `{ includeUnknownOutcome?: boolean }`, default `false`. Header `Idempotency-Key` supported through `PublicApiIdempotencyService` with the claim body `{ route: 'retry-failed', group, includeUnknownOutcome }`.
Response: `{ group, results: [{ postId, integrationId, previousState, action: 'requeued' | 'skipped', reason? }] }`, one entry per top-level row of the group (`parentPostId = null`, `deletedAt = null`).
Rules:
- Only rows in `ERROR` are re-armed. Rows in any other state are returned as `skipped` with reason `not_in_error_state` and are never touched.
- `ERROR` rows with `errorCategory = UNKNOWN_OUTCOME` are `skipped` with reason `unknown_outcome_requires_confirmation` unless `includeUnknownOutcome` is true.
- `ERROR` rows with a real `releaseId` (not null, not `'missing'`) are `skipped` with reason `already_published`.
- A row whose re-arm fails (org paused, TikTok validation, scheduler error) is `skipped` with reason `rearm_failed`; the error is logged.
- Unknown or foreign group: HTTP 404 `Group not found` (same response for another organization's group).
- The state flip is a conditional update (`state = 'ERROR'` in the `where`) so two concurrent calls re-arm a row once; only the winner starts the workflow.
- Re-arm sets `state QUEUE` and clears error fields, then calls `startWorkflow`. Monthly quota reservation is not repeated (the post was already admitted).
MCP tool `postsider_retry_failed_posts`, inputs `groupId` (string) and `includeUnknownOutcome` (boolean, optional) and `idempotencyKey` (optional). Annotations: `readOnlyHint false`, `destructiveHint false`, `idempotentHint true`, `openWorldHint true`. No frontend UI.

### R5 Durable webhook delivery (D5)

New model `PublicWebhookDelivery` and enum `PublicWebhookDeliveryStatus { PENDING, SUCCEEDED, FAILED }`.

```
id String @id @default(uuid())
organizationId String
subscriptionId String            // relation to PublicWebhookSubscription, onDelete Cascade
eventId String                   // evt_<uuid>, shared by replays
event String                     // PublicWebhookEvent or 'webhook.test'
payload Json                     // the full envelope {id,event,createdAt,organizationId,data}
status PublicWebhookDeliveryStatus @default(PENDING)
attempts Int @default(0)
nextAttemptAt DateTime?
lastStatusCode Int?
lastError String?
createdAt DateTime @default(now())
deliveredAt DateTime?
@@index([status, nextAttemptAt])
@@index([subscriptionId, createdAt])
```
R5.1 `PublicWebhookDeliveryService.deliver(orgId, event, data)` keeps its signature and return shape. It inserts one `PENDING` row per active subscription whose `events` contains the event, then makes one immediate best-effort attempt for those rows. The row state is always truthful (a crash after the HTTP call but before the update leaves the row `PENDING` with `attempts` already incremented by the claim, and the lease expires, so the event may be delivered again; receivers dedupe on `X-Postsider-Event-Id`: at-least-once).
R5.2 A claim is concurrency safe: `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`, which also increments `attempts` and pushes `nextAttemptAt` 5 minutes ahead (a lease, so a crashed worker's rows come due again).
R5.3 Backoff after failed attempt n (1 based): `['1 minute','5 minutes','30 minutes','2 hours','6 hours','12 hours']`, max 7 attempts, then `FAILED`. A non-429 HTTP 4xx is permanent: `FAILED` immediately. Test sends (`event = 'webhook.test'`) make exactly one attempt.
R5.4 Headers, signature (`signWebhook(`${timestamp}.${body}`, secret)`), `redirect: 'error'`, SSRF dispatcher and 10 s timeout are unchanged. `X-Webhook-Attempt` equals the row's `attempts` after the claim. Body is `JSON.stringify(payload)`, which equals the original envelope, so a replay is byte identical apart from timestamp and signature.
R5.5 Auto disable: `consecutiveFailures` increments once per delivery that ends `FAILED` (not per attempt, matching the old per delivery semantics), resets on success, subscription deactivated at 10. `webhook.test` rows never touch the counters. A due row whose subscription is inactive is marked `FAILED` with `lastError = 'subscription_inactive'` without touching counters.
R5.6 Worker: workflow `webhookDeliveryWorkflow` loops, each iteration calls activity `processDueWebhookDeliveries()` then `sleep('1 minute')`, `continueAsNew` after 120 iterations. Registered like the other crons.
R5.7 Routes (new methods on the existing `PublicWebhookSubscriptionsController`):
- `GET /public/v1/webhook-subscriptions/:id/deliveries?limit=&cursor=` scope `webhooks:read`. Newest first. `limit` 1 to 100, default 25. Returns `{ deliveries, nextCursor }` with `id, eventId, event, status, attempts, nextAttemptAt, lastStatusCode, lastError (max 500 chars), createdAt, deliveredAt`. Payload is omitted.
- `POST .../:id/deliveries/:deliveryId/replay` scope `webhooks:write`. Only for rows in `SUCCEEDED` or `FAILED` (409 for `PENDING`). Creates a NEW row (same `eventId`, same `payload`, `attempts 0`, `PENDING`, `nextAttemptAt now`), attempts it immediately, returns the new row summary.
- `POST .../:id/test` scope `webhooks:write`. Creates a `webhook.test` row for that subscription, one attempt, returns the row summary after the attempt. Decision on the event list: `webhook.test` is NOT added to `PUBLIC_WEBHOOK_EVENTS` (that list is what users subscribe to and what `IsIn` validates). It is exported separately as `PUBLIC_WEBHOOK_TEST_EVENT`, bypasses subscription event matching, works for inactive subscriptions, and is documented in the README. `GET /webhook-subscriptions/events` is unchanged.
- All routes check the subscription belongs to the caller's organization first (404 otherwise) and filter deliveries by both `subscriptionId` and `organizationId`.

### R6 Retention (D6)

Daily workflow `publicApiRetentionWorkflow` (every `24 hours`, `continueAsNew` after 60 iterations) calls activity `purgeExpiredPublicApiRecords()`: delete `PublicWebhookDelivery` rows with `createdAt` older than 30 days and `status <> 'PENDING'`; delete `PublicApiIdempotency` rows with `createdAt` older than 7 days. Batched (5000 ids per pass, loop until fewer than 5000 deleted).

### R7 Docs drift (D7)

README: correct the skill reference to the five real skills; add a Webhooks section (events, payload fields incl. new failure fields, headers, signature, delivery log, replay, test, retry schedule, retention, idempotency of receivers by event id). Remove the `agt_` claim from `load.swagger.ts`. `docs/API-MCP-TRUST.md` route table gets the retry-failed row. No em or en dashes in any new prose.

## 5. Compatibility and rollout

- All API and webhook changes are additive. Schema change is one migration, additive (new enum, nullable columns, one defaulted int, new table); no data backfill.
- Order for deploy: migration, then backend and orchestrator together. The orchestrator must be deployed before or with the backend so `postWorkflowV109` exists when the backend starts it.
- Workflows already sleeping on v1.0.8 keep the old retry behavior when they fire. Their `changeState(..., 'ERROR')` calls still get a category because `PostActivity.changeState` classifies when no explicit category is given. Optional follow-up (not in this plan): a one-off sweep that re-arms future `QUEUE` posts to move them to v1.0.9.
- Activity signatures used by v1.0.8 are not changed; only new activities are added.

## 6. Risks and known residual issues

- `TERMINATE_EXISTING` on re-arm can terminate a run that is mid provider call; a new run could then publish again. Out of scope here; the retry endpoint avoids it by re-arming only rows in `ERROR` with a conditional update, and the `releaseId` guard covers the case where the first call finished writing.
- Providers that call `fetch` themselves (not `SocialAbstract.fetch`) still raise `BadBody` without a kind, so their 429/5xx stay `INVALID_CONTENT`. Classification improves incrementally per provider; no provider publish logic is changed here.
- A crash between the provider response and the delivery row update re-sends a webhook (at-least-once).

## 7. Known overlap: open PR #36

Branch `feat/stage4-scoped-api-webhooks-20261103`. Merge base `c593212`. `git diff origin/main...origin/feat/stage4-scoped-api-webhooks-20261103 --stat` reports 52 files (many already present on main by other commits; the two dot diff against main is dominated by newer main content). Files the PR changes that this plan also touches or that sit next to them:

- `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (this plan adds enums, `Post` fields, `PublicWebhookDelivery`; textual conflict likely near the webhook models)
- `libraries/nestjs-libraries/src/database/prisma/database.module.ts` (provider list)
- `libraries/nestjs-libraries/src/database/prisma/webhooks/public-webhook-delivery.service.ts` and `.spec.ts` (this plan rewrites the service: HIGH conflict)
- `libraries/nestjs-libraries/src/dtos/webhooks/public-webhook-subscription.dto.ts` and `.spec.ts` (touched only if the DTO changes; the plan does not need to)
- `apps/orchestrator/src/activities/post.activity.ts` and `.spec.ts` (this plan adds activities and changes `changeState`: HIGH conflict)
- `apps/backend/src/public-api/public.api.module.ts`, `apps/backend/src/public-api/routes/v1/public.http.spec.ts`, `public.integrations.scopes.spec.ts` (route and scope contract specs; the new retry route may need adding to the authorization contract spec once PR #36 lands)
- `apps/backend/src/services/auth/public-api-scope.guard*.ts`, `public-api-oauth-scopes*.ts` (not touched by this plan)

Not in the PR's change list but adjacent: `public-webhook-subscriptions.controller.ts`, `public.integrations.controller.ts`, `public-webhook-events.ts` appear in the 3 dot list but are byte identical to main today, so they conflict only if PR #36 changes them further. Recommended merge order for the supervisor: merge PR #36 first (it hardens scopes and the delivery service this plan rewrites), then rebase this branch, resolving `public-webhook-delivery.service.ts` and `post.activity.ts` by hand and re-running the authorization contract specs with the three new routes.

## 8. Open questions

1. Should the optional sweep that moves sleeping v1.0.8 posts onto v1.0.9 be a follow-up task?
2. Should `GET /posts` list also expose `error` text (currently absent from its select)? The plan adds only the four fields required by D3.
3. Is `UNKNOWN_OUTCOME` for unrecognized provider exceptions (clarification in R2) acceptable?
