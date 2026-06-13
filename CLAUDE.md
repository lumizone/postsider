# CLAUDE.md — PostSider

PostSider is an open-source publishing/scheduling platform for 40+ social
platforms, with an AI-agent bridge (MCP / public REST / SDK). It is a fork of
**Postiz** (`gitroomhq/postiz-app`, AGPL-3.0). pnpm monorepo, NestJS backend +
Next.js frontend + Temporal orchestrator.

## This deployment (production VPS)

- **Host:** single VPS, public IP `51.75.70.123`. The full stack runs in Docker
  via `docker-compose.production.yaml`, behind **host nginx** (TLS via certbot).
- **Domains** (split): dashboard `https://app.postsider.com`, API
  `https://api.postsider.com`, media `https://storage.postsider.com` (MinIO).
  DNS is on **OVH** (nameservers `dns/ns109.ovh.net`).
- **Config:** `.env.production` (chmod 600, gitignored). Secrets were generated
  by `deploy.sh`.
- **Do NOT touch** the other containers on this host: `twenty-*` (CRM), `umami`,
  `root-n8n-1`. They are unrelated and important.

### Deploy / operate

```bash
sudo ./deploy.sh              # build image + (re)start full stack, wait healthy
sudo ./deploy.sh --no-build   # restart only — use after editing .env.production
sudo ./deploy.sh --bootstrap  # first install: also create the first admin
```

- **Backend/library or frontend code change → full `sudo ./deploy.sh`** (the
  Next.js bundle and NEXT_PUBLIC_* are baked at build time; ~10-15 min).
- **`.env.production` change only → `sudo ./deploy.sh --no-build`** (fast).
- Health: `https://api.postsider.com/health` returns 200 when the backend is up.
  A fresh deploy shows a transient 502 for ~30-60s while pm2 boots.
- Containers are `postsider-app` (nginx + pm2: backend/frontend/orchestrator),
  `postsider-postgres`, `postsider-redis`, `postsider-minio`, `postsider-temporal*`,
  `postsider-dbgate`. All bound to `127.0.0.1` except via host nginx.

### Admin UIs (SSH tunnel only — never exposed publicly)

```bash
ssh -L 8082:127.0.0.1:8082 -L 8080:127.0.0.1:8080 -L 9001:127.0.0.1:9001 <host>
```
DbGate `:8082` (Postgres UI, password = `DBGATE_PASSWORD`), Temporal UI `:8080`
(no auth), MinIO console `:9001` (`MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY`).
A public nginx vhost for DbGate (`obsidian-26899d.postsider.com`) was removed —
keep these SSH-tunnel only; do not re-add a public reverse-proxy vhost.

## Architecture

- `apps/backend` — NestJS REST API (auth, posts, integrations, billing, MCP).
- `apps/orchestrator` — Temporal worker (durable scheduled publishing, token
  refresh). Compiles a workflow bundle per platform task-queue on boot.
- `apps/frontend` — Next.js 15 dashboard (App Router, CSS modules).
- `apps/commands` — CLI (bootstrap first admin).
- `libraries/nestjs-libraries` — Prisma, **social providers**, AI, uploads.
- Path aliases: `@postsider/backend/*`, `@postsider/nestjs-libraries/*`, etc.

### Social providers (`libraries/nestjs-libraries/src/integrations/social/`)

Each platform is one class extending `SocialAbstract implements SocialProvider`.
Two connection styles:

- **OAuth** — `generateAuthUrl()` returns a real `http(s)` login URL. Whether the
  dashboard shows a popup depends on `getEnvMapping()` in
  `apps/backend/src/api/routes/integrations.controller.ts`: the provider must be
  listed there AND every mapped env var must be non-empty. Callback URL is
  `${FRONTEND_URL}/integrations/social/<identifier>` (i.e. on **app**, not api) —
  this must be whitelisted in the provider's developer app.
- **customFields** — `customFields()` returns a credential form; the frontend
  base64-encodes the values into `authenticate()`'s `params.code`. Used for
  API-key/token providers (ghost, bluesky, gmail-via-SMTP, …). A provider is
  treated as customFields when it has NO env mapping.

Two-step OAuth providers (facebook, instagram, gmb, linkedin-page, youtube)
return a list from `pages()`/`companies()`; the user picks one and the choice is
finalized via `fetchPageInformation()`. **Convention:** the picker posts
`{ page: <id> }`; `fetchPageInformation` must read `data.page`, and
`pages()`/`companies()` must return `picture` as a plain string URL (the frontend
renders `<img src={picture}>`).

