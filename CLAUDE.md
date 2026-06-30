# PostSider Cloud (PostSider_APP)

The PostSider product app (NestJS backend + Next 15/React 19 frontend + Temporal orchestrator, pnpm monorepo, Postiz fork). **This is now the single open-source repo** (AGPL-3.0) for both our managed hosting (`app.postsider.com`) and self-hosting via Docker, switched entirely by env vars (see "Run modes" below).

## Status

- **Release-ready & pushed (2026-06-28).** Single env-gated repo; all inherited Postiz AI stripped (see "No other AI"). Branch `feat/port-oss-features` pushed to `github.com/lumizone/postsider`. This session: removed Stripe (Polar-only), dropped orphaned stripped-AI Prisma models (migration `20260628160000`), added the lean MCP server (`apps/mcp`), `SECURITY.md`/`CODE_OF_CONDUCT.md`/CI, and dep CVE overrides (audit: **0 high**). Verified: backend/orchestrator/frontend/MCP builds + **127 root + 27 MCP tests** green; all migrations apply on a fresh real Postgres; backend boot (health + auth 401) + frontend `/login` e2e ok. Remaining (user): merge -> `main`, VPS deploy (`./deploy.sh --bootstrap`, set `ENCRYPTION_KEY`), register real social OAuth apps + live publish e2e.
- The 11 differentiator features: composer helpers (hashtag groups / caption templates / UTM), posting queue (day-aware find-slot), bulk CSV import, approval workflow, per-platform preview, AI caption rewrite, API request generator, Post Checker, Evergreen, Smart Slots, first-comment.

## Commands

```
pnpm run build:backend            # nest build (full typecheck)
pnpm --filter ./apps/frontend run build
pnpm run build:orchestrator
pnpm --filter @postsider/mcp build   # MCP server (apps/mcp)
pnpm test                         # root jest (excludes apps/mcp); feature units: jest.*.config.cjs
NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs   # MCP server tests
pnpm run prisma-generate          # after schema.prisma changes
pnpm run dev:docker               # Postgres/Redis/Temporal containers
pnpm run dev                      # backend (:3000) + orchestrator (:3002) in parallel
pnpm run dev:frontend             # :4200
```

## Run modes (one codebase, env-gated)

Cloud and self-host are the SAME build; env vars switch behavior. Helpers: `isBillingEnabled()` (`services/billing.flag.ts`), `isPlatformAiEnabled()` (`services/ai.flag.ts`).

- **Billing is Polar-only.** `isBillingEnabled()` returns `!!process.env.POLAR_ACCESS_TOKEN`. Set (cloud): plans gated, 402 responses carry a `section` for plan-limit messaging. Absent (self-host): every org is unlimited. Stripe was **fully removed** (this session); billing is Polar-only via `PolarService`.
- **AI is platform key OR BYO key.** `OPENAI_API_KEY` set (cloud): Post Checker + rewrite use `OpenaiService.complete()`. Absent (self-host): they fall back to a per-org BYO key stored in `ProviderCredentials` (`post-checker` namespace); `/settings/post-checker` page + config endpoints appear only in self-host; `/posts/check` + `/posts/rewrite` return 409 until a key is saved.
- **No other AI (Postiz AI stripped).** All inherited Postiz AI was removed: agent (LangGraph), agent-bridge, MCP/chat server + tools (`/settings/mcp`), copilot, autopost, AI image/video/slides gen (fal, veo3, heygen), voice, `agent-media.ai` SSO. `OpenaiService` exposes ONE method (`complete()`). The two non-AI `chat/` helpers (`@Rules` decorator, `validation.schemas.helper.ts`) stay. Orphaned stripped-AI Prisma models (`AutoPost`, `AgentToken`, `mastra_*`) + dead enum values + `Organization.hitlMode` were removed in migration `20260628160000_remove_stripped_ai_models`. Do not re-add the inherited Mastra agent. **MCP is back, but as a NEW lean server in `apps/mcp` (`@postsider/mcp`) wrapping the public `/public/v1` API for AI agents (only deps: `@modelcontextprotocol/sdk` + `zod`) — keep it; it is NOT the removed inherited Mastra MCP.**
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

## Notes

- `streakWorkflow` / `digestEmailWorkflow` null-guard (org null for orphaned/deleted orgs) was **fixed this session** (`if (!org) ...` guards added).
- MCP self-host base URL: the public API is served under `/api` behind nginx, so set `POSTSIDER_API_URL=https://<domain>/api` (default `https://api.postsider.com`).
