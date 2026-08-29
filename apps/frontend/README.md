# PostSider Frontend

Next.js 15 dashboard for the PostSider publishing bridge. Strict black-and-white
UI, Apple-inspired layout, no AI generation — this app is a clean view layer
on top of the NestJS backend.

## Stack

- Next.js 15 (App Router)
- React 19
- CSS Modules
- `next/font/google` for `Inter` and `Changa One`
- `simple-icons` for select platform marks; bespoke PNGs in `public/platforms/`

## Theming

The UI is black-and-white in both directions: one light theme and one dark
theme, chosen per browser (`postsider:theme`) as light, dark, or system.
`lib/theme.tsx` owns the preference and exports the inline script that stamps
`data-theme` on `<html>` before the first paint — without it a dark-mode user
gets a white flash on every full page load.

New styles must go through the tokens in `app/globals.css`:

| Token | Use |
| --- | --- |
| `--page` | the page ground — only `<body>` paints it |
| `--bg` | every panel, card, input and modal |
| `--tint` | the RGB channel of any translucent overlay: `rgb(var(--tint) / .06)` |
| `--shadow` / `--shadow-boost` | shadows stay black; dark scales their alpha |
| `--scrim` | modal backdrops |
| `--lift-ring` | hover elevation that survives a dark background |
| `--on-fg` / `--on-fg-rgb` | content sitting on a `--fg`-filled surface |
| `--danger` / `--warning` / `--success` / `--info` | status inks, lifted in dark |

Two rules worth knowing:

- **Never write a literal `rgba(0, 0, 0, α)`.** Use `rgb(var(--tint) / α)` so
  the same alpha carries the same weight in both themes.
- **Overlays must be portalled to `<body>`.** The sidebar is `position: sticky`,
  which always opens a stacking context, so a fixed overlay rendered inside it
  is trapped beneath the main column no matter how high its z-index.

Logos are deliberately theme-independent — the PostSider mark and a customer's
uploaded logo render identically in both themes.

## Layout

```
src/
  app/
    calendar/        # main schedule with month / week / day / year views
    analytics/       # per-channel insights with platform-aware labels
    media/           # image + video library with list / grid + preview modal
    posts/           # all posts across statuses with filter and search
    settings/
      general/       # workspace, defaults, behaviour toggles
      users/         # invitations, roles, members
      teams/         # team groups and channel access
      security/      # 2FA (optional), sessions, login history
      storage/       # local / Cloudflare R2 + retention + maintenance
      email/         # Resend / SMTP / Listmonk + delivery log
      api/           # tokens, quick start, limits
      webhooks/      # endpoints, events, signing secret
    icon.png         # 32×31 favicon (auto-wired by Next.js)
    apple-icon.png   # 180×174 apple-touch-icon
  components/
    dashboard-shell.tsx       # collapsible sidebar (icons + brand mark)
    channels-panel.tsx        # left rail with channel list + colour dots
    channel-avatar.tsx        # avatar with optional platform badge
    channel-detail-modal.tsx  # ID / colour / reconnect / delete
    add-channel-modal.tsx     # platform picker (40+ providers)
    platform-icon.tsx         # PNG/SVG glyphs + brand colours
    create-post-modal.tsx     # composer (single / multi channel, media, threads)
    day-popup.tsx             # per-day timeline popup from month view
    calendar.tsx              # the four calendar views
    analytics.tsx             # per-channel KPIs + audience chart
    media.tsx                 # library, list/grid, preview modal
    posts.tsx                 # filter tabs + search + status pills
    settings-shell.tsx        # secondary sidebar for /settings/*
    settings-ui.tsx           # shared cards/switches/etc.
    theme-toggle.tsx          # sun/moon switch (sidebar footer + mobile topbar)
    confirm-dialog.tsx        # shared confirmation modal (portalled to <body>)
  lib/
    theme.tsx                 # light/dark/system preference + no-flash init script
    calendar-data.ts          # demo channels + events (replace with API later)
    media-data.ts             # demo media items
    platform-labels.ts        # platform-specific KPI / unit labels
public/
  brand/postsider-logo.png    # logo used as favicon and sidebar mark
  platforms/*.png             # native platform icons
```

## Local setup

```sh
pnpm install
pnpm run dev:frontend
```

The dev server runs on `http://localhost:4200` and reads `BACKEND_URL` /
`NEXT_PUBLIC_BACKEND_URL` from `.env`.

If you ever see a runtime error like `Cannot find module './XXX.js'` after a
fresh `pnpm install`, clear the Next.js cache once:

```sh
rm -rf apps/frontend/.next
pnpm run dev:frontend
```

A small `predev` / `prebuild` script (`apps/frontend/scripts/dedupe-react.cjs`)
removes duplicate React copies that pnpm's hoisted node-linker would otherwise
leave behind in this monorepo.

## Wiring to the backend

The data modules used by the dashboard mirror the shapes returned by the
matching backend routes:

| Frontend module        | Backend route(s) (NestJS)                    |
| ---------------------- | --------------------------------------------- |
| `calendar-data.ts`     | `posts.controller.ts`, `integrations.controller.ts`, `analytics.controller.ts` |
| `media-data.ts`        | `media.controller.ts`                         |
| Add Channel modal      | `oauth.controller.ts`, `oauth-app.controller.ts` |
| Settings → API         | Generate organization API keys for REST API and MCP |
| Settings → API/Webhooks| (existing token + webhook endpoints)          |

## Conventions

- Black-and-white only. Brand colours appear strictly inside platform avatars
  and platform icons in the Add Channel modal.
- Colours come from the tokens in `app/globals.css` (see Theming). A literal
  `rgba(0, 0, 0, α)` is always a bug — it does not follow the theme.
- No external chart library. The line charts on `/analytics` are pure SVG.
- `public/platforms/*.png` are the source of truth for channel icons; drop a
  new file there and add it to the map in `components/platform-icon.tsx`.
- Every list / grid / card uses CSS Modules, never inline class strings.