## Local modifications vs upstream

These diverge from the fork. **All pushed to `lumizone/postsider_app` (main).**

- **Gmail → SMTP.** `gmail.provider.ts` rewritten from OAuth to SMTP + App
  Password (nodemailer, `smtp.gmail.com:465`), via customFields (email + 16-char
  App Password). Removed from `getEnvMapping`. Requires 2FA + App Password on the
  Google account. `GmailDto` (subject/to/cc/bcc) unchanged. Gmail is PUBLISH-only:
  removed from `SOURCE_CAPABLE_CONNECTORS` in `connector.catalog.ts` (editing the
  static `EMAIL_CONNECTORS` entry alone is dead code — runtime caps come from the
  social provider via `deriveCapabilities`).
- **Provider bug fixes** (page-pick + avatar) in `instagram`, `gmb`, `facebook`,
  `youtube`: `fetchPageInformation` now reads `data.page`/`data.id` and throws on
  an unresolvable page/location instead of fetching `/undefined`; list functions
  return `picture` as a string. GMB derives the v1 `locationName` from the
  resource path (no `pages()` crawl). Frontend `oauth-callback.tsx`: explicit
  `color: var(--fg)` on picker name/avatar; provider-specific "no pages" message.
- **Whop** OAuth wired: `WHOP_CLIENT_ID` = App ID, `WHOP_CLIENT_SECRET` = API
  key; provider sends `client_secret` in the token exchange (confidential app).
  `uploadMediaToWhop` poll is bounded (no infinite loop) and skips media whose
  file-record create failed (no phantom `{ id: undefined }` attachment).
- **Kick** hidden in `apps/frontend/src/components/add-channel-modal.tsx`
  (integration not working). `reddit` and `vk` are unconfigured (no keys).
- `docker-compose.production.yaml`: `postsider-app` memory limit raised
  1280M → 2560M (backend/orchestrator OOM-looped at the default).

### Auth flows (built here; backend was upstream, frontend pages were missing)

- **Password reset** — `/forgot` (request, `POST /auth/forgot`) + reset page at
  `/auth/forgot/[token]` (`POST /auth/forgot-return`); the email links to
  `${FRONTEND_URL}/auth/forgot/<token>`. Works now (Resend email is configured).
- **Account activation** — `/auth/activate/[token]` (`POST /auth/activate`, then
  refresh session → `/onboarding`); email links to `/auth/activate/<jwt>`.
  **Dormant**: only triggers when `REQUIRE_EMAIL_ACTIVATION="true"` AND an email
  provider is set. Currently `REQUIRE_EMAIL_ACTIVATION` is unset + registration is
  closed, so it never fires — page is ready for when it's enabled.
- Both email-link targets (`/auth/forgot`, `/auth/activate`) are in
  `PUBLIC_PATHS` in `app-root.tsx` — otherwise they bounce to `/login` pre-auth.
- **Onboarding connect fix**: `onboarding-flow.tsx` buttons resolve the real
  OAuth URL via `getOauthUrl()` first (navigating straight to
  `/integrations/social/<id>` hits the callback route with no code → error).
- New i18n keys (`auth.forgot*`/`auth.reset*`/`auth.activate*`) live in `en` only;
  other locales fall back to `en` (`MessageKey` is derived from `en`).

## Gotchas

- **`NOT_SECURED` must be unset in production.** The code checks truthiness, so
  even `NOT_SECURED="false"` enables insecure mode (no session cookie → login
  fails). Keep it commented out in `.env.production`.
- **`DISABLE_REGISTRATION="true"`** — public sign-up is closed; new users are
  added manually. `User.password` is a bcrypt hash, so a raw DbGate insert won't
  authenticate — hash the password first.
- **Billing: Polar.sh, not Stripe.** Enabled by `POLAR_ACCESS_TOKEN`.
  `POLAR_SERVER="sandbox"` = test mode; switch to `production` for real charges.
  With no billing provider set, every org gets the top tier.
- Frontend changes require a **full rebuild** to appear (bundle is baked).

## Conventions

- TypeScript strict (minus `strictNullChecks`). Prettier + ESLint configs at root.
- Prisma: `pnpm prisma-generate`, `pnpm prisma-db-push`; migrations run on boot
  via `pm2-run`.
- Typecheck a change: `npx tsc --noEmit --project apps/backend/tsconfig.json`.
