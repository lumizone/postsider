import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

export interface AuditEntry {
  /** Null for authentication events, which happen outside any organization. */
  organizationId: string | null;
  operation: string;
  connectorId?: string | null;
  correlationId: string;
  status: string;
  /** Raw input params; hashed before persisting (never stored verbatim). */
  input?: unknown;
  type?: string | null;
  /** Who performed the action. Omit for machine-driven entries. */
  actorUserId?: string | null;
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
  /**
   * Record a security-relevant action taken by a person: a role change, an
   * invite, a revoked key, an impersonation. Same store as the connector
   * entries, with the actor attached and a correlation id generated here so
   * callers stay one line.
   */
  async logSecurityEvent(
    organizationId: string | null,
    operation: string,
    actorUserId: string | null,
    input?: unknown
  ): Promise<void> {
    await this.log({
      organizationId,
      operation,
      actorUserId,
      correlationId: randomUUID(),
      status: 'ok',
      input,
      type: 'security',
    });
  }

  /**
   * Record a sign-in attempt. Deliberately organization-free: the point of this
   * entry is the attempt itself, and a failed one names an account that may not
   * exist. The email is hashed like every other audit input — the trail answers
   * "was this account attacked", not "who typed what".
   */
  async logAuthEvent(
    operation: 'auth.login' | 'auth.login_failed' | 'auth.register' | 'auth.password_reset_requested' | 'auth.password_reset' | 'auth.mfa_setup_started' | 'auth.mfa_enabled' | 'auth.mfa_disabled' | 'auth.mfa_verified' | 'auth.mfa_failed',
    details: { userId?: string | null; email?: string | null; ip?: string | null; provider?: string | null }
  ): Promise<void> {
    await this.log({
      organizationId: null,
      operation,
      actorUserId: details.userId ?? null,
      correlationId: randomUUID(),
      status: operation === 'auth.login_failed' ? 'error' : 'ok',
      input: {
        email: details.email ?? null,
        ip: details.ip ?? null,
        provider: details.provider ?? null,
      },
      type: 'security',
    });
  }

  async log(entry: AuditEntry): Promise<void> {
    try {
      await this._auditLog.model.auditLog.create({
        data: {
          organizationId: entry.organizationId,
          operation: entry.operation,
          connectorId: entry.connectorId ?? null,
          actorUserId: entry.actorUserId ?? null,
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
      connectorId?: string;
      from?: Date;
      to?: Date;
      page?: number;
      pageSize?: number;
    } = {}
  ) {
    // Clamp like errors.repository.ts — a huge pageSize or negative page forces
    // an unbounded/negative Prisma query.
    const pageSize = Math.min(Math.max(1, filters.pageSize ?? 50), 100);
    const page = Math.max(0, filters.page ?? 0);
    return this._auditLog.model.auditLog.findMany({
      where: {
        organizationId,
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
