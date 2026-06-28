# PostSider Cloud (PostSider_APP)

The PostSider product app (NestJS backend + Next 15/React 19 frontend + Temporal orchestrator, pnpm monorepo, Postiz fork). **This is now the single repo** for both managed cloud (`app.postsider.com`) and closed-source self-host (a Docker image), switched entirely by env vars (see "Run modes" below). The former lean sibling `../PostSider_OSS` is archived (tag `oss-final`); reference-only, do not edit.

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

## Run modes (one codebase, env-gated)

Cloud and self-host are the SAME build; env vars switch behavior. Helpers: `isBillingEnabled()` (`services/billing.flag.ts`), `isPlatformAiEnabled()` (`services/ai.flag.ts`).

- **Billing is Polar-only.** `isBillingEnabled()` returns `!!process.env.POLAR_ACCESS_TOKEN`. Set (cloud): plans gated, 402 responses carry a `section` for plan-limit messaging. Absent (self-host): every org is unlimited. Stripe controllers/service remain in-tree but **dormant and unused** (no gate reads Stripe).
- **AI is platform key OR BYO key.** `OPENAI_API_KEY` set (cloud): Post Checker + rewrite use `OpenaiService.complete()`. Absent (self-host): they fall back to a per-org BYO key stored in `ProviderCredentials` (`post-checker` namespace); `/settings/post-checker` page + config endpoints appear only in self-host; `/posts/check` + `/posts/rewrite` return 409 until a key is saved.
- **Social OAuth via per-provider env.** Each `integrations/social/*.provider.ts` reads its app id/secret from env. Cloud sets PostSider's; self-host operators set their own (see `.env.example`). There is no paste-in-UI modal.
- **Migrations, NOT `db push`.** Ships Prisma **migration files** (`libraries/nestjs-libraries/src/database/prisma/migrations/`); the server (cloud and self-host Docker) runs `prisma migrate deploy` on boot. Generate new ones with `migrate dev`. Never commit a `db push`-only schema change.

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
