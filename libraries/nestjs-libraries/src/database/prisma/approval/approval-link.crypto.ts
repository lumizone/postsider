import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Pure helpers of the email approver links. No Nest, no Prisma, no I/O.
// A link token is a bearer credential: only its SHA-256 is ever stored, and
// the two step challenge makes a bare GET (mail scanner, link previewer)
// unable to decide anything.

export const CHALLENGE_MIN_AGE_MS = 2_000;
export const CHALLENGE_MAX_AGE_MS = 15 * 60_000;
export const LINK_TTL_DEFAULT_HOURS = 48;
export const LINK_TTL_MIN_HOURS = 1;
export const LINK_TTL_MAX_HOURS = 168;

/** 32 random bytes as base64url: 43 characters. */
export function newLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashLinkToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function challengeKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('approver-link-challenge').digest();
}

function mac(tokenHash: string, issuedAt: number, secret: string): string {
  return createHmac('sha256', challengeKey(secret))
    .update(`${tokenHash}.${issuedAt}`)
    .digest('hex');
}

/** Stateless challenge: `<issuedAtMs>.<hex hmac>`, bound to one token hash. */
export function makeChallenge(
  tokenHash: string,
  now: number,
  secret: string
): string {
  return `${now}.${mac(tokenHash, now, secret)}`;
}

export type ChallengeVerdict = 'ok' | 'too_early' | 'expired' | 'invalid';

const CHALLENGE_SHAPE = /^(\d{10,16})\.([0-9a-f]{64})$/;

export function verifyChallenge(
  challenge: string,
  tokenHash: string,
  now: number,
  secret: string
): ChallengeVerdict {
  if (typeof challenge !== 'string' || challenge.length > 100) return 'invalid';
  const m = CHALLENGE_SHAPE.exec(challenge);
  if (!m) return 'invalid';
  const issuedAt = Number(m[1]);
  if (!Number.isSafeInteger(issuedAt)) return 'invalid';
  const expected = Buffer.from(mac(tokenHash, issuedAt, secret), 'hex');
  const given = Buffer.from(m[2], 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return 'invalid';
  }
  const age = now - issuedAt;
  if (age < CHALLENGE_MIN_AGE_MS) return 'too_early';
  if (age > CHALLENGE_MAX_AGE_MS) return 'expired';
  return 'ok';
}

/** APPROVAL_LINK_TTL_HOURS: default 48, clamped to 1..168, garbage means 48. */
export function linkTtlHours(env: string | undefined): number {
  if (env === undefined || env.trim() === '') return LINK_TTL_DEFAULT_HOURS;
  const n = Number(env);
  if (!Number.isFinite(n)) return LINK_TTL_DEFAULT_HOURS;
  return Math.min(
    LINK_TTL_MAX_HOURS,
    Math.max(LINK_TTL_MIN_HOURS, Math.floor(n))
  );
}

/** APPROVAL_EMAIL_LINKS: exactly the string `true`, nothing else. */
export function linksEnabled(env: string | undefined): boolean {
  return env === 'true';
}
