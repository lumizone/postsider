import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import type { PostActorType } from '@postsider/nestjs-libraries/actor/post-actor';
import type { AuditEventType } from './audit-events';

export type AuditEventItem = {
  id: string;
  type: string;
  createdAt: Date;
  actor: {
    type: PostActorType | 'GUEST';
    userId?: string;
    apiKeyId?: string;
    oauthClientId?: string;
  };
  target: { type: string; id: string };
  metadata: Record<string, unknown>;
};

export interface AuditEventFilters {
  targetType?: string;
  targetIds?: string[];
  type?: AuditEventType;
  from?: Date;
  to?: Date;
  limit: number;
  cursor?: string;
}

@Injectable()
export class AuditEventsService {
  constructor(private _auditLog: PrismaRepository<'auditLog'>) {}

  static encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(JSON.stringify({ t: createdAt.toISOString(), i: id })).toString('base64url');
  }

  static decodeCursor(cursor: string): { createdAt: Date; id: string } {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof parsed.t === 'string' &&
        typeof parsed.i === 'string' &&
        parsed.i.length > 0 &&
        parsed.i.length <= 100
      ) {
        const createdAt = new Date(parsed.t);
        if (!Number.isNaN(createdAt.getTime())) {
          return { createdAt, id: parsed.i };
        }
      }
    } catch {
      // fall through
    }
    throw new BadRequestException('Invalid cursor');
  }

  static toItem(row: any): AuditEventItem {
    const type: AuditEventItem['actor']['type'] =
      row.actorType ?? (row.metadata?.by === 'guest' ? 'GUEST' : 'SYSTEM');
    const actor: AuditEventItem['actor'] = { type };
    if (row.actorUserId) actor.userId = row.actorUserId;
    if (row.actorApiKeyId) actor.apiKeyId = row.actorApiKeyId;
    if (row.actorOAuthClientId) actor.oauthClientId = row.actorOAuthClientId;
    return {
      id: row.id,
      type: row.operation,
      createdAt: row.createdAt,
      actor,
      target: { type: row.targetType, id: row.targetId },
      metadata: row.metadata ?? {},
    };
  }

  async list(
    orgId: string,
    f: AuditEventFilters
  ): Promise<{ events: AuditEventItem[]; nextCursor: string | null }> {
    if (f.targetIds && f.targetIds.length === 0) {
      return { events: [], nextCursor: null };
    }
    // Decode first so a tampered cursor fails before any query runs.
    const cursor = f.cursor ? AuditEventsService.decodeCursor(f.cursor) : undefined;

    const where: Record<string, unknown> = {
      organizationId: orgId,
      targetType: f.targetType ?? { not: null },
    };
    if (f.targetIds) where.targetId = { in: f.targetIds };
    if (f.type) where.operation = f.type;
    if (f.from || f.to) {
      where.createdAt = {
        ...(f.from ? { gte: f.from } : {}),
        ...(f.to ? { lte: f.to } : {}),
      };
    }
    if (cursor) {
      where.OR = [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ];
    }

    const rows = await this._auditLog.model.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: f.limit + 1,
    });
    const page = rows.slice(0, f.limit);
    const last = page[page.length - 1];
    return {
      events: page.map((row) => AuditEventsService.toItem(row)),
      nextCursor:
        rows.length > f.limit && last
          ? AuditEventsService.encodeCursor(last.createdAt, last.id)
          : null,
    };
  }
}
