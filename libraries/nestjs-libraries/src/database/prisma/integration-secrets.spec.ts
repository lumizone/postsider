process.env.ENCRYPTION_KEY = 'test-encryption-key-for-integration-secrets';
process.env.JWT_SECRET = 'test-jwt-secret';

import {
  decryptField,
  decryptResult,
  encryptField,
  encryptWritePayload,
} from './integration-secrets.extension';

describe('integration secrets - field level', () => {
  it('round-trips a token', () => {
    const encrypted = encryptField('act.RealLookingAccessToken') as string;
    expect(encrypted.startsWith('v2:')).toBe(true);
    expect(encrypted).not.toContain('act.RealLookingAccessToken');
    expect(decryptField(encrypted)).toBe('act.RealLookingAccessToken');
  });

  it('never double-encrypts', () => {
    const once = encryptField('token-value') as string;
    expect(encryptField(once)).toBe(once);
  });

  it('leaves empty values and non-strings alone', () => {
    expect(encryptField('')).toBe('');
    expect(encryptField(null)).toBe(null);
    expect(encryptField(undefined)).toBe(undefined);
  });

  it('passes legacy plaintext through on read', () => {
    // Rows written before this shipped must keep working until the migration
    // script rewrites them.
    expect(decryptField('act.PlaintextLegacyToken')).toBe(
      'act.PlaintextLegacyToken',
    );
  });
});

describe('integration secrets - write payloads', () => {
  it('encrypts both secret fields in a create payload', () => {
    const out: any = encryptWritePayload({
      name: 'Local Waifu',
      token: 'access-1',
      refreshToken: 'refresh-1',
      providerIdentifier: 'instagram',
    });
    expect(out.token.startsWith('v2:')).toBe(true);
    expect(out.refreshToken.startsWith('v2:')).toBe(true);
    expect(out.name).toBe('Local Waifu');
    expect(decryptField(out.token)).toBe('access-1');
  });

  it('handles the { set: value } update form', () => {
    const out: any = encryptWritePayload({ token: { set: 'access-2' } });
    expect(out.token.set.startsWith('v2:')).toBe(true);
    expect(decryptField(out.token.set)).toBe('access-2');
  });

  it('leaves a payload without secrets untouched', () => {
    const input = { refreshNeeded: true };
    expect(encryptWritePayload(input)).toEqual(input);
  });
});

describe('integration secrets - result decryption', () => {
  const integration = () => ({
    id: 'int1',
    providerIdentifier: 'tiktok',
    token: encryptField('act.token') as string,
    refreshToken: encryptField('refresh.token') as string,
    createdAt: new Date('2026-08-26T07:00:00.000Z'),
  });

  it('decrypts a bare integration row', () => {
    const out: any = decryptResult(integration());
    expect(out.token).toBe('act.token');
    expect(out.refreshToken).toBe('refresh.token');
    expect(out.createdAt instanceof Date).toBe(true);
  });

  it('decrypts integrations nested in a post include', () => {
    const out: any = decryptResult({
      id: 'post1',
      content: 'hello',
      integration: integration(),
    });
    expect(out.integration.token).toBe('act.token');
    expect(out.content).toBe('hello');
  });

  it('decrypts every row of a list', () => {
    const out: any = decryptResult([integration(), integration()]);
    expect(out.map((i: any) => i.token)).toEqual(['act.token', 'act.token']);
  });

  it('decrypts a select-only shape when the query targeted Integration', () => {
    // `select: { token: true }` carries no identifying field at all — the
    // first cut of this walker returned ciphertext for it, which the live
    // pre-flight caught before it ever reached production.
    const out: any = decryptResult(
      { token: encryptField('act.token') },
      true,
    );
    expect(out.token).toBe('act.token');
  });

  it('decrypts an integration reached through a named relation', () => {
    const out: any = decryptResult({
      id: 'assignment1',
      integration: { token: encryptField('act.token') },
    });
    expect(out.integration.token).toBe('act.token');
  });

  it('leaves rows of other models alone', () => {
    // A Webhook also has a `secret`, and a User has a `token`-ish column in
    // other products — only rows carrying providerIdentifier are integrations.
    const input = { id: 'w1', token: 'v2:not-an-integration' };
    expect(decryptResult(input)).toEqual(input);
  });

  it('returns the same object when nothing needed decrypting', () => {
    const input = { id: 'x', providerIdentifier: 'x', token: 'plaintext' };
    expect(decryptResult(input)).toBe(input);
  });

  it('survives null and primitives', () => {
    expect(decryptResult(null)).toBe(null);
    expect(decryptResult(42 as any)).toBe(42);
    expect(decryptResult('str' as any)).toBe('str');
  });
});
