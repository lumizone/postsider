# Dashboard analytics (consent-gated)

The dashboard (`apps/frontend`) measures a small signup-to-subscription funnel
with two sinks, both loaded only after the visitor accepts analytics cookies:

- self-hosted Umami (always, see `docs/MARKETING-ATTRIBUTION.md`);
- Google Analytics 4, **off unless the operator sets a measurement id**.

## Consent model

1. The marketing site cookie banner sets `ps_analytics_consent=1` on
   `.postsider.com`. The app reads that same cookie (`analyticsConsent()`).
2. Without the cookie nothing is loaded and no event is queued.
3. With it, and only if `NEXT_PUBLIC_GA_MEASUREMENT_ID` is a valid `G-XXXXXXXX`
   id, the app sets Consent Mode defaults to denied, loads
   `https://www.googletagmanager.com/gtag/js?id=<id>` once, grants only
   `analytics_storage` (`ad_storage`, `ad_user_data`, `ad_personalization`
   stay denied, Google signals and ad personalization are disabled) and
   configures GA with `send_page_view: false`.
4. The GA cookie domain is `.postsider.com` on postsider hosts (shared with the
   marketing site), `auto` anywhere else.
5. No email, user id or org id is ever sent. Page views carry the path only,
   never the query string (invite tokens and OAuth codes live there).

## Environment variable

`NEXT_PUBLIC_GA_MEASUREMENT_ID` is inlined into the client bundle at **build
time** (Dockerfile build arg, passed by `docker-compose.production.yaml`, read
from `.env.production` by `deploy.sh`). Changing it requires `./deploy.sh`
with a rebuild, not just a restart.

- Self-hosted / forks: leave it empty. The feature is then completely off.
- Managed hosting (`app.postsider.com`): the server's `.env.production` must set
  `NEXT_PUBLIC_GA_MEASUREMENT_ID="G-72MBFGEQRR"`. The id is deliberately not in
  the repository so forks never report into our property.

## Events

| When | Our milestone | GA4 event | Params |
|---|---|---|---|
| Every App Router route change | n/a | `page_view` | `page_location` (origin + path), `page_path`, `page_title` |
| Account created (server-confirmed) | `signup_completed` | `sign_up` (recommended event) | none (method is not known without new data) |
| Onboarding type chosen | `onboarding_type_selected` | `onboarding_type_selected` | `onboarding_type` (`agents` or `scheduler`) |
| First MCP connection (server-confirmed) | `mcp_connected` | `mcp_connected` | none |
| First draft created (server-confirmed) | `first_draft_created` | `first_draft_created` | none |
| Paid order confirmed by Polar | `subscription_started` | `subscription_started` | none |
| Successful sign-in (password, Google, after MFA) | n/a | `login` (recommended event) | `method`: `email` or `google` |

Notes:

- Each milestone is sent to GA4 at most once per browser (marker
  `ps-funnel-sent-v1:<journey>:<stage>:ga` in localStorage, independent from the
  Umami marker so a blocked Umami neither loses nor duplicates GA events).
- `subscription_started` is intentionally **not** sent as GA4 `purchase`: there
  is no transaction id or value, and it would pollute revenue reports.
- `login` fires once per sign-in, never on session restore. A sessionStorage
  guard is cleared on logout. A brand new Google account is reported as
  `sign_up`, not `login`.

## GA4 admin steps (owner)

1. Admin > Events (or Key events): mark `sign_up`, `generate_lead` (marketing
   site) and `subscription_started` as key events.
2. Add a hostname filter / comparison so reports can separate
   `postsider.com` from `app.postsider.com` (same property, shared cookie).
3. Optional: register `onboarding_type` and `method` as custom dimensions.

## Content-Security-Policy

The Next frontend sets no page CSP (only `frame-ancestors 'none'` on `/oauth/*`),
and nginx's restrictive CSP only covers `/uploads`. The backend CSP applies to
API responses, not to the HTML app, so no `googletagmanager.com` /
`google-analytics.com` allowance was added. If you add a page-level CSP, allow
`https://www.googletagmanager.com` in `script-src` and
`https://*.google-analytics.com https://*.analytics.google.com
https://www.googletagmanager.com` in `connect-src` and `img-src`, only when the
variable is set.

## Tests

`apps/frontend/src/lib/ga4.spec.ts` (run: `pnpm exec jest apps/frontend/src/lib/ga4.spec.ts --coverage=false`).
