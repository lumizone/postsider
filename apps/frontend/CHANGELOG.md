# Frontend changelog

All notable changes to the PostSider dashboard.

## Unreleased

### Dark theme

- **The dashboard has a dark theme, with a light / dark / system preference.**
  The choice is stored per browser (`postsider:theme`), the same way the
  language switcher already works. A sun/moon toggle sits beside the language
  select in the sidebar footer and in the mobile topbar; the three-way choice,
  including "follow the system", lives in Settings → General.
- "System" keeps following the operating system while it is selected, so a
  machine that switches to dark at sunset switches the app with it.
- **No flash of the wrong theme.** An inline script stamps the resolved theme
  on `<html>` before the first paint, so a dark-mode user never sees a white
  frame — verified for stored and system preferences in both directions.
- Colours run through one token layer: a single tint channel drives every
  translucent overlay, shadows stay black but scale on dark, and status inks
  (danger / warning / success) are lifted so they stay legible on a dark
  ground. A contrast sweep over every route found no failure that dark
  introduces.
- Hover states no longer rely on a shadow alone. The design lifted cards with a
  soft black shadow, which does not exist on a dark background — and several of
  those rules also dropped the border, so hovering made an element *less*
  defined. Hovered surfaces now gain a hairline in dark mode.

### Fixes

- **Confirmation dialogs were unclickable from the sidebar.** The dashboard
  sidebar is `position: sticky`, which always opens a stacking context, so a
  dialog rendered inside it had its z-index scoped to the sidebar and the page
  content painted over it — clearing notifications did nothing at all, in
  either theme. Dialogs now render through a portal on `<body>`, which repairs
  every confirmation in the app.
- **The Overview page could white-screen** on a report payload without a
  `customer` field: the optional chain covered only the outer object. The
  summary and channel list are guarded the same way.
- **The UTM builder could white-screen** on a payload that was not an array.
- **Storage settings overflowed 10 px** on a 390 px screen; the stats row now
  wraps.
- **The theme toggle in the mobile topbar is the same 44 x 44 box as the
  notifications bell beside it.** It was a shorter pill, which read as a
  mistake next to the bell. The sidebar-footer copy still matches the language
  select it sits with.
- Channel colours, colour swatches and platform tiles carry a hairline, so the
  dark end of the palette (and a near-black brand tile) stays visible on either
  surface.
- **Closing an untouched post asked "discard your changes?" every time.** The
  composer seeds provider defaults (Instagram `post_type`, TikTok
  `privacy_level`) one tick after mount, and the clean-state snapshot was taken
  before that, so the guard fired on a post nobody had edited — and dismissing
  it left the editor stuck open over the page. Machine-seeded defaults now fold
  into the baseline; a real edit still warns.
- **The API request generator pushed `/settings/api` 83 px off a 390 px
  screen.** Its single-column mobile rule used a bare `1fr`, which keeps its
  content's min-content width as a floor; the field/select row now stacks on a
  phone.
- Media and Posts de-duplicate by id. Both stitch a list from offset-paged
  requests, so an upload or a publish between two pages could return the same
  row twice and duplicate React keys re-mounted tiles at random.
- API keys, webhooks, approvals, hashtag groups and caption templates all check
  that the payload is an array before rendering it, the same guard the Overview
  and UTM builder pages already carry.

### Branding

- **The brand lockup always shows the PostSider mark.** An organisation's own
  logo used to replace it in the corner beside the "PostSider" wordmark; the
  organisation's identity belongs to the switcher at the bottom of the sidebar,
  and that is where it stays.
- Logos are deliberately theme-independent: the PostSider mark and a customer's
  uploaded logo render identically in light and dark, with no inversion,
  swapped asset or backing plate.
- `postsider-logo.png` was resampled from 1.26 MB to 142 KB — it is never drawn
  larger than 36 px, and the difference at that size is imperceptible.

### Calendar

- **Month view scales to the viewport height on desktop.** The calendar shell
  and month grid use a bounded flex layout, so its six week rows share the
  available height instead of forcing a 140 px minimum per day.
- Day cells compact smoothly down to a usable 42 px minimum. At shorter desktop
  heights the calendar panel scrolls rather than clipping controls; mobile keeps
  its natural page scroll and 52 px touch targets without horizontal overflow.
- The bounded-height behavior is scoped to `/calendar`; all other dashboard
  pages retain their existing layout and scrolling.
- **Posts scheduled for the same hour stack instead of shrinking.** Side-by-side
  lanes are kept only while a card stays at least 132 px wide; below that the
  hour's posts sit one under another at full width and that hour's row grows to
  hold them, on a phone as well as in a desktop week column. Two 10:00 posts on
  a 390 px screen used to be two unreadable slivers.
- **A collision at one hour no longer shrinks the whole day.** Lane count is
  computed per group of overlapping posts, so a lone post at 20:00 keeps the
  full column even when 10:00 has two.
- **Four posts in one hour could vanish from the day popup.** Its lane width was
  a percentage of the full timeline minus a fixed 72 px gutter, which turns
  negative at four lanes; cards are now positioned inside their own layer, so
  the gutter is subtracted once, by the layout.
- Week columns too narrow for copy (a phone's seven columns) show the platform
  icon alone, with the time, channel and title in the tooltip, instead of a
  clipped "1…".
- **Posts with media show a thumbnail on the calendar itself** — in the week and
  day timeline, in the day popup, and in a month cell once the cell is wide
  enough to carry one without eating the title (measured, so a collapsed
  channels panel earns it). Until now the thumbnail existed only in the Posts
  list.

## 1.1.0 — Production deployment readiness

Docker image, deployment tooling, and runtime fixes that make PostSider
deployable on a VPS with Docker and docker-compose.

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

### Deployment tooling

- **`docker-compose.production.yaml`** — full production stack (app, Postgres,
  Redis, MinIO, Temporal, Elasticsearch) runnable with a single command.
- **`.env.production.example`** — tracked template (no secrets) so a fresh
  `git clone` can be brought up with docker-compose.

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
