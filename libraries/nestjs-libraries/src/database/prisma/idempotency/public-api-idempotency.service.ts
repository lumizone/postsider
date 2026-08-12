import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';

export type IdempotencyClaim =
  | { kind: 'new'; id: string }
  | { kind: 'replay'; response: unknown };

@Injectable()
export class PublicApiIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(orgId: string, key: string | undefined, body: unknown): Promise<IdempotencyClaim | null> {
    if (!key) return null;
    if (!/^[A-Za-z0-9._:-]{1,255}$/.test(key)) {
      throw new ConflictException('Invalid Idempotency-Key');
    }

    const requestHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    try {
      const row = await this.prisma.publicApiIdempotency.create({
        data: { id: makeId(24), organizationId: orgId, key, requestHash },
      });
      return { kind: 'new', id: row.id };
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
      const row = await this.prisma.publicApiIdempotency.findUnique({
        where: { organizationId_key: { organizationId: orgId, key } },
      });
      if (!row) throw error;
      if (row.requestHash !== requestHash) {
        throw new ConflictException('Idempotency-Key was already used with a different request');
      }
      if (row.status === 'completed' && row.responseJson) {
        return { kind: 'replay', response: JSON.parse(row.responseJson) };
      }
      throw new ConflictException('A request with this Idempotency-Key is already processing');
    }
  }

  async complete(id: string, response: unknown) {
    await this.prisma.publicApiIdempotency.update({
      where: { id },
      data: { status: 'completed', responseJson: JSON.stringify(response) },
    });
  }

  async release(id: string) {
    await this.prisma.publicApiIdempotency.delete({ where: { id } }).catch(() => undefined);
  }
}
