import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { PublicWebhookEvent } from '@postsider/nestjs-libraries/services/public-webhook-events';
import { signWebhook } from '@postsider/nestjs-libraries/services/webhook.signature';
import { PublicWebhookSubscriptionsService } from './public-webhook-subscriptions.service';

const MAX_ATTEMPTS = 3;
const DISABLE_AFTER_FAILURES = 10;

export interface PublicWebhookEnvelope<T = unknown> {
  id: string;
  event: PublicWebhookEvent;
  createdAt: string;
  organizationId: string;
  data: T;
}

@Injectable()
export class PublicWebhookDeliveryService {
  private readonly logger = new Logger(PublicWebhookDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: PublicWebhookSubscriptionsService
  ) {}

  async deliver<T>(organizationId: string, event: PublicWebhookEvent, data: T) {
    const targets = await this.prisma.publicWebhookSubscription.findMany({
      where: { organizationId, active: true, events: { has: event } },
      select: {
        id: true,
        url: true,
        secretVersion: true,
      },
    });

    const envelope: PublicWebhookEnvelope<T> = {
      id: `evt_${randomUUID()}`,
      event,
      createdAt: new Date().toISOString(),
      organizationId,
      data,
    };
    const outcomes = await Promise.all(
      targets.map((target) => this.deliverToTarget(target, envelope))
    );
    return {
      eventId: envelope.id,
      attempted: targets.length,
      delivered: outcomes.filter(Boolean).length,
      failed: outcomes.filter((outcome) => !outcome).length,
    };
  }

  private async deliverToTarget(
    target: { id: string; url: string; secretVersion: string },
    envelope: PublicWebhookEnvelope
  ) {
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const secret = this.subscriptions.deriveSecret(
      target.id,
      target.secretVersion
    );
    const signature = signWebhook(`${timestamp}.${body}`, secret);
    const { ssrfSafeDispatcher } = await import(
      '../../../dtos/webhooks/ssrf.safe.dispatcher'
    );
    let lastOutcome = 'unknown error';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(target.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'PostSider-Webhooks/1.0',
            'X-Webhook-Attempt': String(attempt),
            'X-Postsider-Event': envelope.event,
            'X-Postsider-Event-Id': envelope.id,
            'X-Postsider-Timestamp': timestamp,
            'X-Postsider-Signature': signature,
          },
          body,
          signal: AbortSignal.timeout(10_000),
          // @ts-ignore undici dispatcher adds DNS rebinding / private-IP protection
          dispatcher: ssrfSafeDispatcher,
        });

        if (response.ok) {
          await this.recordSuccess(target.id);
          return true;
        }

        lastOutcome = `HTTP ${response.status}`;
        if (response.status !== 429 && response.status < 500) break;
      } catch (error) {
        lastOutcome = String(error);
      }

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1_000 * Math.pow(2, attempt - 1))
        );
      }
    }

    await this.recordFailure(target.id);
    this.logger.warn(
      `Public webhook ${target.id} failed ${envelope.event}: ${lastOutcome}`
    );
    return false;
  }

  private recordSuccess(id: string) {
    return this.prisma.publicWebhookSubscription.update({
      where: { id },
      data: {
        consecutiveFailures: 0,
        lastDeliveryAt: new Date(),
        lastFailureAt: null,
      },
    });
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
