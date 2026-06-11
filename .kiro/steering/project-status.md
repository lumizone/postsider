---
inclusion: auto
---

# PostSider — Project Status (2026-06-06)

## Architecture
- **Monorepo** (pnpm workspaces): apps/backend, apps/frontend, apps/commands, apps/orchestrator, libraries/
- **Backend**: NestJS, Prisma (PostgreSQL), Redis, Temporal, port 3000
- **Frontend**: Next.js 15 (App Router), React 19, port 4200
- **Orchestrator**: Temporal worker — handles post publishing, token refresh, webhooks
- **Auth**: JWT via `auth` header. Session tokens expire after 7 days. Provider/MCP tokens never expire.
- **Storage**: Local disk (`./uploads/`) default, Cloudflare R2 optional
- **MCP**: Mastra-based MCP server on `/mcp`, `/mcp/:id`, `/mcp-oauth`, `/sse/:id`

## Forked From
- Based on **postiz-app-main** (Gitroom/Postiz OSS). Backend logic is identical (namespace rename `@gitroom` → `@postsider`).
- Frontend is completely rewritten (custom CSS modules, no Tailwind, no i18n, Apple-inspired B&W design).
- PostSider has additional features not in OSS (see "Advantages over OSS" section below).

## Installation Flow
1. `pnpm install` → `pnpm prisma-db-push` → `pnpm bootstrap`
2. Bootstrap creates placeholder admin (`admin@setup.local` + random password shown in terminal)
3. User logs in with one-time password → forced to `/setup` → sets real email + name + password
4. Registration is disabled (`DISABLE_REGISTRATION=true`). Users join via invite only.

## Channel/Integration System

### Dual-Mode Connect (OAuth + Credential Paste)
- **If OAuth is configured** (keys in DB or env): Modal shows "Sign in with X" + "Enter credentials manually"
- **If OAuth is NOT configured** (empty env vars): Modal shows "Setup OAuth" (save app keys from UI) + "Enter credentials manually"
- **CustomFields-only providers** (Bluesky, Telegram, Nostr, etc.): Directly show credential form

### OAuth Setup from UI
- User clicks "Setup OAuth for [Platform]" → enters Client ID + Secret → saved encrypted in `ProviderCredentials` table
- Credentials are injected into `process.env` at runtime (during auth, posting, and refresh)
- No need to edit `.env` manually — everything from the UI

### Provider Credentials Injection (`ProviderEnvHelper`)
- Before posting/refreshing, `ProviderEnvHelper.withCredentials()` checks:
  1. Env vars already set (non-empty)? → use them directly
  2. Otherwise: fetch from DB (`ProviderCredentials` table) → inject temporarily → restore after

### Providers That REQUIRE App Keys for Posting (even with credential paste)
- **X** — `signOAuth1()` needs `X_API_KEY` + `X_API_SECRET` for every request
- **Discord** — posting uses `DISCORD_BOT_TOKEN_ID` from env
- **Telegram** — uses `TELEGRAM_TOKEN` from env
- **VK** — post API requires `VK_ID`
- **MeWe** — all requests need `MEWE_APP_ID` + `MEWE_API_KEY`

### Providers That Need Keys for Token Refresh Only
- LinkedIn, Reddit, YouTube, TikTok, Pinterest, Twitch, Kick, Mastodon, Slack, Gmail, GMB

### Key Files
- `apps/backend/src/api/routes/integrations.controller.ts` — `getIntegrationUrl`, `getDefaultCustomFields`, `getEnvMapping`, `getOAuthSetupFields`
- `apps/backend/src/api/routes/no.auth.integrations.controller.ts` — `connectSocialMedia`
- `libraries/nestjs-libraries/src/integrations/provider-env.helper.ts` — credential injection
- `libraries/nestjs-libraries/src/database/prisma/integrations/provider-credentials.service.ts` — DB CRUD for OAuth creds
- `apps/frontend/src/components/connect-method-modal.tsx` — OAuth/Manual choice + Setup form

## MCP Server (16 Tools — Full Access)

