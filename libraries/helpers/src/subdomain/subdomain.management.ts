import { parse } from 'tldts';

/**
 * Cookie `domain` for the session cookies.
 *
 * Returning `undefined` makes the cookie HOST-ONLY: the browser sends it to
 * app.postsider.com and nowhere else. That is the default now, because the
 * registrable-domain form (`.postsider.com`) also handed the session to
 * storage.postsider.com — a host that serves files uploaded by users. The
 * dashboard talks to the API through its own origin (`/api`), so nothing needs
 * the wider scope.
 *
 * `COOKIE_DOMAIN` restores the old behaviour for deployments that really do
 * serve the frontend and the API from different subdomains:
 *
 *   COOKIE_DOMAIN=.example.com   → shared across subdomains
 *   COOKIE_DOMAIN=auto           → derive it from the given URL, as before
 *
 * It is an env switch rather than a code change so a rollback is a container
 * recreate, not a redeploy.
 */
export function getCookieUrlFromDomain(domain: string): string | undefined {
  const configured = process.env.COOKIE_DOMAIN;

  if (configured && configured !== 'auto') {
    return configured;
  }

  if (configured === 'auto') {
    const url = parse(domain);
    return url.domain ? '.' + url.domain : url.hostname ?? undefined;
  }

  return undefined;
}

/**
 * The registrable-domain form (`.example.com`) that sessions used before the
 * host-only switch. Only used when clearing cookies, so an old session can
 * still be logged out. Returns undefined when it would duplicate the current
 * scope.
 */
export function legacyCookieDomain(domain: string): string | undefined {
  const current = getCookieUrlFromDomain(domain);
  const url = parse(domain);
  const registrable = url.domain ? '.' + url.domain : undefined;
  return registrable && registrable !== current ? registrable : undefined;
}
