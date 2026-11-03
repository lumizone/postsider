# Marketing attribution: consent → account → first paid order

This is the Stage 5 source-to-purchase contract for PostSider. It extends the
existing self-hosted Umami analytics; it does **not** introduce another analytics
vendor or pretend a browser click is a completed signup or purchase.

## One funnel, two trusted data paths

| Event | Primary evidence | When it counts |
| --- | --- | --- |
| `landing_view` | Consented `postsider.com` Umami | Visitor sees a particular landing |
| `signup_click` | Consented `postsider.com` Umami | Click on a registration CTA |
| `signup_completed` | Backend auth + newly persisted organization | Local or OAuth registration actually committed |
| `onboarding_type_selected` | Authenticated backend + original anonymous journey cookie | Original signup chooses `agents` or `scheduler` |
| `mcp_connected` | Successful scoped OAuth Public API response | Hosted MCP client actually calls an allowed API route (not merely opens a setup page) |
| `first_draft_created` | Persisted backend `draft` with at least one saved post | First successful draft, not a failed POST |
| `subscription_started` | Signature-verified Polar `order.paid` with `paid=true` and positive amount | First real paid recurring order, not trial or checkout redirect |

**Important:** `mcp_connected` counts *scoped OAuth traffic* from the hosted
MCP path. Local stdio API-key clients are not currently distinguishable from
normal REST/SDK usage, so **do not** claim this metric includes all agent
connections. An authenticated old workspace does not become a new signup by
visiting the onboarding page.

## Consent, first touch and privacy

- Marketing site respects `window.psConsent.analytics`; app checks the
  `ps_analytics_consent=1` first-party cookie from the shared PostSider domain.
  Consent denied = no optional Umami tracking and no attribution row created.
- On first *consented* visit, store sanitized `landing_path`,
  `utm_source/medium/campaign/content/term`, referrer **hostname** and a random
  `ps_journey_id` UUID in first-party `.postsider.com` cookies (60 days).
  Do not store full external URLs, email, access tokens, API keys, post content
  or social profiles in marketing events.
- Backend persists first touch in `FunnelAttribution` by the authenticated
  organization ID and never overwrites it with a later member's campaign.
  Only a matching original anonymous journey can emit its onboarding choice
  or replay server-confirmed milestones into Umami.
- The attributed journey belongs to a **workspace**, not an individual
  identity. It may be missing when consent was denied, devices differ, the
  cookie expired or a visitor signed up directly. Treat missing source as
  `direct_or_unknown`; do not invent attribution.
- A visitor may withdraw browser consent in Cookie Settings; this clears
  optional cross-subdomain attribution cookies and suppresses further browser
  events. Previously persisted workspace attribution requires separate deletion
  by the workspace owner via `DELETE /analytics/funnel` or a support request.
  Until deletion, already recorded organization milestones remain; this
  consent-withdrawal behavior merits a dedicated privacy review before launch.
  The attribution row cascades away with organization deletion.

## Production dependencies

The billing integration already uses signed Polar Standard Webhooks with
delivery-ID idempotency. **Enable the `order.paid` event in the existing Polar
webhook configuration** and confirm that its `product_id` maps to one of the
configured `POLAR_PRODUCT_<TIER>_<PERIOD>` environment values. A
`subscription.active` event **cannot** prove payment, because trials also
become active. The first paid event is accepted only if the signature has been
verified upstream, `paid=true`, `subscription_id` exists, `total_amount > 0`,
currency is present, the product maps to a paid PostSider tier, and the
`customer.external_id` or approved metadata identifies the organization.
An absent opt-in attribution record is **never** created by a payment webhook.

If Polar is not configured to send `order.paid`, do not claim the paid
conversion funnel is complete. Subscription provisioning remains controlled by
the existing `subscription.*` handlers.

## Query the results

A platform superadmin can call the authenticated endpoint:

```text
GET /admin/acquisition?days=90
```

It returns `bySourceCampaign` (signup, agent/scheduler intent, hosted MCP
connection, first draft and first-paying-customer counts) plus
`paidJourneys` showing the **linked event timestamps**, original landing
path, campaign, plan and first payment amount in **minor currency units**.
Do not sum monetary amounts across currencies or confuse first payments with
lifetime revenue.

The customer-data API supports:

```text
GET    /analytics/funnel        # authenticated original consented journey only
POST   /analytics/funnel        # onboarding_type_selected only, validated
DELETE /analytics/funnel        # workspace owner only
```

Client-submitted `subscription_started`, `mcp_connected` or
`signup_completed` are rejected. The source-of-truth milestones come from
the appropriate backend service.

## Validation and release gate

The backend tests and migrations must pass. The landing counterpart is
`lumizone/postsider-landing-page`, Stage 5 PR #16; it uses the same Umami
website ID. Landing CI verifies Astro, SEO, canonical/internal links and
consent/UTM cookie behavior.

Before setting Stage 5 to Done, run an isolated **sandbox** journey:

1. Without Analytics consent, load a tracked landing and click signup.
   Verify no attribution cookie, Umami event or DB funnel row is created.
2. With Analytics consent, visit the same landing with a known UTM campaign;
   confirm the cookie survives the cross-subdomain registration redirect.
3. Register a genuinely new account (local and separately OAuth). Verify one
   `signup_completed` record; repeat login and onboarding without duplicates.
4. Choose agents, connect a **test** hosted MCP OAuth client and make a
   read-only request. Verify `mcp_connected` only after a successful response,
   and that a different team member's cookie does not duplicate conversion.
5. Create exactly **one draft** through an isolated test channel. Verify it is
   saved and read it back; do **not** publish to real social accounts.
6. Use a Polar **sandbox** payment and its signed `order.paid` callback.
   Check that the same org becomes the paying customer exactly once;
   decline/retry/zero-value/renewal events must not generate extra first pays.
7. Query `GET /admin/acquisition?days=90`, compare original landing,
   source and all milestone timestamps, then exercise the owner-only deletion.
8. Verify opt-out after a consented signup. Removing the historical stored
   attribution must prevent future server-side milestones from being linked.

No real customer's purchase, token or social post should appear in test logs.
These tasks are an acceptance checklist, **not** a claim that live checkout,
live OAuth clients or production deployment were exercised.

## SEO follow-up

GSC evidence (5 Aug–2 Nov 2026) favors improving existing pages instead of
producing competing articles: `/social-media-scheduler-api/` received 213
impressions / 1 click, the existing Buffer API migration article 107 / 1,
and the MCP overview has visibility for the canonical MCP query. Review
queries, indexing and CTR again **after deployment and at least one useful
Google Search Console reporting window**. Keep REST/SDK developer intent on
`/social-media-scheduler-api/` and agent/OAuth setup on
`/mcp-social-media-server/`, using the current `/developers/` as a hub.
