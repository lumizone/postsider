# Zapier

Status: **nothing here is published and none of it is verified against Zapier's tooling.** The repository contains a starting scaffold at `examples/automation/zapier/` (Zapier CLI app definition, plus a pure mapping module with `node --test` specs). `zapier-platform-core` is declared in `package.json` but not installed here, and `zapier validate`, `zapier test`, `zapier push` and any submission to the Zapier directory have not been run. They are owner actions.

## What the scaffold gives you

- Custom authentication with one `apiKey` field (sent as the `Authorization` header, the same shape as the n8n credential) and a `baseUrl` field that defaults to `https://api.postsider.com`. The connection test is `GET /public/v1/is-connected`.
- Two REST hook triggers:
  - **Approval Requested** subscribes to `approval.requested`.
  - **Approval Decided** subscribes to `approval.resolved`, which is emitted once when an approval becomes final (approved after its last stage, or rejected at any stage).
  Subscribe calls `POST /public/v1/webhook-subscriptions` with the Zapier target URL and stores the subscription `id`; unsubscribe calls `DELETE /public/v1/webhook-subscriptions/{id}`. Sample data comes from `GET /public/v1/approvals` (`status=PENDING`, or `APPROVED` and `REJECTED`), limit 3.
- Three actions: **Request Approval**, **Approve or Reject**, **Create Draft Post**.
- `lib/map.js` flattens the webhook envelope into Zapier friendly keys: `event, eventId, approvalId, postId, status, note, stagePosition, stageTotal, decidedByType` (stage fields are `null` when the payload has no `approval.stage`). It also has `verifySignature` and `idempotencyKey`.

## Scopes

| Step | API key scopes |
|---|---|
| Triggers | `webhooks:write`, `approvals:read` |
| Request Approval | `approvals:write` |
| Approve or Reject | `approvals:decide` (explicit grant only, never part of a default key) |
| Create Draft | `posts:write` |

Approving also schedules the post, so the key needs the schedule action on the post's channel if the key has channel limits. A key cannot decide an approval for a post it created or requested.

## Things to know before you push

- Polling is not used for triggers; they are REST hooks. If Zapier cannot reach PostSider's outbound delivery (the target must be a public HTTPS URL), the hook never fires.
- The scaffold does not verify webhook signatures inside Zapier. Deliveries carry `X-Postsider-Signature` (`sha256=` HMAC-SHA256 over `<timestamp>.<raw body>`), `X-Postsider-Timestamp`, `X-Postsider-Event` and `X-Postsider-Event-Id`. If you add a verification step, use `verifySignature` and reject a timestamp more than 300 seconds from now.
- Zapier deduplicates trigger items by `id`; the mapping sets `id` to the envelope id (`X-Postsider-Event-Id`).
- The Approve and Reject action sends an `Idempotency-Key` built from the Zap id and a hash of the input. A decision that conflicts with an already resolved approval is a 409 `approval_already_resolved`.
- The scaffold was written from the repository's API contract, not by running it. Expect to adjust field definitions after `zapier validate`.

## Owner actions (not done)

1. `cd examples/automation/zapier && npm install && npm test`
2. `npx zapier validate`
3. `npx zapier push` to a private integration, then test each trigger and action with a real key.
4. Submitting the app to the Zapier directory, if wanted.
