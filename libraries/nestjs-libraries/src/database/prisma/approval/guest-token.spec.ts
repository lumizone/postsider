import { createHash } from 'crypto';
import { hashGuestToken, newGuestToken } from './guest-token';

describe('guest-token', () => {
  it('hashes as sha256 hex of the utf-8 token', () => {
    expect(hashGuestToken('abc123token')).toBe(
      createHash('sha256').update('abc123token', 'utf8').digest('hex')
    );
    expect(hashGuestToken('abc123token')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and distinguishes tokens', () => {
    expect(hashGuestToken('a')).toBe(hashGuestToken('a'));
    expect(hashGuestToken('a')).not.toBe(hashGuestToken('b'));
  });

  it('mints 24 random bytes as base64url', () => {
    const a = newGuestToken();
    const b = newGuestToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });
});
