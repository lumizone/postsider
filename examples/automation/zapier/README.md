# PostSider Zapier app (starting scaffold)

Status: a scaffold, not a finished or published Zapier app. Nothing here was run through `zapier validate`, `zapier test` or `zapier push`, and `zapier-platform-core` is listed in `package.json` but not installed in this repository. Only the pure mapping module (`lib/map.js`) has tests (`npm test`, plain `node --test`). Validating, pushing and any Zapier submission are owner actions. See `docs/automation/zapier.md`.

## What it contains

| File | Purpose |
|---|---|
| `index.js` | App definition, base URL rewrite, Authorization header |
| `authentication.js` | Custom auth: `apiKey` and `baseUrl` (default `https://api.postsider.com`), test call `GET /public/v1/is-connected` |
| `triggers/approval_requested.js` | REST hook on `approval.requested` |
| `triggers/approval_decided.js` | REST hook on `approval.resolved` (final approval or rejection) |
| `creates/request_approval.js` | `POST /public/v1/posts/{id}/request-approval` |
| `creates/decide_approval.js` | `POST /public/v1/approvals/{id}/approve` or `/reject` with an `Idempotency-Key` |
| `creates/create_draft.js` | `POST /public/v1/posts` with `type: draft` |
| `lib/map.js` | Pure helpers: `mapEnvelope`, `verifySignature`, `idempotencyKey` |

## Scopes

| Step | Scopes the API key needs |
|---|---|
| Both triggers (subscribe, unsubscribe, sample data) | `webhooks:write`, `approvals:read` |
| Request Approval | `approvals:write` |
| Approve or Reject | `approvals:decide` (never granted by default) |
| Create Draft | `posts:write` |

## Behaviour to know

- The Authorization header carries the API key as is, the same as the n8n credential.
- A trigger subscription is created with the Zapier target URL and deleted on unsubscribe. The subscription secret is not used by this scaffold: delivered payloads are not signature checked inside Zapier. `verifySignature` in `lib/map.js` is provided for a catch step or a relay that has the raw body and headers.
- Approve and Reject send `Idempotency-Key: zapier:<zap id>:<hash of approval, decision, note, stage position, requestedAt>` after reading the approval, and send `expectStage`, so a Zap replay cannot decide twice and a stale run cannot decide a later stage (409). If the read fails a random key is used. The server refuses a decision on a post the same key created or requested, and a stage must allow automation.
- The `approval.resolved` event fires once, when the approval becomes final.

## Owner steps

```
cd examples/automation/zapier
npm install
npm test
npx zapier validate
npx zapier push
```
