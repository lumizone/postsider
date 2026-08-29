import { Injectable } from '@nestjs/common';
import * as OTPAuth from 'otpauth';

const ISSUER = 'PostSider';

@Injectable()
export class TotpService {
  createEnrollment(email: string) {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    const totp = this.totp(secret, email);
    return { secret, otpauthUrl: totp.toString() };
  }

  currentCode(secret: string) {
    return this.totp(secret).generate();
  }

  verifyCode(secret: string, code: string) {
    if (!/^\d{6}$/.test(code)) return false;
    return this.totp(secret).validate({ token: code, window: 1 }) !== null;
  }

  createRecoveryCodes() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 10 }, () => {
      const bytes = new OTPAuth.Secret({ size: 10 }).bytes;
      let code = '';
      for (const byte of bytes) code += alphabet[byte % alphabet.length];
      return `${code.slice(0, 5)}-${code.slice(5, 10)}-${code.slice(10, 15)}`;
    });
  }

  verifyRecoveryCode(expected: string, supplied: string) {
    return expected.replace(/-/g, '').toUpperCase() === supplied.replace(/-/g, '').toUpperCase();
  }

  private totp(secret: string, label = 'account') {
    return new OTPAuth.TOTP({
      issuer: ISSUER,
      label,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
  }
}
