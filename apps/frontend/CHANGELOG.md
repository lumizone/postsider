# Frontend changelog

All notable changes to the PostSider dashboard.

## 1.1.0 — Production deployment readiness

Docker image, deploy tooling, and runtime fixes that make PostSider actually
deployable on a VPS with a single `./deploy.sh` command.

### Docker / build fixes (image previously did not build or start)

- **Removed phantom `libraries/*/package.json` COPY** — these dirs aren't pnpm
  packages; the old lines broke the build immediately.
- **Added `.npmrc` to early-copy layer** — pnpm's frozen-lockfile check failed
  without `inject-workspace-packages=true` present at install time.
- **Added orchestrator + sdk `package.json`** to early-copy — lockfile importers
  didn't match, causing `--frozen-lockfile` to abort.
- **Copied Prisma schema before `pnpm install`** — the `postinstall` hook runs
  `prisma generate` which needs the schema file.
- **Added `apps/commands` build step** — the root `build` script only covers
  backend + orchestrator; without this, `commands/dist` was missing and the
  runtime COPY failed.
- **Added `NODE_OPTIONS=--max-old-space-size=4096`** to commands build (OOM on
  default heap).
- **Fixed `nginx.conf` user directive** — was `user www;` but only `postsider`
  exists in the image. Nginx crashed on start, blocking the entire container.
- **Added orchestrator `COPY` to runtime stage** — it was built but never
  copied into the final image; the Temporal worker couldn't start.
- **Added `pm2` script to frontend `package.json`** — pm2 only starts packages
  with a `pm2` script; frontend was silently skipped (502 from nginx).
- **Injected `NEXT_PUBLIC_BACKEND_URL` as Docker build-arg** — Next.js bakes
  `NEXT_PUBLIC_*` at compile time; without it the browser called
  `http://localhost:3000` in production.

### Deploy tooling (new files)

- **`deploy.sh`** — single command to verify prerequisites, auto-generate
  strong secrets for any remaining `CHANGE_ME` placeholders, build the image
  with correct build-args, start the full stack, wait for health, and
  optionally bootstrap the first admin.
