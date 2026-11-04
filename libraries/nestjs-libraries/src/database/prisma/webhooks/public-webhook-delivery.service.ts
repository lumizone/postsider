import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import {
  PUBLIC_WEBHOOK_TEST_EVENT,
  PublicWebhookDeliveryEvent,
  PublicWebhookEvent,
} from '@postsider/nestjs-libraries/services/public-webhook-events';
import { signWebhook } from '@postsider/nestjs-libraries/services/webhook.signature';
import { PublicWebhookSubscriptionsService } from './public-webhook-subscriptions.service';

export const WEBHOOK_BACKOFF_MS = [
  60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000,
] as const;
export const WEBHOOK_MAX_ATTEMPTS = 7;
export const WEBHOOK_LEASE_MS = 300_000;
const DISABLE_AFTER_FAILURES = 10;
const PROCESS_CONCURRENCY = 5;
const MAX_ERROR_LENGTH = 500;

export interface PublicWebhookEnvelope<T = unknown> {
  id: string;
  event: PublicWebhookDeliveryEvent;
  createdAt: string;
  organizationId: string;
  data: T;
}

export interface ClaimedDelivery {
  id: string;
  organizationId: string;
  subscriptionId: string;
  eventId: string;
  event: string;
  payload: PublicWebhookEnvelope;
  attempts: number;
  createdAt: Date;
}

export type AttemptOutcome = 'SUCCEEDED' | 'RETRY' | 'FAILED' | 'SKIPPED';

@Injectable()
export class PublicWebhookDeliveryService {
  private readonly logger = new Logger(PublicWebhookDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: PublicWebhookSubscriptionsService
  ) {}

  async deliver<T>(organizationId: string, event: PublicWebhookEvent, data: T) {
    const { eventId, deliveryIds } = await this.enqueue(
      organizationId,
      event,
      data
    );
    if (!deliveryIds.length) {
      return { eventId, attempted: 0, delivered: 0, failed: 0 };
    }
    const rows = await this.claimDue({
      limit: deliveryIds.length,
      ids: deliveryIds,
    });
    const outcomes = await Promise.all(rows.map((row) => this.attempt(row)));
    const delivered = outcomes.filter((o) => o === 'SUCCEEDED').length;
    return {
      eventId,
      attempted: deliveryIds.length,
      delivered,
      failed: deliveryIds.length - delivered,
    };
  }

  async enqueue(
    organizationId: string,
    event: PublicWebhookDeliveryEvent,
    data: unknown,
    only?: { subscriptionId: string }
  ): Promise<{ eventId: string; deliveryIds: string[] }> {
    const envelope: PublicWebhookEnvelope = {
      id: `evt_${randomUUID()}`,
      event,
      createdAt: new Date().toISOString(),
      organizationId,
      data,
    };
    const targets = await this.findTargets(organizationId, event, only);
    if (!targets.length) return { eventId: envelope.id, deliveryIds: [] };

    const now = new Date();
    const rows = targets.map((target) => ({
      id: randomUUID(),
      organizationId,
      subscriptionId: target.id,
      eventId: envelope.id,
      event,
      payload: envelope as unknown as Prisma.InputJsonValue,
      status: 'PENDING' as const,
      attempts: 0,
      nextAttemptAt: now,
    }));
    await this.prisma.publicWebhookDelivery.createMany({ data: rows });
    return { eventId: envelope.id, deliveryIds: rows.map((row) => row.id) };
  }

