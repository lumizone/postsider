# PostSider release acceptance — zero-publish procedure

This is the **production verification** checklist for [issue #41](https://github.com/lumizone/postsider/issues/41). Source merges, CI and the separate marketing Netlify deployment **do not** establish which version is running on the production VPS. Record the actual deploy time and commit without sharing passwords, cookies, customer records or API keys. Do not close #41 until the live and sandbox gates have evidence.

## 1. Before touching the VPS (safe from any machine)

Run the unauthenticated probe with Node 20+:

```bash
node scripts/check-public-release.mjs
```

It fetches only publicly available marketing, registration and MCP/REST surfaces; the unauthenticated MCP POST is intentionally denied and cannot execute a tool. It does **not** register an account, publish, schedule, charge, or mutate anything. The command fails on unexpected responses. Optional: set `POSTSIDER_SMOKE_READ_API_KEY` from a secure secret manager to exercise only `GET /public/v1/integrations` with a **read-only named key**; do not give this probe a write-enabled or customer credential.

Record each result. A public HTTP health check cannot validate a database migration, signed Polar webhook, or a real authenticated MCP client.

## 2. Controlled production deploy (VPS access required)

On the VPS, review the Git state and available backup storage, then pick a maintenance window:

```bash
git status --porcelain --untracked-files=no
git rev-parse HEAD
df -h /var/lib/postsider
```

Confirm the source tree is clean, the intended SHA matches the reviewed GitHub `main`, the environment is production, the Docker services are healthy, and a rollback image/backups are available. **Do not print** `.env.production` into logs or issues.

Only after checking these preconditions:

```bash
git pull --ff-only origin main
sudo ./deploy.sh
```

`deploy.sh` builds the production image, saves a predeployment Postgres dump, tags the previous image `:prev`, starts containers and waits for health; Prisma migrations are applied at boot. A failing backup aborts deploy. These steps have side effects and must be run by an authorized operator — do not treat this document as evidence they have run.

Check health and the migration **without querying customer data**:

```bash
docker inspect --format '{{.State.Health.Status}}' postsider-app
docker exec postsider-postgres psql -U postsider -d postsider_prod -Atqc "SELECT migration_name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS applied FROM \"_prisma_migrations\" WHERE migration_name = '20261103190000_funnel_attribution';"
docker exec postsider-postgres psql -U postsider -d postsider_prod -Atqc "SELECT to_regclass('public.\"FunnelAttribution\"') IS NOT NULL;"
```

Expected: app `healthy`, one applied migration row with `true`, table existence `true`. Adjust the Postgres user/database to your real configured values **without pasting credentials into tickets**. A new image alone does not prove the expected source SHA is serving production; record source revision, image ID, health and deploy timestamp together. If the migration or health checks fail, stop. Be careful about rolling back an image if its DB schema is now incompatible.

## 3. No-social-publication integration checks

- Use a disposable, isolated PostSider organization and a test channel. No real customer channels and no real scheduled publication.
- Verify read-only named API keys reject post creation with HTTP 403, while `channels:read` permits channel listing.
- Confirm hosted MCP OAuth authenticates and a read-only grant fails to write; a separate consented test write may create **one DRAFT** and read it back. Inspect the saved ID, content, channel and state.
- The opt-in write-capable `scripts/smoke-public-api.mjs` requires `--yes --channel <TEST_CHANNEL_ID>`; `--schedule` is deliberately rejected. It still uploads and edits **test data**, so run it only against a disposable test workspace. A cleanup failure is an explicit test failure.
- Verify that `GET /admin/acquisition?days=90` rejects non-superadmins. Do not copy any production attribution record into a public ticket.

## 4. Polar sandbox and consented funnel acceptance

Confirm the Polar webhook subscription includes `order.paid` and the webhook secret is configured. In **Polar sandbox**, use one new test organization and complete a genuine sandbox checkout. Validate signed delivery, organization/product mapping and exactly-once `subscription_started`. Failed payments, duplicates, zero-value events, trial activation and renewals must not create an additional first-paid milestone. The source-side `order.paid` tests are not a substitute for a real signed sandbox delivery.

For a consented test journey, verify `landing_view` → `signup_click` → `signup_completed` → `onboarding_type_selected` → hosted `mcp_connected` → `first_draft_created` → `subscription_started`. For a denied-consent test, verify **no optional attribution record** is created. Verify opt-out, owner-only `DELETE /analytics/funnel` and workspace deletion. Use only sanitized aggregate evidence.

## 5. Dependency audit (tracked separately by #34)

```bash
pnpm why zod
pnpm audit --prod --audit-level high
```

The previously documented Zod 3 advisory is **not resolved by passing build/tests**. Do not globally override transitive Zod 3 to Zod 4 without verifying compatibility with affected SDKs (notably Bluesky/AT Protocol). Keep #34 open until high/critical production dependencies have an accepted remediation and regression coverage.

## Release decision

Mark **PASS** only after the VPS deploy/migration check, authenticated OAuth test, isolated test DRAFT readback, actual Polar sandbox webhook, consent/attribution verification and security review are recorded. The public read-only probe is a preliminary diagnostic, not a substitute for these gates.
