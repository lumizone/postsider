import { HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { PUBLIC_WEBHOOK_TEST_EVENT } from '@postsider/nestjs-libraries/services/public-webhook-events';
import { PublicWebhookDeliveryService } from './public-webhook-delivery.service';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_ERROR_LENGTH = 500;

export interface DeliverySummary {
  id: string;
  eventId: string;
  event: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date | null;
  lastStatusCode: number | null;
  lastError: string | null;
  createdAt: Date;
  deliveredAt: Date | null;
}

const SUMMARY_SELECT = {
  id: true,
  eventId: true,
  event: true,
  status: true,
  attempts: true,
  nextAttemptAt: true,
  lastStatusCode: true,
  lastError: true,
  createdAt: true,
  deliveredAt: true,
} as const;

function toSummary(row: any): DeliverySummary {
  return {
    id: row.id,
    eventId: row.eventId,
    event: row.event,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    lastStatusCode: row.lastStatusCode,
    lastError:
      typeof row.lastError === 'string'
        ? row.lastError.slice(0, MAX_ERROR_LENGTH)
        : null,
    createdAt: row.createdAt,
    deliveredAt: row.deliveredAt,
  };
}

function parseLimit(limit?: string): number {
  const parsed = Number.parseInt(limit ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

@Injectable()
export class PublicWebhookDeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: PublicWebhookDeliveryService
  ) {}

  async list(
    organizationId: string,
    subscriptionId: string,
    opts: { limit?: string | number; cursor?: string }
  ): Promise<{ deliveries: DeliverySummary[]; nextCursor: string | null }> {
    await this.assertOwned(organizationId, subscriptionId);
    const limit = parseLimit(
      opts.limit === undefined ? undefined : String(opts.limit)
    );
    const rows = await this.prisma.publicWebhookDelivery.findMany({
      where: { subscriptionId, organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: SUMMARY_SELECT,
    });
    const page = rows.slice(0, limit);
    return {
      deliveries: page.map(toSummary),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  async replay(
    organizationId: string,
    subscriptionId: string,
    deliveryId: string
  ): Promise<DeliverySummary> {
    await this.assertOwned(organizationId, subscriptionId);
    const original = await this.prisma.publicWebhookDelivery.findFirst({
      where: { id: deliveryId, subscriptionId, organizationId },
    });
    if (!original) throw new HttpException('Delivery not found', 404);
    if (original.status === 'PENDING') {
      throw new HttpException('Delivery is still pending', 409);
    }
    const created = await this.prisma.publicWebhookDelivery.create({
      data: {
        id: randomUUID(),
        organizationId,
        subscriptionId,
        eventId: original.eventId,
        event: original.event,
        payload: original.payload as Prisma.InputJsonValue,
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(),
      },
    });
    return this.runAndRead(organizationId, subscriptionId, created.id);
  }

  async sendTest(
    organizationId: string,
    subscriptionId: string
  ): Promise<DeliverySummary> {
    await this.assertOwned(organizationId, subscriptionId);
    const { deliveryIds } = await this.delivery.enqueue(
      organizationId,
      PUBLIC_WEBHOOK_TEST_EVENT,
      {
        message: 'This is a test event from PostSider.',
        subscriptionId,
      },
      { subscriptionId }
    );
    if (!deliveryIds.length) {
      throw new HttpException('Webhook subscription not found', 404);
    }
    return this.runAndRead(organizationId, subscriptionId, deliveryIds[0]);
  }

  private async runAndRead(
    organizationId: string,
    subscriptionId: string,
    id: string
  ): Promise<DeliverySummary> {
    const claimed = await this.delivery.claimDue({ limit: 1, ids: [id] });
    await Promise.all(claimed.map((row) => this.delivery.attempt(row)));
    const row = await this.prisma.publicWebhookDelivery.findFirst({
      where: { id, subscriptionId, organizationId },
      select: SUMMARY_SELECT,
    });
    if (!row) throw new HttpException('Delivery not found', 404);
    return toSummary(row);
  }

  private async assertOwned(organizationId: string, subscriptionId: string) {
    const found = await this.prisma.publicWebhookSubscription.findFirst({
      where: { id: subscriptionId, organizationId },
      select: { id: true },
    });
    if (!found) throw new HttpException('Webhook subscription not found', 404);
  }
}
