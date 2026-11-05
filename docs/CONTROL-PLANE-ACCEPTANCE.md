# Control plane acceptance (phases 1 to 5 and the P5 review fixes)

Complements `RELEASE-VERIFICATION.md` (VPS deploy, zero-publish checks, Polar sandbox). Unit and integration tests are green; this list covers what they cannot: a real backend with Temporal and Redis, real OAuth channels, and a running dashboard. Use a **disposable organization and a test channel**. Record evidence (commit SHA, image ID, timestamps), never credentials or customer data.

## 0. Deploy order and data changes

1. Back up Postgres (`deploy.sh` does it and aborts on failure).
2. `prisma migrate deploy`. Migrations that change data or behavior:
   - `20261105100000_control_plane_approvals_distribution` nulls plaintext `guestToken` (old guest links stop working, new ones are hashed).
   - `20261105120000_customer_live_name_unique` soft-deletes duplicate live customers (same org and name), keeps the oldest and moves its channels. Before deploying, preview the effect:
     `SELECT "orgId", name, count(*) FROM "Customer" WHERE "deletedAt" IS NULL GROUP BY 1,2 HAVING count(*) > 1;`
   - `20261105130000_drop_redundant_stage_index` is harmless.
3. Deploy backend, orchestrator (new crons: webhook delivery, retention incl. approval tokens), then frontend. If the backend must ship before the frontend, set `GUEST_REVIEW_REQUIRE_IDENTITY=false` temporarily.
4. Optional flags: `APPROVAL_EMAIL_LINKS=true`, `POSTSIDER_MCP_ALLOW_APPROVAL_DECISIONS=true` (stdio only). Both default off.

## 1. Reliable publishing (P1), needs Temporal and Redis

- [ ] Schedule one post to a **test channel** 2 minutes ahead. Expect PUBLISHED with a link, exactly once (check the channel for duplicates).
- [ ] Force a provider error (revoked token on the test channel). Expect an error category on the post, no duplicate publish, and `retry-failed` works after reconnecting.
- [ ] Restart the orchestrator while a post is queued. Expect no double publish after restart.
- [ ] Webhook outbox: register a webhook to a request catcher, create a post, expect a delivered event in the log; replay one event; confirm a failing endpoint retries and then shows as failed.

## 2. Identity and audit (P2)

- [ ] Create a post with an API key; `GET /public/v1/audit-events` (key with `audit:read`) shows the verified actor. A key without the scope gets 403.
- [ ] `postsider_get_post_activity` returns the same trail.

## 3. Policy engine (P3 and P4 UI)

- [ ] Rule REQUIRE_APPROVAL on the test channel: API create goes to approval instead of scheduling. BLOCK rule: 4xx with the policy code.
- [ ] `POST /public/v1/policies/evaluate` dry run matches the real outcome.
- [ ] Publish-time guard: add a BLOCK rule after a post is already queued; it must be withheld, not published.
- [ ] Key limits: a key limited to DRAFT cannot schedule (403 `key_action_not_allowed`).
- [ ] Dashboard: Settings > Policies (create, edit, delete a rule, role gating), composer notice, calendar drag blocked by a USER rule.

## 4. Agent Control Center (`/agents`)

- [ ] Summary and inbox load; open the drawer; approve, reject, bulk approve, retry a failed post.
- [ ] `unknown_outcome` retry asks for explicit confirmation.

## 5. Approvals (P5 and fixes in this PR)

- [ ] Two-stage flow: stage 1 approval keeps the post PENDING, only the last stage makes it APPROVED.
- [ ] Self-approval: the requester is blocked when prevent-self-approval is on. If the requester is the only approver with `APPROVAL_EMAIL_LINKS=true`, the plain notify email still reaches an admin (fix 1).
- [ ] Re-request a rejected approval under a flow: stages are recreated; kill the backend mid-request and confirm no stuck PENDING without stages (fix 2).
- [ ] Key with `approvals:decide` limited to DRAFT: reject works, approve returns 403 (fix 3).
- [ ] `PUT /integrations/:id/customer` with `{"name":"Acme","customerId":null}` returns 400; `{"customerId":null}` alone unassigns (fix 4).
- [ ] Create the same customer name twice in parallel: one customer, no duplicates; the 200 cap holds (fix 5).
- [ ] Email links (flag on): single-use, two step, expired link refused. Guest link works once identity is required.
- [ ] Slack webhook notification arrives (notify only).
- [ ] Zapier `decide_approval`: forced `self_approval_blocked` shows the API's message, not the generic scope hint (fix 6).
- [ ] After 7 days plus one retention run, used and expired `ApprovalActionToken` rows are gone (fix 7).

## 6. MCP

- [ ] Hosted MCP lists 40 tools; stdio lists 41, 42 with the approval opt-in.
- [ ] Read-only grant cannot write; one DRAFT write reads back (see RELEASE-VERIFICATION section 3).
- [ ] Settings > MCP shows "40 tools".

## 7. Release gates still outside this list

- [ ] Real OAuth publish on each channel the release advertises (one test post per provider).
- [ ] Polar sandbox signed webhook (RELEASE-VERIFICATION section 4).
- [ ] Dependency audit: zod 3 remains via `@atproto/api` (tracked in #34). Accept or remediate before calling the audit gate green.
- [ ] Publish `@postsider/mcp` 1.2.0 (tag triggers `release-mcp.yml`) and n8n 0.2.0 only after the above.

## Rollback

Image tag `:prev` plus the predeployment dump. Do not roll the image back after migrations without checking schema compatibility; the customer unique index and the dropped stage index are additive or harmless, the `guestToken` nulling is not reversible (affected guest links must be reissued).
