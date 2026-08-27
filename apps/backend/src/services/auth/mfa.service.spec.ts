jest.mock('qrcode', () => ({ toDataURL: jest.fn() }), { virtual: true });
jest.mock('otpauth', () => ({}), { virtual: true });

import { MfaService } from './mfa.service';
import { AuthService as AuthCrypto } from '@postsider/helpers/auth/auth.service';

describe('MfaService recovery codes', () => {
  it('accepts a displayed recovery code with separators', async () => {
    const prisma = {
      mfaRecoveryCode: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'recovery-1', codeHash: 'ABCD-EFGH' },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new MfaService(prisma as any, {} as any);
    jest
      .spyOn(AuthCrypto, 'comparePassword')
      .mockImplementation((value, stored) => value === stored);

    await expect(service.useRecoveryCode('user-1', 'ABCD-EFGH')).resolves.toBe(
      true
    );
    expect(AuthCrypto.comparePassword).toHaveBeenCalledWith(
      'ABCD-EFGH',
      'ABCD-EFGH'
    );
  });
});