### Connection Methods
| Method | Endpoint | Auth |
|--------|----------|------|
| URL key (simplest) | `/mcp/:apiKey` | API key in URL |
| Bearer token | `/mcp` | `Authorization: Bearer API_KEY` |
| SSE streaming | `/sse/:apiKey` | API key in URL |
| OAuth 2.1 + PKCE | `/mcp-oauth` | Full OAuth flow |
| Info (public) | `/mcp/info` | None — shows quickstart configs |

### Tools Available to All Agents
| Category | Tools |
|----------|-------|
| **Read** | integrationList, groupList, integrationSchema, postsListTool, analyticsTool, mediaListTool, tagsTool |
| **Write** | schedulePostTool, triggerTool, generateVideoOptions, videoFunctionTool, generateVideoTool, generateImageTool, uploadFromUrlTool |
| **Manage** | postsManageTool (delete/duplicate/reschedule), channelsManageTool (enable/disable/delete) |

### Internal Copilot
- Model: `gpt-5.5` (OpenAI, via @ai-sdk/openai)
- Memory: Mastra Memory with working memory + title generation
- Endpoint: `POST /copilot/agent`

## Security

### Authentication
- **User session**: JWT with 7-day expiry (`signSessionJWT`) — re-login weekly
- **Provider tokens**: JWT without expiry (`signJWT`) — never breaks posting
- **MCP/API keys**: Stored in DB, validated per-request, never expire
- **Passwords**: bcrypt (10 rounds)

### Protections
- **Rate limiting (auth)**: 10 attempts / 15 min per IP on login/register
- **Rate limiting (API)**: 60 req/min per org on Public API (`X-RateLimit-*` headers)
- **SSRF protection**: `IsSafeWebhookUrl` validator + `ssrfSafeDispatcher` (blocks private IPs, DNS pinning)
- **Security headers**: X-Frame-Options: DENY, X-Content-Type-Options: nosniff, HSTS, Referrer-Policy, Permissions-Policy
- **Request ID**: `X-Request-Id` on every response for tracing
- **CORS**: Origin whitelist (FRONTEND_URL only)
- **Cookies**: httpOnly + secure + sameSite when NOT_SECURED is off
- **Encryption**: AES-256-CBC for stored credentials (key derived from JWT_SECRET)

### NOT_SECURED Mode (dev only)
- Auth token exposed in response headers
- Cookies not httpOnly
- Never use in production

## Advantages Over OSS (postiz-app-main)

| Feature | OSS | PostSider |
|---------|-----|-----------|
| OAuth setup from UI | ❌ Requires .env editing | ✅ Setup from Add Channel popup |
| Dual auth (OAuth + credential paste) | ❌ OAuth only | ✅ Both options |
| SSRF protection on webhooks | ❌ Open proxy | ✅ IP blocking + timeout |
| Rate limiting (API) | ❌ None | ✅ Per-org sliding window |
| Rate limiting (auth) | ❌ None | ✅ Per-IP brute-force protection |
| Security headers | ❌ None | ✅ Full set |
| Request ID tracing | ❌ None | ✅ X-Request-Id |
| Health check | ❌ "App is running!" | ✅ /health with Redis check, uptime |
| Webhook retry | ❌ Fire-and-forget | ✅ 3 attempts, exponential backoff |
| JWT expiration (sessions) | ❌ Never expires | ✅ 7-day expiry |
| MCP tools | 10 (OSS) | 16 (full access — posts, analytics, channels, media, tags) |
| MCP /info endpoint | ❌ None | ✅ Public quickstart configs |
| Duplicate post | ❌ None | ✅ Same channel or different channel |
| Media type tracking | ❌ None | ✅ image/video/audio in DB |
| Invite-based registration | ❌ Blocked when DISABLE_REGISTRATION | ✅ Signed invite bypass |
| Frontend proxy timeout | ❌ Default 30s | ✅ 90s |
| Provider env injection from DB | ❌ Requires .env | ✅ ProviderEnvHelper |

## Billing / Payments (Polar.sh)

