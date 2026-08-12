import { Injectable } from '@nestjs/common';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { InboundSubscriptionRepository } from '@postsider/nestjs-libraries/database/prisma/inbound/inbound-subscription.repository';
import {
  signWebhook,
  WEBHOOK_SIGNATURE_HEADER,
} from '@postsider/nestjs-libraries/services/webhook.signature';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import { ssrfSafeDispatcher } from '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

const MAX_DELIVERY_ATTEMPTS = 3;

@Injectable()
export class InboundService {
  constructor(
    private _repository: InboundSubscriptionRepository,
    private _auditLogger: AuditLogger
  ) {}

  /**
   * Create an inbound event subscription with a freshly generated per-
   * subscription HMAC secret (Requirement 19.2). The secret is returned once.
   */
  async subscribe(
    organizationId: string,
    sources: string[],
    webhookUrl: string
  ) {
    const secret = 'whsec_' + makeId(40);
    const created = await this._repository.create(
      organizationId,
      sources,
      webhookUrl,
      secret
    );
    return { ...created, secret };
  }

  list(organizationId: string) {
    return this._repository.listByOrg(organizationId);
  }

  revoke(organizationId: string, id: string) {
    return this._repository.revoke(organizationId, id);
  }

  /**
   * Deliver an inbound event to every matching subscription with an HMAC
   * signature header, retrying with exponential backoff (Requirement 19.4).
   * Each attempt is recorded in the audit log.
   */
  async dispatch(
    organizationId: string,
    source: string,
    event: unknown,
    correlationId: string
  ): Promise<void> {
    const subscriptions = await this._repository.findActiveForSource(
      organizationId,
      source
    );
    const body = JSON.stringify(event);

    await Promise.all(
      subscriptions.map(async (sub) => {
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = signWebhook(`${timestamp}.${body}`, sub.secret);
        for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt++) {
          let status = 'error';
          try {
            const res = await fetch(sub.webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                [WEBHOOK_SIGNATURE_HEADER]: signature,
                'X-Postsider-Event': 'inbound.event',
                'X-Postsider-Timestamp': String(timestamp),
                'X-Webhook-Attempt': String(attempt + 1),
              },
              body,
              // Block SSRF to internal / link-local addresses (parity with the
              // outbound webhooks controller). undici option, not in fetch types.
              // @ts-ignore
              dispatcher: ssrfSafeDispatcher,
              signal: AbortSignal.timeout(10000),
            });
            status = res.ok ? 'ok' : `http_${res.status}`;
            await this._auditLogger.log({
              organizationId,
              operation: 'inbound.deliver',
              connectorId: source,
              correlationId,
              status,
              type: 'webhook_delivery',
            });
            if (res.ok || res.status < 500) return; // success or client error
          } catch {
            await this._auditLogger.log({
              organizationId,
              operation: 'inbound.deliver',
              connectorId: source,
              correlationId,
              status: 'network_error',
              type: 'webhook_delivery',
            });
          }
          if (attempt < MAX_DELIVERY_ATTEMPTS - 1) {
            await new Promise((r) =>
              setTimeout(r, 1000 * Math.pow(2, attempt))
            );
          }
        }
      })
    );
  }
}
