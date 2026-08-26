import { BadRequestException, Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { AuthService as AuthCrypto } from '@postsider/helpers/auth/auth.service';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { TotpService } from './totp.service';

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totp: TotpService,
  ) {}

  async getPolicy() {
    return this.prisma.mfaPolicy.upsert({
      where: { id: 'global' },
      update: {},
      create: { id: 'global', enforceForAll: false },
      select: { enforceForAll: true },
    });
  }

  async updatePolicy(enforceForAll: boolean) {
    return this.prisma.mfaPolicy.upsert({
      where: { id: 'global' },
      update: { enforceForAll },
      create: { id: 'global', enforceForAll },
      select: { enforceForAll: true },
    });
  }

  async requiresEnrollment(user: { mfaEnabledAt: Date | null }) {
    if (user.mfaEnabledAt) return false;
    return (await this.getPolicy()).enforceForAll;
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaEnabledAt: true },
    });
    return { enabled: !!user?.mfaEnabledAt };
  }

  async beginEnrollment(userId: string, email: string) {
    const enrollment = this.totp.createEnrollment(email);
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaPendingSecret: AuthCrypto.encryptSecret(enrollment.secret) },
    });
    return { qrCodeDataUrl: await QRCode.toDataURL(enrollment.otpauthUrl), manualKey: enrollment.secret };
  }

  async confirmEnrollment(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaPendingSecret: true },
    });
    if (!user?.mfaPendingSecret) throw new BadRequestException('Start two-factor setup first');
    const secret = AuthCrypto.decryptSecret(user.mfaPendingSecret);
    if (!this.totp.verifyCode(secret, code)) throw new BadRequestException('Invalid authenticator code');

    const recoveryCodes = this.totp.createRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((codeHash) => ({ userId, codeHash: AuthCrypto.hashPassword(codeHash) })),
      });
      await tx.user.update({
        where: { id: userId },
        data: { mfaSecret: user.mfaPendingSecret, mfaPendingSecret: null, mfaEnabledAt: new Date() },
      });
    });
    return { recoveryCodes };
  }

  async verifySecondFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabledAt: true },
    });
    if (!user?.mfaEnabledAt || !user.mfaSecret) return false;
    return this.totp.verifyCode(AuthCrypto.decryptSecret(user.mfaSecret), code);
  }

  async useRecoveryCode(userId: string, code: string) {
    const normalized = code.replace(/-/g, '').toUpperCase();
    const candidates = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    });
    for (const candidate of candidates) {
      if (!AuthCrypto.comparePassword(normalized, candidate.codeHash)) continue;
      const result = await this.prisma.mfaRecoveryCode.updateMany({
        where: { id: candidate.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      return result.count === 1;
    }
    return false;
  }

  async disable(userId: string, code: string) {
    const valid = await this.verifySecondFactor(userId, code) || await this.useRecoveryCode(userId, code);
    if (!valid) throw new BadRequestException('Invalid authenticator or recovery code');
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.user.update({
        where: { id: userId },
        data: { mfaSecret: null, mfaPendingSecret: null, mfaEnabledAt: null },
      }),
    ]);
  }
}