### Status
- Migrating from Stripe → **Polar.sh** (Merchant of Record — Polar handles tax/VAT).
- Stripe code is left in place; the provider is chosen at runtime by `isBillingEnabled()` / `PolarService.isEnabled()`.
- Billing is **enforced** when `POLAR_ACCESS_TOKEN` (or legacy `STRIPE_PUBLISHABLE_KEY`) is set. With neither, every org behaves as top tier (self-hosted default).

### Backend (done)
- `libraries/nestjs-libraries/src/services/polar.service.ts` — Polar provider (checkout, embedded checkout, customer portal, cancel/revoke, webhook handling, getPackages, checkSubscription). Mirrors StripeService's public surface.
- `libraries/nestjs-libraries/src/services/polar.products.ts` — maps tier+period → Polar product id (from env) and reverse lookup for webhooks.
- `libraries/nestjs-libraries/src/services/billing.flag.ts` — `isBillingEnabled()` single source of truth (Polar OR Stripe configured).
- `apps/backend/src/api/routes/polar.controller.ts` — `POST /polar` webhook endpoint (Standard Webhooks signature via `validateEvent`).
- `billing.controller.ts` + `users.controller.ts` delegate to Polar when enabled, else Stripe.
- Subscription DB layer (`SubscriptionService`/`SubscriptionRepository`) is provider-agnostic and reused unchanged. We set `externalCustomerId = organizationId` on checkout and cache the Polar customer id in `organization.paymentId`.
- Webhook events handled: `subscription.created/active/updated` (upsert tier), `subscription.canceled/revoked` (downgrade to FREE).

### Env vars (.env)
- `POLAR_ACCESS_TOKEN`, `POLAR_SERVER` (sandbox|production), `POLAR_WEBHOOK_SECRET`, `POLAR_ORGANIZATION_ID`
- `POLAR_PRODUCT_<TIER>_<MONTHLY|YEARLY>` for STANDARD/TEAM/PRO/ULTIMATE (one Polar product per tier+interval).

### SDK note
- `@polar-sh/sdk` uses an `exports` map. Backend tsconfig is `moduleResolution: node` (classic), so `@polar-sh/sdk/webhooks` is given a `paths` alias to its `.d.ts` in `tsconfig.base.json`. The runtime require specifier stays `@polar-sh/sdk/webhooks` (verified working).

### Plans / Enforcement
- Tiers: STANDARD ($20/mo, $200/yr), TEAM ($35/$350), PRO ($45/$450), ULTIMATE ($90/$900). No FREE plan in the UI — no subscription = no access.
- **Only three things are enforced by plan**: posts per month (`POSTS_PER_MONTH`), channels (`CHANNEL`), team members (`TEAM_MEMBERS`).
  - STANDARD: 5 channels, 400 posts/mo, no team. TEAM/PRO/ULTIMATE: 10/30/100 channels, unlimited posts, team members.
  - No subscription → 402 Payment Required on creating posts and connecting channels (verified).
- Webhooks and AI/copilot are NOT gated (advertised on every plan) — `@CheckPolicies` removed from those routes.
- AI image/video generation stays unavailable (credits = 0 on all tiers) — feature not built, not advertised.
- **SAMURAI** — internal owner-only tier. Same access as ULTIMATE (unlimited channels/posts/team), free, never charged, not in checkout/pricing UI. Activate by setting `subscription.subscriptionTier = 'SAMURAI'` directly in the DB. Frontend shows it as "Samurai · Internal plan" with no manage/cancel buttons and no plan grid. Added to `SubscriptionTier` enum + `pricing.ts`.

### TODO (pending)
- Frontend `/billing` page — DONE (`/settings/billing`, plan cards + usage + checkout + portal + cancel).
- Polar products configured + verified (8 products, correct prices) in sandbox.
- Pending: end-to-end checkout → webhook → unlock test on a reachable webhook URL.

## Database Schema (additions over OSS)
- `ProviderCredentials` — stores OAuth app keys per org+provider (encrypted)
- `ApiKey` — multiple named API keys per org (for MCP/Public API)
- `TrialUsage` — permanent record of emails that consumed a free trial. NEVER deleted on account deletion. Used to block trial farming (delete account → re-register same email → no new trial). Email stored normalized (lowercase+trim), unique.