  async claimDue(opts: {
    limit: number;
    ids?: string[];
  }): Promise<ClaimedDelivery[]> {
    const ids = opts.ids ?? null;
    const leaseSeconds = WEBHOOK_LEASE_MS / 1000;
    return this.prisma.$queryRaw<ClaimedDelivery[]>(Prisma.sql`
      UPDATE "PublicWebhookDelivery" d
      SET "attempts" = d."attempts" + 1,
          "nextAttemptAt" = (NOW() AT TIME ZONE 'UTC') + make_interval(secs => ${leaseSeconds})
      WHERE d."id" IN (
        SELECT "id" FROM "PublicWebhookDelivery"
        WHERE "status" = 'PENDING'
          AND (
            (${ids}::text[] IS NULL
              AND "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC'))
            OR (${ids}::text[] IS NOT NULL
              AND "id" = ANY(${ids}::text[])
              AND ("attempts" = 0 OR "nextAttemptAt" <= (NOW() AT TIME ZONE 'UTC')))
          )
        ORDER BY "nextAttemptAt" ASC
        LIMIT ${opts.limit}
        FOR UPDATE SKIP LOCKED)
      RETURNING d."id", d."organizationId", d."subscriptionId", d."eventId", d."event", d."payload", d."attempts", d."createdAt"
    `);
  }

  async attempt(row: ClaimedDelivery): Promise<AttemptOutcome> {
    try {
      return await this.attemptOnce(row);
    } catch (error) {
      // Never reject: the lease expires and the worker retries the row.
      const lastError = String(error).slice(0, MAX_ERROR_LENGTH);
      this.logger.warn(
        `Public webhook delivery ${row.id} attempt crashed: ${lastError}`
      );
      await this.updateRow(row.id, { lastError });
      return 'RETRY';
    }
  }

  private async attemptOnce(row: ClaimedDelivery): Promise<AttemptOutcome> {
    const isTest = row.event === PUBLIC_WEBHOOK_TEST_EVENT;
    const subscription =
      await this.prisma.publicWebhookSubscription.findUnique({
        where: { id: row.subscriptionId },
        select: { url: true, secretVersion: true, active: true },
      });
    if (!subscription || (!subscription.active && !isTest)) {
      await this.updateRow(row.id, {
        status: 'FAILED',
        nextAttemptAt: null,
        lastError: 'subscription_inactive',
      });
      return 'SKIPPED';
    }

    const { statusCode, error } = await this.send(row, subscription);
    if (statusCode !== null && error === null) {
      await this.recordSuccess(row, statusCode, isTest);
      return 'SUCCEEDED';
    }

    const lastError =
      error !== null ? error : `HTTP ${statusCode}`.slice(0, MAX_ERROR_LENGTH);
    const permanent =
      isTest ||
      row.attempts >= WEBHOOK_MAX_ATTEMPTS ||
      (statusCode !== null &&
        statusCode >= 400 &&
        statusCode < 500 &&
        statusCode !== 429);

    if (!permanent) {
      const delay =
        WEBHOOK_BACKOFF_MS[
          Math.min(row.attempts, WEBHOOK_BACKOFF_MS.length) - 1
        ];
      await this.updateRow(row.id, {
        nextAttemptAt: new Date(Date.now() + delay),
        lastStatusCode: statusCode,
        lastError,
      });
      this.logger.warn(
        `Public webhook ${row.subscriptionId} ${row.event} attempt ${row.attempts} failed (${lastError}), retrying`
      );
      return 'RETRY';
    }

    await this.updateRow(row.id, {
      status: 'FAILED',
      nextAttemptAt: null,
      lastStatusCode: statusCode,
      lastError,
    });
    if (!isTest) {
      // A deleted subscription or transient database outage must not make
      // the delivery worker reject.
      try {
        await this.recordFailure(row.subscriptionId);
      } catch {
        this.logger.warn(
          `Public webhook ${row.subscriptionId} failed, but recording the failure also failed`
        );
      }
    }
    this.logger.warn(
      `Public webhook ${row.subscriptionId} failed ${row.event}: ${lastError}`
    );
    return 'FAILED';
  }

