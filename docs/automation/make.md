# Make

Status: **documentation only. Nothing here is published to Make and none of it was tested in a Make account.** There is no custom Make app. The recipes below use Make's generic HTTP module and Custom webhook against the PostSider public API, based on this repository's API contract.

Base URL: `https://api.postsider.com/public/v1` (replace for a self-hosted install). Every request needs the header `Authorization: <your API key>` with no `Bearer` prefix.

## Required scopes

| Recipe | Scopes |
|---|---|
| List approvals | `approvals:read` |
| Approve or reject | `approvals:decide` (explicit grant, never default) |
| Request approval | `approvals:write` |
| Create the webhook subscription | `webhooks:write` |

## Recipe 1: list pending approvals (HTTP, "Make a request")

- URL: `https://api.postsider.com/public/v1/approvals`
- Method: `GET`
- Query string: `status` = `PENDING`, `limit` = `25` (1 to 100). Optional `since` (ISO timestamp, filters `requestedAt >= since`) and `cursor` from the previous response's `nextCursor`.
- Headers: `Authorization` = your key.
- Parse response: yes.

Newest first. Each item has `id`, `postId`, `status`, `note`, `stage` (`position`, `total`, `name`, or `null`), `stages`, `channel`. Schedule this scenario and keep the last `id` you handled if you prefer polling to a webhook.

## Recipe 2: approve or reject (HTTP, "Make a request")

- URL: `https://api.postsider.com/public/v1/approvals/{{approvalId}}/approve` (or `/reject`)
- Method: `POST`
- Headers: `Authorization` = your key; `Content-Type` = `application/json`; `Idempotency-Key` = for example `make-{{scenario.id}}-{{approvalId}}-approve`. Use a key that is the same on a retry of the same decision and different for a different decision.
- Body type: raw, JSON: `{"note": "Looks good"}` (note optional, up to 500 characters).

Results: 200 with `changed: true` on a new decision; 200 with `changed: false` when the same decision was already recorded; 409 `approval_already_resolved` when it was decided the other way. Approving a non final stage keeps `status` `PENDING` and moves to the next stage. The server refuses a decision on a post the same key created or requested, and a flow stage must allow automation. Turn on "Evaluate all states as errors" so a 409 is visible.

## Recipe 3: request approval (HTTP)

- URL: `https://api.postsider.com/public/v1/posts/{{postId}}/request-approval`
- Method: `POST`, header `Authorization`, empty JSON body `{}`.

## Recipe 4: react to approvals with a Custom webhook

1. Add a **Custom webhook** module in a scenario and copy its URL. It must be public HTTPS.
2. Create a subscription with an HTTP module: `POST /public/v1/webhook-subscriptions`, JSON body `{"name": "Make", "url": "<the Make webhook URL>", "events": ["approval.requested", "approval.resolved"]}`. The response contains `id` and a `secret`; store the secret in a Make data store or connection, it is the signing secret for this subscription.
3. Run the webhook once ("Re-determine data structure") so Make learns the envelope: `{ id, event, createdAt, organizationId, data }`. `data` holds `approvalId`, `postId`, `status`, `note` and `approval.stage` (`position`, `total`, `name`) when the approval has stages.

`approval.resolved` is sent once, when the approval is final. Intermediate stage approvals do not send an event; poll `GET /approvals` to see stage progress.

### Verify the signature

Each delivery has these headers:

- `X-Postsider-Timestamp`: Unix seconds
- `X-Postsider-Signature`: `sha256=` followed by the hex HMAC-SHA256 of `<timestamp>.<raw body>` using the subscription secret
- `X-Postsider-Event` and `X-Postsider-Event-Id`

In Make, enable the webhook's "Get request headers" option, then compare with a filter. Make's `sha256(text; encoding; key)` function computes an HMAC when a key is given, so the expected value is:

```
sha256({{timestamp}}.{{rawBody}}; hex; {{secret}})
```

prefixed with `sha256=`. Two cautions, both untested here: the HMAC must be over the exact raw bytes PostSider sent, and Make may re-serialize a parsed JSON body, so confirm in your scenario that the value you hash is the raw text. Also reject the request when the timestamp differs from the current time by more than 300 seconds. If you cannot get the raw body in Make, do the verification in a small relay you control, or rely on the unguessable webhook URL and the dedupe step below, accepting the weaker guarantee. A reference implementation is `verifySignature` in `examples/automation/zapier/lib/map.js`.

### Dedupe

Deliveries are at least once. Use `X-Postsider-Event-Id` (the same value as the envelope `id`) as a key in a Make data store and stop the scenario if it was already seen.

### Response time and retries

Respond with a 2xx quickly. PostSider gives each delivery attempt 10 seconds (from `public-webhook-delivery.service.ts`) and treats a timeout, a network error, a 5xx or a 429 as retryable. Any other 4xx fails the delivery permanently with no retry. Retry schedule after a failed attempt: 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours, 12 hours; there are at most 7 attempts in total. After 10 consecutive failed deliveries the subscription is switched off. Do slow work after you have acknowledged the webhook (Make's webhook responds immediately by default; add a "Webhook response" module early if you changed that).

## Not covered

No Make app is published or verified, and nothing was submitted to Make. Slack notifications do not need Make: register a Slack incoming webhook URL as a subscription instead.
