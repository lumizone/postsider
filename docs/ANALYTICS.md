# Dashboard analytics (Consent Mode v2)

The dashboard (`apps/frontend`) reports to two sinks:

- self-hosted Umami (cookieless, see `docs/MARKETING-ATTRIBUTION.md`);
- Google Analytics 4 and Google Ads, in **Consent Mode v2 advanced mode**.

Nothing is reported from forks or self-hosted instances unless the operator sets
build-time ids (see Hosted defaults).

## Consent model

1. **In-app banner** (`analytics-consent-banner.tsx`, rendered in the root layout,
   so it also shows on login and register). Shown on `*.postsider.com` and
   `localhost` while `ps_analytics_consent` is neither `1` nor `0`. Buttons:
   Accept / Reject, plus a link to https://postsider.com/privacy/.
2. Accept writes `ps_analytics_consent=1` and `ps_marketing_consent=1`; Reject
   writes both `0`. Attributes: `Path=/; Max-Age=31536000; SameSite=Lax`,
   `Secure` on https, `Domain=.postsider.com` on postsider hosts (shared with the
   marketing site banner, which sets the same cookies).
3. After a choice the page dispatches `ps:consent`; the bridge then calls
   `updateGaConsent()`, `ensureFunnelAnalytics()` and, when consented and signed
   in, `syncFunnelMilestones()`.

What runs without consent:

- Umami (no cookies, query strings and hashes stripped by `psUmamiBeforeSend`).
- gtag.js is loaded for everyone with Consent Mode defaults **denied**
  (`analytics_storage` granted only with `ps_analytics_consent=1`; `ad_storage`,
  `ad_user_data`, `ad_personalization` granted only with `ps_marketing_consent=1`;
  `wait_for_update: 500`). Google may receive cookieless pings; no Google cookies
  are set until the visitor accepts.
- Page views, `sign_up` and `login`.

What needs consent (`ps_analytics_consent=1`): the funnel journey cookie
(`ps_journey_id`), the `/analytics/funnel` sync and the server-side signup record
(`FunnelAttributionService.recordSignupCreated`), and the milestone events.

No email, user id or org id is ever sent. Page views carry the path only, never
the query string (invite tokens and OAuth codes live there).

## Hosted defaults (fork-safe)

Ids resolve at runtime from the build-time env value, otherwise from a default
that applies **only when `window.location.hostname === 'app.postsider.com'`**:

| Value | Env (build time) | Hosted default |
|---|---|---|
| GA4 measurement id (`G-XXXXXXXX`) | `NEXT_PUBLIC_GA_MEASUREMENT_ID` | `G-72MBFGEQRR` |
| Google Ads id (`AW-` + 6-14 digits) | `NEXT_PUBLIC_GOOGLE_ADS_ID` | `AW-18533590201` |

Umami loads only on `app.postsider.com` and other `*.postsider.com` hosts, so
forks never report into our instance. The env vars are inlined at **build time**
(Dockerfile build args, passed by `docker-compose.production.yaml`); changing
them needs `./deploy.sh` with a rebuild. Forks leave them empty: everything is
off. A fork that wants its own property sets its own ids.

## Events

| When | Name | Sink | Params | Consent |
|---|---|---|---|---|
| Every App Router route change | `page_view` | GA4, Umami (auto) | path only | none |
| Registration succeeded (email or Google) | `sign_up` | GA4 + Umami | `method`: `email` or `google` | none; once per tab |
| Successful sign-in (password, Google, after MFA) | `login` | GA4 + Umami | `method` | none; once per sign-in |
| Account created (server-confirmed) | `signup_confirmed` (milestone `signup_completed`) | GA4 + Umami (`signup_completed`) | none | analytics consent |
| Onboarding type chosen | `onboarding_type_selected` | GA4 + Umami | `onboarding_type` | analytics consent |
| First MCP connection (server-confirmed) | `mcp_connected` | GA4 + Umami | none | analytics consent |
| First draft created (server-confirmed) | `first_draft_created` | GA4 + Umami | none | analytics consent |
| Paid order confirmed by Polar | `subscription_started` | GA4 + Umami | none | analytics consent |

Notes:

- `sign_up` is the visitor-side event and the one to import into Google Ads. The
  server-confirmed milestone is deliberately named `signup_confirmed` in GA4 so
  the two never double count.
- Milestones are sent at most once per browser (marker
  `ps-funnel-sent-v1:<journey>:<stage>:ga` in localStorage, independent from the
  Umami marker).
- `subscription_started` is intentionally **not** sent as GA4 `purchase`: there is
  no transaction id or value.
- `login` never fires on session restore; the sessionStorage guard is cleared on
  logout.
- Anonymous Umami events use `umamiEvent(name, data)`, queued (max 20) until the
  script is ready.

## Owner steps (Google side)

1. GA4 Admin > Events > Key events: mark `sign_up` and `subscription_started`
   (and `generate_lead` from the marketing site) as key events.
2. Google Ads > Goals > Conversions > Import > Google Analytics 4 properties: import
   `sign_up` as a conversion (link the GA4 property to Ads first).
3. GA4 Admin > Product links: link Google Ads and Search Console to the property.
4. Add a hostname comparison so reports can separate `postsider.com` from
   `app.postsider.com` (same property, shared cookie domain).
5. Optional: register `onboarding_type` and `method` as custom dimensions.

## Content-Security-Policy

Checked: the Next frontend sets no page CSP (only `frame-ancestors 'none'` on
`/oauth/*`), nginx (`var/docker/nginx.conf`) applies a restrictive CSP only to
`/uploads/`, and the backend CSP (`apps/backend/src/main.ts`) covers API
responses, not the HTML app. So nothing blocks `googletagmanager.com`,
`google-analytics.com` or `analytics.darkdynasty.cloud`. If you add a page-level
CSP, allow `https://www.googletagmanager.com` and
`https://analytics.darkdynasty.cloud` in `script-src`, and
`https://*.google-analytics.com https://*.analytics.google.com
https://www.googletagmanager.com https://analytics.darkdynasty.cloud` in
`connect-src` and `img-src`.

## Tests

`apps/frontend/src/lib/ga4.spec.ts` and `analytics-consent.spec.ts`
(run: `pnpm exec jest apps/frontend/src/lib/ga4.spec.ts apps/frontend/src/lib/analytics-consent.spec.ts --coverage=false`).
