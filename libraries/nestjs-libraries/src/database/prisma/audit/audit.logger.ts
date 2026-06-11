import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

export interface AuditEntry {
  organizationId: string;
  agentTokenId?: string | null;
  operation: string;
  connectorId?: string | null;
  correlationId: string;
  status: string;
  /** Raw input params; hashed before persisting (never stored verbatim). */
  input?: unknown;
  type?: string | null;
}

@Injectable()
export class AuditLogger {
  constructor(private _auditLog: PrismaRepository<'auditLog'>) {}

  /** Hash input params so the audit log never stores raw secrets (Requirement 15.3). */
  static hashInput(input: unknown): string | null {
    if (input == null) {
      return null;
    }
    let serialized: string;
    try {
      serialized = typeof input === 'string' ? input : JSON.stringify(input);
    } catch {
      serialized = String(input);
    }
    return createHash('sha256').update(serialized).digest('hex');
  }

  /**
   * Persist an audit entry. Best-effort: a logging failure must never break the
   * operation being audited, so errors are swallowed after being surfaced.
   */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this._auditLog.model.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          agentTokenId: entry.agentTokenId ?? null,
          operation: entry.operation,
          connectorId: entry.connectorId ?? null,
          correlationId: entry.correlationId,
          status: entry.status,
          inputHash: AuditLogger.hashInput(entry.input),
          type: entry.type ?? null,
        },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[audit] failed to persist audit log entry', err);
    }
  }

  query(
    organizationId: string,
    filters: {
      agentTokenId?: string;
      connectorId?: string;
      from?: Date;
      to?: Date;
      page?: number;
      pageSize?: number;
    } = {}
  ) {
    const pageSize = filters.pageSize ?? 50;
    const page = filters.page ?? 0;
    return this._auditLog.model.auditLog.findMany({
      where: {
        organizationId,
        ...(filters.agentTokenId ? { agentTokenId: filters.agentTokenId } : {}),
        ...(filters.connectorId ? { connectorId: filters.connectorId } : {}),
        ...(filters.from || filters.to
          ? {
              createdAt: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: page * pageSize,
      take: pageSize,
    });
  }
}
