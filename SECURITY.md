# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**. Do not open a public
GitHub issue for security problems.

Email **lukasz@postsider.com** with:

- a description of the issue and its impact,
- steps to reproduce (proof of concept if possible),
- affected version / commit.

You will get an acknowledgement within 72 hours and a remediation plan once the
report is triaged. Please give us a reasonable window to ship a fix before any
public disclosure. We are happy to credit reporters who want it.

## Supported versions

Security fixes target the latest `main`. Self-hosters should track tagged
releases and apply updates promptly (`docker compose pull && up -d`).

## Security posture

PostSider is built with the following protections:

- **Secrets at rest** — provider credentials and reversible secrets are
  encrypted (AES-256-GCM when `ENCRYPTION_KEY` is set, legacy AES-256-CBC
  otherwise). Passwords are hashed with bcrypt.
- **Two-factor authentication** — TOTP enrollment through an authenticator app,
  a short-lived enrollment challenge, and one-time recovery codes for account
  recovery. Operators can optionally enforce enrollment for every dashboard user.
- **Security audit trail** — sensitive account and organization actions, including
  role changes, invitations, API-key changes, channel disconnects, account
  deletion, and superadmin impersonation are recorded.
- **Startup guard** — the app refuses to boot without `JWT_SECRET` and aborts if
  `NOT_SECURED` is enabled in production.
- **HTTP hardening** — strict CORS allow-list, security headers (CSP,
  `X-Frame-Options`, HSTS in production), `httpOnly` / `secure` cookies.
- **SSRF protection** — outbound webhook and inbound delivery requests use an
  SSRF-safe dispatcher that blocks internal / link-local addresses.
- **Rate limiting** — Redis-backed global throttler plus a dedicated guard on
  authentication endpoints.
- **Uploads** — magic-byte validation, MIME allow-list, SVG rejected, size
  limits enforced.
- **Database** — all access via Prisma (parameterized); no raw SQL on user input.

## Dependency hygiene

CI runs `pnpm audit` on every push. Known transitive advisories are pinned to
patched versions via `overrides` in `pnpm-workspace.yaml`. Operators who want to
verify can run:

```bash
pnpm audit --prod
```

### Known items

- `multer@1.x` (used transitively for multipart uploads) carries a DoS advisory
  fixed in `2.x`. The 2.x line is a breaking change and is being validated
  before adoption; upload size limits already mitigate the practical impact.

## Hardening checklist for self-hosters

- Set a strong, unique `JWT_SECRET` and a separate `ENCRYPTION_KEY`.
- Serve only over HTTPS (terminate TLS at your reverse proxy).
- Leave `NOT_SECURED` unset (any set value enables insecure mode).
- Set `DISABLE_REGISTRATION=true` after creating your account.
- Restrict database / Redis / MinIO ports to localhost or a private network.
- Keep `POLAR_*` and OAuth secrets out of version control (use `.env.production`,
  which is git-ignored).