  async processDue(limit = 50) {
    const rows = await this.claimDue({ limit });
    const counts = { claimed: rows.length, succeeded: 0, retried: 0, failed: 0 };
    const queue = [...rows];
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        const outcome = await this.attempt(row);
        if (outcome === 'SUCCEEDED') counts.succeeded++;
        else if (outcome === 'RETRY') counts.retried++;
        else counts.failed++;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PROCESS_CONCURRENCY, rows.length) }, worker)
    );
    return counts;
  }

  private async findTargets(
    organizationId: string,
    event: PublicWebhookDeliveryEvent,
    only?: { subscriptionId: string }
  ): Promise<{ id: string }[]> {
    if (only) {
      const found = await this.prisma.publicWebhookSubscription.findUnique({
        where: { id: only.subscriptionId, organizationId },
        select: { id: true },
      });
      return found ? [found] : [];
    }
    return this.prisma.publicWebhookSubscription.findMany({
      where: { organizationId, active: true, events: { has: event } },
      select: { id: true },
    });
  }

  private async send(
    row: ClaimedDelivery,
    target: { url: string; secretVersion: string }
  ): Promise<{ statusCode: number | null; error: string | null }> {
    const body = JSON.stringify(row.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const secret = this.subscriptions.deriveSecret(
      row.subscriptionId,
      target.secretVersion
    );
    const signature = signWebhook(`${timestamp}.${body}`, secret);
    try {
      const { ssrfSafeDispatcher } = await import(
        '../../../dtos/webhooks/ssrf.safe.dispatcher'
      );
      const response = await fetch(target.url, {
        // Do not forward a signed webhook to a redirect target.
        redirect: 'error',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PostSider-Webhooks/1.0',
          'X-Webhook-Attempt': String(row.attempts),
          'X-Postsider-Event': row.event,
          'X-Postsider-Event-Id': row.eventId,
          'X-Postsider-Timestamp': timestamp,
          'X-Postsider-Signature': signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
        // @ts-ignore undici dispatcher blocks DNS rebinding / private IPs
        dispatcher: ssrfSafeDispatcher,
      });
      return {
        statusCode: response.status,
        error: response.ok ? null : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        statusCode: null,
        error: String(error).slice(0, MAX_ERROR_LENGTH),
      };
    }
  }

  private async recordSuccess(
    row: ClaimedDelivery,
    statusCode: number,
    isTest: boolean
  ) {
    // The receiving endpoint has ALREADY accepted the event. A database
    // bookkeeping failure must not turn a successful delivery into a
    // duplicate network POST.
    try {
      await this.prisma.publicWebhookDelivery.update({
        where: { id: row.id },
        data: {
          status: 'SUCCEEDED',
          deliveredAt: new Date(),
          nextAttemptAt: null,
          lastStatusCode: statusCode,
          lastError: null,
        },
      });
    } catch {
      this.logger.warn(
        `Public webhook ${row.subscriptionId} was delivered, but recording success failed`
      );
    }
    if (isTest) return;
    try {
      await this.prisma.publicWebhookSubscription.update({
        where: { id: row.subscriptionId },
        data: {
          consecutiveFailures: 0,
          lastDeliveryAt: new Date(),
          lastFailureAt: null,
        },
      });
    } catch {
      this.logger.warn(
        `Public webhook ${row.subscriptionId} was delivered, but updating its health failed`
      );
    }
  }

  private async updateRow(
    id: string,
    data: Prisma.PublicWebhookDeliveryUpdateInput
  ) {
    try {
      await this.prisma.publicWebhookDelivery.update({ where: { id }, data });
    } catch {
      // The lease expires on its own and the row is claimed again.
      this.logger.warn(`Public webhook delivery ${id} state update failed`);
    }
  }

  private async recordFailure(id: string) {
    const updated = await this.prisma.publicWebhookSubscription.update({
      where: { id },
      data: {
        consecutiveFailures: { increment: 1 },
        lastFailureAt: new Date(),
      },
      select: { consecutiveFailures: true },
    });
    if (updated.consecutiveFailures >= DISABLE_AFTER_FAILURES) {
      await this.prisma.publicWebhookSubscription.update({
        where: { id },
        data: { active: false, disabledAt: new Date() },
      });
    }
  }
}
