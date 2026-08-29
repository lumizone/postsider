import { TotpService } from './totp.service';
import { MfaService } from './mfa.service';

describe('TotpService', () => {
  const service = new TotpService();

  it('creates a standards-compatible enrollment that verifies its current code', () => {
    const enrollment = service.createEnrollment('person@example.com');

    expect(enrollment.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrollment.otpauthUrl).toContain('otpauth://totp/PostSider:person%40example.com');
    expect(enrollment.otpauthUrl).toContain('issuer=PostSider');
    expect(service.verifyCode(enrollment.secret, service.currentCode(enrollment.secret))).toBe(true);
  });

  it('rejects a wrong authenticator code', () => {
    const enrollment = service.createEnrollment('person@example.com');

    expect(service.verifyCode(enrollment.secret, '000000')).toBe(false);
  });

  it('creates ten unique recovery codes and recognizes only the matching code', () => {
    const codes = service.createRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(service.verifyRecoveryCode(codes[0], codes[0])).toBe(true);
    expect(service.verifyRecoveryCode(codes[0], codes[1])).toBe(false);
  });
});


describe('MfaService policy', () => {
  const globalPolicy = { id: 'global', enforceForAll: false, updatedAt: new Date() };

  it('creates the singleton policy disabled by default and persists updates', async () => {
    const mfaPolicy = { upsert: jest.fn().mockResolvedValueOnce(globalPolicy).mockResolvedValueOnce({ enforceForAll: true }) };
    const service = new MfaService({ mfaPolicy } as any, {} as TotpService);

    await expect(service.getPolicy()).resolves.toMatchObject({ enforceForAll: false });
    await expect(service.updatePolicy(true)).resolves.toEqual({ enforceForAll: true });

    expect(mfaPolicy.upsert).toHaveBeenNthCalledWith(1, {
      where: { id: 'global' }, update: {}, create: { id: 'global', enforceForAll: false }, select: { enforceForAll: true },
    });
    expect(mfaPolicy.upsert).toHaveBeenNthCalledWith(2, {
      where: { id: 'global' }, update: { enforceForAll: true }, create: { id: 'global', enforceForAll: true }, select: { enforceForAll: true },
    });
  });

  it('requires enrollment only when global enforcement is enabled and MFA is absent', async () => {
    const mfaPolicy = { upsert: jest.fn().mockResolvedValueOnce({ enforceForAll: true }).mockResolvedValueOnce({ enforceForAll: false }) };
    const service = new MfaService({ mfaPolicy } as any, {} as TotpService);

    await expect(service.requiresEnrollment({ mfaEnabledAt: null } as any)).resolves.toBe(true);
    await expect(service.requiresEnrollment({ mfaEnabledAt: new Date() } as any)).resolves.toBe(false);
    await expect(service.requiresEnrollment({ mfaEnabledAt: null } as any)).resolves.toBe(false);
  });
});
