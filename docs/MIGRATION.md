# Migration Guide

This guide covers breaking and notable changes introduced by the PostSider
rebrand and the AI Agent Bridge. It is the single reference for operators
upgrading an existing deployment (Requirement 22.1).

## Principles

- **No same-release env renames required.** When an environment variable is
  renamed, the application reads the new (canonical) name first and falls back
  to the legacy name, emitting a one-time deprecation warning (dual-read). You
  can upgrade first and rename env later (Requirement 22.2).
- **Additive database changes.** Schema changes for the Agent Bridge only add
  new tables/columns. No existing data is renamed or dropped (Requirement 8.4).

## Environment variables

### Dual-read fallback

The helper `readEnv(canonical, legacy?)`
(`libraries/helpers/src/configuration/env.compat.ts`) implements the dual-read
behaviour:

1. Use the canonical name if set.
2. Otherwise use the legacy name and emit a deprecation warning **once per
   process** (Requirement 22.3). The warning is also sent to the observability
   system as a breadcrumb.

When both names are set, the canonical value always wins.

### Renamed / removed variables

| Old name | New name | Status | Removal target |
|----------|----------|--------|----------------|
| `NX_ADD_PLUGINS` | — | Removed (Nx leftover, unused) | Already removed from `.env.example`, `.env.production`, `docker-compose.yaml` |

> No `GITROOM_*` or `POSTIZ_*` prefixed variables exist in this codebase; the
> dual-read helper is provided to guarantee a safe path for any future rename.

## Agent tokens (Agent Bridge)

The Agent Bridge introduces scoped agent tokens (prefix `agt_`) alongside the
existing organization API keys and OAuth (`pos_`) tokens. Existing API keys and
OAuth tokens continue to work unchanged (Requirement 17.4). Agent tokens are
opt-in and managed per organization.

## Encryption (recommendation)

Provider credentials are encrypted at rest. Two schemes are supported:

- **Legacy (default):** AES-256-CBC with a key derived from `JWT_SECRET` and a
  deterministic IV. Used when `ENCRYPTION_KEY` is unset.
- **Preferred:** AES-256-GCM (authenticated, random per-record IV) when
  `ENCRYPTION_KEY` is set. New reversible secrets are written with a `v2:`
  prefix; existing CBC ciphertext is still read transparently.

To migrate: set `ENCRYPTION_KEY` (e.g. `openssl rand -base64 32`) and redeploy.
No data migration is required — secrets are re-encrypted to GCM the next time
they are written (e.g. when a connector is re-authorized or credentials are
updated). Deterministic lookup values (OAuth tokens/codes, org API keys) remain
on the legacy CBC scheme by design and are unaffected.

## Rebrand verification

CI runs `node scripts/rebrand-check.mjs` (job `rebrand-gate`) to ensure no
legacy identifiers (`gitroom`, `gitroomhq`, `postiz`) are reintroduced outside
the files listed in `.rebrand-allowlist`.
