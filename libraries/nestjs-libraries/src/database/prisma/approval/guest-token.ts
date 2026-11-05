import { createHash, randomBytes } from 'crypto';

/** SHA-256 hex of the UTF-8 token. Only this value is ever stored. */
export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 24 random bytes, base64url (32 characters). */
export function newGuestToken(): string {
  return randomBytes(24).toString('base64url');
}
