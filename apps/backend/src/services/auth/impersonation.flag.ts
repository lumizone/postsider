/**
 * Superadmin impersonation lets an operator open any customer's account and
 * see everything that customer sees. That is a real data-access path, so it is
 * OFF unless explicitly enabled.
 *
 * On the managed cloud `ALLOW_SUPERADMIN_IMPERSONATION` stays unset/false: the
 * operator can manage billing and infrastructure, but cannot read another
 * organization's content. Enabling it (value exactly "true") is a deliberate,
 * auditable support action — `POST /users/impersonate` writes an
 * `impersonate.start` entry to the audit log every time.
 */
export const isImpersonationEnabled = (): boolean =>
  process.env.ALLOW_SUPERADMIN_IMPERSONATION === 'true';