## Free Trial (7-day)
- New registrations get a 7-day trial (`organization.allowTrial=true, isTrailing=true`) ONLY if the email has never used one.
- `OrganizationService.createOrgAndUser` checks `hasUsedTrial(email)`; if not used, grants trial + calls `markTrialUsed(email)`.
- Account deletion (`deleteOrganizationCascade`) wipes all org data but intentionally leaves `TrialUsage` intact → re-registration with the same email gets no trial.
- Verified: 1st register=trial, re-register (same/UPPERCASE email)=blocked, new email=trial.

## Danger Zone (settings/security, ADMIN only)
- `POST /settings/disconnect-all-channels` — removes all channels + their posts.
- `POST /settings/delete-account` — cascade-deletes org across ~25 tables in FK-safe order (no DB cascades in schema), then deletes the user if orphaned. Frontend requires typing DISCONNECT/DELETE to confirm.

## Docker Services Required
- PostgreSQL 17 (port 5432)
- Redis 7 (port 6379)
- Temporal (port 7233) — required for backend + orchestrator

## Key Technical Decisions
- `DISABLE_REGISTRATION=true` — no public sign-up, invite-only
- `NOT_SECURED=true` — JWT in header (not httpOnly cookie) for SPA dev
- `STORAGE_PROVIDER=local` + `UPLOAD_DIRECTORY=./uploads` — zero-config local storage
- Channel colors stored in localStorage (no backend field)
- `name === null` on User triggers `/setup` screen
- Frontend: no external dependencies beyond Next.js + React (no state lib, no CSS-in-JS)
- All CSS uses design tokens: `--bg`, `--fg`, `--line-soft`, `--muted`, `--radius-*`, `--ease`
- Apple-inspired B&W premium aesthetic

## Internationalization (i18n)
- Lightweight custom i18n (no external lib, matches "no extra deps" rule): React context + per-locale TS catalogs.
- 11 languages: en (base), ru, zh, fr, de, pt, it, ja, ko, tr, pl.
- Files: `apps/frontend/src/lib/i18n/` — `locales.ts` (list + native names), `index.tsx` (`I18nProvider`, `useT`, `useI18n`), `messages/<locale>.ts`.
- `Messages` type = `Widen<typeof en>` so locale files only match the SHAPE (string values), not exact English text. Missing keys fall back to English.
- Locale stored in `localStorage` (`postsider:locale`), auto-detected from browser on first load; sets `<html lang>`.
- Language switcher in dashboard sidebar (`language-switcher.tsx`).
- `t("nav.calendar")` with `{var}` interpolation, e.g. `t("trial.daysLeft", { days })`.
- Translated so far: sidebar nav, sign out, trial banner. Remaining hardcoded strings (modals, settings pages, posts/media/analytics) to be migrated to `t()` incrementally.

## Known Limitations
- No drag-and-drop post rescheduling on calendar (endpoint exists)
- No provider-specific settings UI (YouTube title, TikTok privacy) — posts use defaults
- No i18n/translation (English only)
- No Sentry/error tracking (can be added)
- No server-side auth middleware in Next.js (client-side auth with brief "Loading..." flash)

## Production Hardening (done)
- **Cookie-based auth**: frontend uses `credentials: "include"`; in production
  (NOT_SECURED off) the JWT lives in an httpOnly+secure+sameSite cookie, not
  localStorage — removes the XSS token-theft vector. localStorage/header path
  remains a dev-only fallback for NOT_SECURED mode.
- **CSRF protection**: `CsrfMiddleware` enforces an Origin/Referer allowlist on
  cookie-authenticated state-changing requests. Header/bearer/agent-token
  requests are exempt (not CSRF-able).
- **Encryption at rest**: AES-256-GCM (authenticated, random IV) via
  `AuthService.encryptSecret`/`decryptSecret` when `ENCRYPTION_KEY` is set,
  with transparent fallback to legacy CBC for existing ciphertext. Deterministic
  lookup values (OAuth tokens/codes, org API keys) intentionally stay on CBC.
- **Startup secret check**: backend refuses to start without `JWT_SECRET`.
