import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { PublicWebhookDeliveryService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-delivery.service';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

export const DELIVERY_RETENTION_DAYS = 30;
export const IDEMPOTENCY_RETENTION_DAYS = 7;
export const AUDIT_RESOURCE_RETENTION_DAYS = 365;
/** Email approval link tokens are kept this long past their expiry or use. */
export const APPROVAL_TOKEN_RETENTION_DAYS = 7;
export const PURGE_BATCH = 5000;

const DAY_MS = 24 * 60 * 60 * 1000;

type PurgeDelegate = {
  findMany(args: {
    where: object;
    select: { id: true };
    take: number;
  }): Promise<{ id: string }[]>;
  deleteMany(args: { where: { id: { in: string[] } } }): Promise<{
    count: number;
  }>;
};

@Injectable()
@Activity()
export class WebhookDeliveryActivity {
  constructor(
    private _delivery: PublicWebhookDeliveryService,
    private _prisma: PrismaService
  ) {}

  @ActivityMethod()
  async processDueWebhookDeliveries(): Promise<{
    claimed: number;
    succeeded: number;
    retried: number;
    failed: number;
  }> {
    return this._delivery.processDue();
  }

  /**
   * Deletes finished webhook deliveries older than 30 days and idempotency
   * keys older than 7 days. PENDING deliveries are never touched, however old.
   * Also deletes email approval link tokens (ApprovalActionToken) whose expiry
   * or use is more than 7 days old; a live or recently used token is kept.
   * Also deletes audit rows of type 'resource' older than 365 days; security
   * and sign-in audit rows are never matched. Order: deliveries, idempotency,
   * audit, so an audit failure is rethrown (Temporal retries) after the others ran.
   */
  @ActivityMethod()
  async purgeExpiredPublicApiRecords(
    now: Date = new Date()
  ): Promise<{
    deliveries: number;
    idempotency: number;
    approvalTokens: number;
    auditEvents: number;
  }> {
    const deliveries = await this.purgeInBatches(
      this._prisma.publicWebhookDelivery as unknown as PurgeDelegate,
      {
        createdAt: { lt: new Date(now.getTime() - DELIVERY_RETENTION_DAYS * DAY_MS) },
        status: { not: 'PENDING' },
      }
    );
    const idempotency = await this.purgeInBatches(
      this._prisma.publicApiIdempotency as unknown as PurgeDelegate,
      {
        createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_RETENTION_DAYS * DAY_MS) },
      }
    );
    const tokenCutoff = new Date(
      now.getTime() - APPROVAL_TOKEN_RETENTION_DAYS * DAY_MS
    );
    const approvalTokens = await this.purgeInBatches(
      this._prisma.approvalActionToken as unknown as PurgeDelegate,
      { OR: [{ expiresAt: { lt: tokenCutoff } }, { usedAt: { lt: tokenCutoff } }] }
    );
    const auditEvents = await this.purgeInBatches(
      this._prisma.auditLog as unknown as PurgeDelegate,
      {
        type: 'resource',
        createdAt: {
          lt: new Date(now.getTime() - AUDIT_RESOURCE_RETENTION_DAYS * DAY_MS),
        },
      }
    );
    return { deliveries, idempotency, approvalTokens, auditEvents };
  }

  private async purgeInBatches(
    model: PurgeDelegate,
    where: object
  ): Promise<number> {
    let total = 0;
    let ids: { id: string }[];
    do {
      ids = await model.findMany({
        where,
        select: { id: true },
        take: PURGE_BATCH,
      });
      if (ids.length === 0) {
        break;
      }
      const { count } = await model.deleteMany({
        where: { id: { in: ids.map((row) => row.id) } },
      });
      total += count;
    } while (ids.length === PURGE_BATCH);
    return total;
  }
}
