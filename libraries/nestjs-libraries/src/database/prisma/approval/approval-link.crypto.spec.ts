import {
  CHALLENGE_MAX_AGE_MS,
  CHALLENGE_MIN_AGE_MS,
  hashLinkToken,
  linkTtlHours,
  linksEnabled,
  makeChallenge,
  newLinkToken,
  verifyChallenge,
} from './approval-link.crypto';

const SECRET = 'unit-test-secret-value-for-links';

describe('approval link tokens', () => {
  it('mints 43 character base64url tokens that never repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const t = newLinkToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(1000);
  });

  it('hashes to a stable sha256 hex string that is not the token', () => {
    const t = newLinkToken();
    expect(hashLinkToken(t)).toBe(hashLinkToken(t));
    expect(hashLinkToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashLinkToken(t)).not.toContain(t);
    expect(hashLinkToken('a')).not.toBe(hashLinkToken('b'));
    expect(hashLinkToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});

describe('approver link challenge', () => {
  const hash = hashLinkToken('token-one');
  const t0 = 1_700_000_000_000;

  it('is <issuedAt>.<hex hmac>', () => {
    expect(makeChallenge(hash, t0, SECRET)).toMatch(/^1700000000000\.[0-9a-f]{64}$/);
  });

  it('is valid between 2 seconds and 15 minutes', () => {
    const c = makeChallenge(hash, t0, SECRET);
    expect(verifyChallenge(c, hash, t0 + 3_000, SECRET)).toBe('ok');
    expect(verifyChallenge(c, hash, t0 + CHALLENGE_MIN_AGE_MS, SECRET)).toBe('ok');
    expect(verifyChallenge(c, hash, t0 + CHALLENGE_MAX_AGE_MS, SECRET)).toBe('ok');
  });

  it('is too early under 2 seconds (also for a clock in the past)', () => {
    const c = makeChallenge(hash, t0, SECRET);
    expect(verifyChallenge(c, hash, t0 + 1_000, SECRET)).toBe('too_early');
    expect(verifyChallenge(c, hash, t0 - 5_000, SECRET)).toBe('too_early');
  });

  it('expires after 15 minutes', () => {
    const c = makeChallenge(hash, t0, SECRET);
    expect(verifyChallenge(c, hash, t0 + 16 * 60_000, SECRET)).toBe('expired');
  });

  it('is invalid for another token, another secret, a flipped character or garbage', () => {
    const c = makeChallenge(hash, t0, SECRET);
    const other = hashLinkToken('token-two');
    expect(verifyChallenge(c, other, t0 + 3_000, SECRET)).toBe('invalid');
    expect(verifyChallenge(c, hash, t0 + 3_000, 'another-secret-value-here')).toBe('invalid');
    const flipped = c.slice(0, -1) + (c.endsWith('0') ? '1' : '0');
    expect(verifyChallenge(flipped, hash, t0 + 3_000, SECRET)).toBe('invalid');
    // a forged timestamp keeps the old mac
    const forged = `${t0 + 1}.${c.split('.')[1]}`;
    expect(verifyChallenge(forged, hash, t0 + 3_000, SECRET)).toBe('invalid');
    for (const bad of ['', 'x', '.', '12.', '.abc', `${t0}.zz`, `${t0}.${'0'.repeat(63)}`, 'a'.repeat(500)]) {
      expect(verifyChallenge(bad, hash, t0 + 3_000, SECRET)).toBe('invalid');
    }
    expect(verifyChallenge(undefined as any, hash, t0 + 3_000, SECRET)).toBe('invalid');
    expect(verifyChallenge(42 as any, hash, t0 + 3_000, SECRET)).toBe('invalid');
  });
});

describe('env helpers', () => {
  it('linkTtlHours defaults to 48 and clamps to 1..168', () => {
    expect(linkTtlHours(undefined)).toBe(48);
    expect(linkTtlHours('')).toBe(48);
    expect(linkTtlHours('abc')).toBe(48);
    expect(linkTtlHours('NaN')).toBe(48);
    expect(linkTtlHours('24')).toBe(24);
    expect(linkTtlHours('1')).toBe(1);
    expect(linkTtlHours('0')).toBe(1);
    expect(linkTtlHours('-3')).toBe(1);
    expect(linkTtlHours('168')).toBe(168);
    expect(linkTtlHours('500')).toBe(168);
    expect(linkTtlHours('12.7')).toBe(12);
  });

  it('linksEnabled is true only for the exact string true', () => {
    expect(linksEnabled('true')).toBe(true);
    for (const v of [undefined, '', 'TRUE', 'True', '1', 'yes', 'false', ' true']) {
      expect(linksEnabled(v)).toBe(false);
    }
  });
});
