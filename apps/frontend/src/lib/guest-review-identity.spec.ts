import { validateGuestIdentity } from './guest-review-identity';

describe('validateGuestIdentity', () => {
  it('requires a name', () => {
    expect(validateGuestIdentity('', 'a@b.co')).toEqual({ ok: false, error: 'nameRequired' });
    expect(validateGuestIdentity('   ', 'a@b.co')).toEqual({ ok: false, error: 'nameRequired' });
  });

  it('limits the name to 120 characters', () => {
    expect(validateGuestIdentity('n'.repeat(121), 'a@b.co')).toEqual({ ok: false, error: 'nameTooLong' });
    expect(validateGuestIdentity('n'.repeat(120), 'a@b.co').ok).toBe(true);
  });

  it('requires an email', () => {
    expect(validateGuestIdentity('Ann', '')).toEqual({ ok: false, error: 'emailRequired' });
    expect(validateGuestIdentity('Ann', '  ')).toEqual({ ok: false, error: 'emailRequired' });
  });

  it('rejects malformed emails', () => {
    for (const bad of ['not-an-email', 'a@b', 'a b@c.de']) {
      expect(validateGuestIdentity('Ann', bad)).toEqual({ ok: false, error: 'emailInvalid' });
    }
  });

  it('limits the email to 254 characters', () => {
    const long = 'a'.repeat(255 - '@b.co'.length) + '@b.co';
    expect(long).toHaveLength(255);
    expect(validateGuestIdentity('Ann', long)).toEqual({ ok: false, error: 'emailTooLong' });
    const ok = 'a'.repeat(254 - '@b.co'.length) + '@b.co';
    expect(validateGuestIdentity('Ann', ok).ok).toBe(true);
  });

  it('trims both values', () => {
    expect(validateGuestIdentity('  Ann  ', '  a@b.co  ')).toEqual({ ok: true, name: 'Ann', email: 'a@b.co' });
  });
});
