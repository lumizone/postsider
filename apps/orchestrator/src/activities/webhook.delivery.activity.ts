import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { PublicWebhookDeliveryService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-delivery.service';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

export const DELIVERY_RETENTION_DAYS = 30;
export const IDEMPOTENCY_RETENTION_DAYS = 7;
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
   */
  @ActivityMethod()
  async purgeExpiredPublicApiRecords(
    now: Date = new Date()
  ): Promise<{ deliveries: number; idempotency: number }> {
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
    return { deliveries, idempotency };
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
