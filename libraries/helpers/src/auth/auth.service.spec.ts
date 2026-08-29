import fc from 'fast-check';
import {
  AuthService,
  encrypt_gcm,
  decrypt_gcm,
  encrypt_legacy_using_IV,
} from '@postsider/helpers/auth/auth.service';

const ORIGINAL_ENV = { ...process.env };

describe('AuthService secret encryption', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-value';
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'test-jwt-secret-value' };
  });

  it('GCM round-trips arbitrary strings', () => {
    process.env.ENCRYPTION_KEY = 'a-strong-encryption-key';
    fc.assert(
      fc.property(fc.string(), (plaintext) => {
        const ct = encrypt_gcm(plaintext);
        expect(ct.startsWith('v2:')).toBe(true);
        expect(decrypt_gcm(ct)).toBe(plaintext);
      })
    );
  });

  it('GCM uses a random IV (ciphertext differs each call)', () => {
    process.env.ENCRYPTION_KEY = 'a-strong-encryption-key';
    const a = encrypt_gcm('same-input');
    const b = encrypt_gcm('same-input');
    expect(a).not.toBe(b);
    expect(decrypt_gcm(a)).toBe('same-input');
    expect(decrypt_gcm(b)).toBe('same-input');
  });

  it('encryptSecret uses GCM when ENCRYPTION_KEY is set', () => {
    process.env.ENCRYPTION_KEY = 'a-strong-encryption-key';
    const ct = AuthService.encryptSecret('secret');
    expect(ct.startsWith('v2:')).toBe(true);
    expect(AuthService.decryptSecret(ct)).toBe('secret');
  });

  it('encryptSecret falls back to legacy CBC when ENCRYPTION_KEY is unset', () => {
    delete process.env.ENCRYPTION_KEY;
    const ct = AuthService.encryptSecret('secret');
    expect(ct.startsWith('v2:')).toBe(false);
    expect(AuthService.decryptSecret(ct)).toBe('secret');
  });

  it('decryptSecret reads legacy CBC ciphertext regardless of ENCRYPTION_KEY', () => {
    delete process.env.ENCRYPTION_KEY;
    const legacy = encrypt_legacy_using_IV('legacy-value');
    process.env.ENCRYPTION_KEY = 'a-strong-encryption-key';
    // version-aware: no v2: prefix -> treated as legacy CBC
    expect(AuthService.decryptSecret(legacy)).toBe('legacy-value');
  });

  it('GCM detects tampering via the auth tag', () => {
    process.env.ENCRYPTION_KEY = 'a-strong-encryption-key';
    const ct = encrypt_gcm('authentic');
    // Flip a character in the ciphertext body, guaranteeing the new character
    // differs from the original ('A' -> 'B', anything else -> 'A'). The old
    // ternary could produce an unchanged string when the char was already
    // 'A'/'B', which made this test flaky (~2% of runs).
    const idx = ct.length - 2;
    const flip = ct[idx] === 'A' ? 'B' : 'A';
    const tampered = ct.slice(0, idx) + flip + ct.slice(idx + 1);
    expect(() => decrypt_gcm(tampered)).toThrow();
  });
});

describe('AuthService JWT & password', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-value';
  });

  it('signs and verifies a JWT round-trip', () => {
    const token = AuthService.signJWT({ id: 'user-1' });
    const payload = AuthService.verifyJWT(token) as { id: string };
    expect(payload.id).toBe('user-1');
  });

  it('rejects a tampered JWT', () => {
    const token = AuthService.signJWT({ id: 'user-1' });
    const tampered = token.slice(0, -3) + 'xxx';
    expect(() => AuthService.verifyJWT(tampered)).toThrow();
  });

  it('session JWT carries an expiry claim', () => {
    const token = AuthService.signSessionJWT({ id: 'user-1' }, 3600);
    const payload = AuthService.verifyJWT(token) as { exp?: number; iat?: number };
    expect(payload.exp).toBeDefined();
    expect(payload.iat).toBeDefined();
    expect(payload.exp! - payload.iat!).toBe(3600);
  });

  it('hashes and verifies a password', () => {
    const hash = AuthService.hashPassword('s3cret!');
    expect(hash).not.toBe('s3cret!');
    expect(AuthService.comparePassword('s3cret!', hash)).toBe(true);
    expect(AuthService.comparePassword('wrong', hash)).toBe(false);
  });

  it('legacy CBC encryption is deterministic (required for lookups)', () => {
    // Org API keys / OAuth tokens are matched by equality, so the legacy
    // scheme MUST stay deterministic. Guard against accidental change.
    const a = AuthService.fixedEncryption('lookup-value');
    const b = AuthService.fixedEncryption('lookup-value');
    expect(a).toBe(b);
    expect(AuthService.fixedDecryption(a)).toBe('lookup-value');
  });
});
