# PostSider Cloud (PostSider_APP)

The **cloud** product app at `app.postsider.com` (NestJS backend + Next 15/React 19 frontend + Temporal orchestrator, pnpm monorepo, Postiz fork). Sibling of `../PostSider_OSS` (the lean self-host build). Has billing (Polar/Stripe) + platform AI; OSS does not.

## Status

- **No longer "frozen."** As of 2026-06-28 the OSS differentiator features were ported here on branch **`feat/port-oss-features`** (commits `6e0e0b1`, `b8bdd4b`). Cross-repo plan: `../PORT-TO-CLOUD-PLAN.md`.
- Ported features (all 11): composer helpers (hashtag groups / caption templates / UTM), posting queue (day-aware find-slot), bulk CSV import, approval workflow, per-platform preview, AI caption rewrite, API request generator, Post Checker, Evergreen, Smart Slots, first-comment.

## Commands

```
pnpm run build:backend            # nest build (full typecheck)
pnpm --filter ./apps/frontend run build
pnpm run build:orchestrator
pnpm test                         # root jest (real config; 23 suites / 136 tests green)
pnpm run prisma-generate          # after schema.prisma changes
pnpm run dev:docker               # Postgres/Redis/Temporal containers
pnpm run dev                      # backend (:3000) + orchestrator (:3002) in parallel
pnpm run dev:frontend             # :4200
```

## Cloud vs OSS — the differences that matter

- **Migrations, NOT `db push`.** Cloud ships Prisma **migration files** (`libraries/nestjs-libraries/src/database/prisma/migrations/`); the server runs `prisma migrate deploy`. Generate new ones with `migrate dev` (or `migrate diff --from-schema-datamodel <old> --to-schema-datamodel <new> --script` for a clean delta). Never commit a `db push`-only schema change. (OSS uses `db push`.)
- **AI is the platform key.** Post Checker + caption rewrite reuse `OpenaiService.complete()` (env `OPENAI_API_KEY`), NOT the OSS bring-your-own-key path. There is no `/settings/post-checker` page or config endpoint here, and `/posts/check` + `/posts/rewrite` never 409.
- **Billing exists** (Polar/Stripe, `billing.controller`, `polar.controller`, `/billing` page, `isBillingEnabled()`); 402 responses carry a `section` for plan-limit messaging in the composer.
- **Platform OAuth apps** are configured, so cloud has no self-host "paste your own OAuth creds" modal (`connect-method-modal` is OSS-only).

## Conventions (shared with OSS)

- Backend modules register in `apps/backend/src/app.module.ts` (global libs) / `apps/backend/src/api/api.module.ts` (`authenticatedController`); DB services in `database.module.ts` (`get exports()` mirrors `providers`). `OpenaiService` is provided by the global `DatabaseModule`.
- Controllers use `@GetOrgFromRequest() org`; role on `org.users[0].role`.
- **Scheduling is UTC.** `PostsService.findFreeDateTime(orgId, integrationId?)` returns a UTC wall-clock string without a zone; callers needing an instant append `'Z'`. `Integration.postingTimes` is `[{time, days?}]` minutes-from-midnight UTC; queue slot search is day-aware (`queue-slots.ts` `slotsForDay` + 365-day guard in `findFreeDateTimeRecursive`).
- **Public API auth is the RAW `Authorization` header** (no `Bearer`); `getOrgByApiKey(auth)` on the whole value. Base `/public/v1`.
- First comment: optional per-post `firstComment`, persisted on the main post row, published best-effort by the publish workflow (`post.workflow.v1.0.5`) for comment-capable providers (`integrations/social/comment.capability.ts`).
- Recurring jobs (Temporal): activity class + self-looping workflow, registered in `apps/orchestrator/src/app.module.ts` `activities` + exported from `workflows/index.ts`, started in `InfiniteWorkflowRegister` gated by `process.env.RUN_CRON` (e.g. `evergreenWorkflow`).
- Frontend: `@/lib/api` `api.{get,post,put,del}`; settings pages mirror `app/settings/api/page.tsx` and use `settings-ui` (`PageHeader`, `Card`, `settingsStyles`); nav in `settings-shell.tsx` / `dashboard-shell.tsx` `NAV_ITEMS`; i18n `lib/i18n` (`en.ts` authoritative, other locales fall back).
- Brand/copy: B&W Apple-minimal; **no em/en-dashes in rendered copy** (LLM-facing prompt text is exempt).

## Known pre-existing issues (NOT from the port)

- `streakWorkflow` / `digestEmailWorkflow` throw `Cannot read properties of null (reading 'users')` when `getUserOrgs()` returns null for an orphaned/deleted org (missing null guard, e.g. `if (!org) return;`). Only triggers on stale data; harmless in production with valid orgs. Left unfixed deliberately.