- **`deploy/Caddyfile`** — host reverse proxy config with automatic HTTPS
  (Let's Encrypt), HSTS, security headers, `/storage/*` → MinIO routing.
- **`deploy/nginx-host.conf`** — alternative nginx + certbot config.
- **`DEPLOYMENT.md`** — step-by-step VPS deployment guide (DNS, firewall,
  env config, deploy, HTTPS, backups, security checklist, troubleshooting).
- **`.env.production.example`** — tracked template (no secrets) so
  `git clone` + `./deploy.sh` works out of the box.

### Compose / env improvements

- `docker-compose.production.yaml` now passes `NEXT_PUBLIC_*` as build args.
- `.env.production` template gains `NEXT_PUBLIC_SELF_HOSTED` and
  `NEXT_PUBLIC_VERSION`.
- `.gitignore` updated: `.env.production` stays ignored (real secrets),
  `.env.production.example` is tracked.

---

## 1.0.0 — SaaS release

The app moves from open-source self-hosted to a managed SaaS product. Major
infrastructure, auth, storage, and onboarding work.

### Authentication & onboarding

- **Public registration** enabled — `/register` page with name, email,
  password + confirm password, and "Sign up with Google".
- **Google OAuth login** — full sign-in/sign-up flow via Google, dedicated
  callback at `/auth/oauth/google/callback`.
- **Login page** redesigned — "Sign in with Google", link to register,
  forgot-password link.
- **Email verification** optional (toggled by `REQUIRE_EMAIL_ACTIVATION`),
  disabled by default for instant access.
- **New 7-step onboarding flow**:
  1. Welcome (with mascot illustration)
  2-5. Feature intro slides (Write & Schedule, AI Agent Access, Team
     Collaboration, Analytics) — each with its own illustration
  6. "How did you find us?" source picker (Google, X, YouTube, Reddit,
     LinkedIn, ChatGPT/AI, etc.)
  7. Connect your first channel (real platform icons)
  - Skip option on every step, progress dots, Apple-style layout.
- Removed legacy bootstrap "/setup" forced redirect.

### Storage

- **MinIO** (self-hosted S3) provider added alongside local and Cloudflare R2.
- Files segregated by kind: `image/`, `video/`, `audio/`.
- **Upload security hardening**: magic-byte detection, polyglot/embedded-script
  scanning, SVG block, format allow-list, per-type size limits, sandboxed
  serving via nginx CSP headers.

### Email

- **Resend** wired up as the transactional email provider.
- **8 Apple-style HTML templates**: activate account, reset password, team
  invite, welcome, post published, post failed, account deleted, weekly digest.
- Logo + brand wordmark header, clean white card on grey, CTA buttons.

### Empty states

- New `<EmptyState>` component with branded illustration shown on Posts, Media,
  and Analytics when there's no data / no connected channel.

### Workflows (Temporal)

- **Media cleanup workflow** — auto-deletes media older than 90 days (skips
  scheduled posts, profile pictures), batched, runs every 24h.

### Polish & fixes

- All dates locale-locked to `en-US` (was leaking browser locale e.g. Polish).
- Dashboard set to `noindex, nofollow` (not for search engines).
- Favicon + apple-icon swapped to PostSider logo.
- Removed "v1.0.0" footer label from sidebar.
- Storage settings hidden in SaaS mode (infrastructure detail).
- Registration `instanceof` DTO bug fixed (NestJS validation transform).
- Rate limits relaxed for development.

## 0.1.0 — Initial dashboard

### Foundation

- Bootstrapped Next.js 15 + React 19 app at `apps/frontend/`, served on port
  `4200`.
- Strict black-and-white palette with Apple-inspired layout: rounded panels,
  pill controls, soft borders, subtle elevation.
- Workspace tokens in `globals.css` (`--bg`, `--fg`, `--line-soft`, `--ease`,
  radii) so future pages stay visually consistent.
- Dedup script (`scripts/dedupe-react.cjs`) wired into `predev` / `prebuild`
  to strip duplicate React copies left behind by pnpm's hoisted linker.

### Branding

- Brand mark `PostSider` rendered in `Changa One` (Google Font, served via
  `next/font/google`).
- Custom logo dropped into `public/brand/postsider-logo.png`.
- Generated `apps/frontend/src/app/icon.png` (32×31) and `apple-icon.png`
  (180×174) so Next.js auto-wires the favicon.
- Logo shown next to the brand name in the sidebar, with rounded corners.

### Sidebar / shell

- Two-column layout: collapsible sidebar + main content card.
- Sidebar can be toggled via chevron; collapsed state persisted in
  `localStorage`. Collapsed view shows only icons and the logo.
- Each nav item now has its own SVG icon (calendar, bar chart, image, document,
  cogwheel for Settings).
- Active item rendered as a black pill, matching the rest of the design.

### Calendar

- Four views: **Day**, **Week**, **Month**, **Year**, switched via segmented
  control in the header.
- Apple-style chevron + `Today` controls; the title and subtitle change shape
  per view (full date / range / month name / year).
- Channels panel on the left: avatars, platform badges, color dots as pure
  identifiers (no toggles), `Add Channel` and `Create Post` actions.
- Clicking a channel row opens the detail modal (ID, platform, audience,
  colour palette, **Reconnect**, **Delete**).
- **Add Channel** modal lists all 41 providers wired up in
  `libraries/nestjs-libraries/src/integrations/social`, sorted by popularity
  (mainstream → niche). Tile-only layout (icon + name).
- Calendar events use white tiles with a left-side colour bar in the channel's
  colour, matching across Month / Week / Day / popup views.
- **Month view**: clicking a day opens the day popup with a live hour timeline,
  hover-to-add `+` button per hour, and the now-line on today.
- **Week / Day view**: same hover-to-add treatment per hour slot.
- **Year view**: 12-month grid with subtle event markers; clicking a month
  jumps to its Month view.

### Create Post composer

- Triggered from any hour slot or the panel button. Pre-fills date and time.
- Single body field "Write something…" with image / video upload and **Add
  comment / post** for thread parts.
- Channel strip at the top: large round avatars with platform badges; click to
  add or activate.
- Two writing modes:
  - **Global write** — same body to every selected channel.
  - **Per channel** — per-channel target tabs with their own bodies.
- Single live preview on the right that follows the active target (or the
  first selected channel in global mode), including media thumbnails and
  thread parts.

### Channels and avatars

- Real account avatars rendered via `<ChannelAvatar>` (image + initials
  fallback), reused across calendar, posts, media and analytics.
- Platform badges (small circular tag) in the lower-right of each avatar use
  official brand glyphs from `simple-icons` plus custom SVG fallbacks for
  marks not available in that library (LinkedIn, Slack, Skool, Whop, Google
  Business).
- 41 platform PNG icons under `public/platforms/`, mapped from
  `components/platform-icon.tsx`.

### Analytics

- Per-channel only — selecting a channel from the same Channels panel sets the
  view; multi-channel summaries are intentionally absent.
- KPI cards adapt to the platform vocabulary (Views vs Impressions vs Reach,
  Subscribers vs Followers vs Page likes), driven by `lib/platform-labels.ts`.
- Pure-SVG line chart with hover tooltip; secondary audience chart for
  followers / subscribers growth in the same time range.
- 7d / 30d / 90d range tabs.
- Top posts list reuses the channel avatar.

### Media library

- `/media` lists every uploaded asset with **Images** / **Videos** / **All**
  filter.
- Two layouts switchable from a pill toggle in the header: list rows or grid
  tiles (default Grid).
- Clicking any item opens a preview modal with the metadata table, channel
  badge and `Open` / `Download` placeholders.
- ESC and click-outside close the modal; body scroll is locked while open.

### Posts

- Tab-based status filter: All / Scheduled / Draft / Published / Failed, each
  with a live counter.
- Search box across title, excerpt, channel and platform.
- Sorting prioritises Failed → upcoming Scheduled → Drafts → most recent
  Published, so the action queue is on top.
- Each row shows status pill, title + excerpt, channel block, scheduled date
  with relative time ("In 3 days", "Yesterday"), and metrics for published
  posts only.

### Settings

Sub-shell with its own sidebar; sub-routes:

- **General** — workspace name, slug, timezone, language; default week start;
  toggles for auto-archive, **auto-delete old media (90 days)**, approval flow
  and failure email; Danger zone with workspace delete.
- **Users** — invite form (email + role), member list with roles, last active,
  and inline "Change role" / "Remove" actions; role table with descriptions.
- **Teams** — team groups with avatar stacks, channel counts and per-team
  actions.
- **Security** — **2FA marked optional**: TOTP and security key flows, recovery
  codes; workspace-wide policy (require 2FA, session lifetime); active
  sessions with revoke; sign-in history; password change.
- **Storage** — Local disk vs Cloudflare R2 picker (matching `.env`), usage
  bar, retention toggle, maintenance actions (recompute hashes, purge orphans).
- **Email** — Resend / SMTP / Listmonk / Disabled provider with provider-
  specific fields, send-test button, account behaviour toggles, recent
  deliveries list.
- **API** — tokens with scope chips, Copy / Revoke, quick-start curl snippet,
  limits.
- **Webhooks** — new-endpoint form with event checkboxes, endpoint list with
  Disable / Delete, signing secret block.
- **MCP** — Behaviour toggles (expose tools, log calls, require confirmation,
  read-only), CLI & AI Skills (Locally / CI tabs with copyable commands), MCP
  Client Configuration (Authentication tabs + client picker for Claude Code,
  Cursor, VS Code, Windsurf, Amp, Codex, Gemini CLI, Warp), server list with
  Start / Stop / Edit / Remove, raw JSON config.

## Decisions and trade-offs

- **No AI**: PostSider stays a publishing bridge; nothing in the UI generates
  content.
- **No billing UI**: open-source posture, self-hosted users don't need it.
- **Black-and-white only**: brand colours appear strictly inside platform
  avatars and platform tiles in the Add Channel modal so each social network
  remains recognisable.
- **No external chart libraries**: keeps the bundle small and the look
  consistent.
- **Local React copy on first install**: the `dedupe-react.cjs` script trims
  duplicate React installs created by pnpm's hoisted linker; without it the
  production build fails when `styled-jsx` and Next disagree on which React
  to use.
