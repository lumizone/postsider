import { Injectable, Logger } from '@nestjs/common';
import { Polar } from '@polar-sh/sdk';
import {
  validateEvent,
  WebhookVerificationError,
} from '@polar-sh/sdk/webhooks';
import { Organization } from '@prisma/client';
import { SubscriptionService } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { BillingSubscribeDto } from '@postsider/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { pricing } from '@postsider/nestjs-libraries/database/prisma/subscriptions/pricing';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import {
  getPolarProductId,
  resolveProductRef,
  BillingTier,
  BillingPeriod,
} from '@postsider/nestjs-libraries/services/polar.products';

/**
 * Polar.sh billing provider.
 *
 * Polar is a Merchant of Record: it handles tax/VAT and is the seller of
 * record. We link a Polar customer to a PostSider organization via
 * `externalCustomerId = organizationId`, so we don't strictly need to store a
 * separate customer id — but we cache the Polar customer id in
 * `organization.paymentId` to mirror the existing Stripe flow and reuse the
 * subscription repository unchanged.
 *
 * This service intentionally mirrors the public surface of StripeService so
 * the billing controllers and SubscriptionService can switch providers with
 * minimal changes.
 */
@Injectable()
export class PolarService {
  private readonly _logger = new Logger(PolarService.name);
  private readonly _polar = new Polar({
    accessToken: process.env.POLAR_ACCESS_TOKEN || '',
    server: (process.env.POLAR_SERVER as 'sandbox' | 'production') || 'sandbox',
  });

  constructor(
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService,
    private _notificationService: NotificationService,
    private _prisma: PrismaService
  ) {}

  /**
   * Whether billing is enabled. When no access token is set, the app runs in
   * "all unlocked" mode (the permissions layer already treats a missing
   * publishable key this way).
   */
  static isEnabled() {
    return !!process.env.POLAR_ACCESS_TOKEN;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Webhooks
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Validate and parse an incoming Polar webhook using the Standard Webhooks
   * signature scheme. Throws WebhookVerificationError on an invalid signature.
   */
  validateRequest(rawBody: Buffer, headers: Record<string, string>) {
    return validateEvent(
      rawBody,
      headers,
      process.env.POLAR_WEBHOOK_SECRET || ''
    );
  }

  /**
   * Route a verified webhook event to the right handler.
   * Returns { ok: true } for events we don't care about.
   */
  async handleWebhook(event: any, webhookId?: string) {
    // Polar uses Standard Webhooks, which carries the delivery id in the
    // signed `webhook-id` header rather than the JSON event body.
    const eventId = String(webhookId || event?.id || event?.eventId || '');
    if (!eventId) throw new Error('Polar webhook has no event id');

    const existing = await this._prisma.polarWebhookEvent.findUnique({
      where: { eventId },
    });
    if (existing?.processedAt) return { ok: true, duplicate: true };

    await this._prisma.polarWebhookEvent.upsert({
      where: { eventId },
      create: {
        eventId,
        eventType: String(event?.type || 'unknown'),
        attempts: 1,
      },
      update: {},
    });

    const claim = await this._prisma.polarWebhookEvent.updateMany({
      where: {
        eventId,
        processedAt: null,
        OR: [
          { processingAt: null },
          { processingAt: { lt: new Date(Date.now() - 10 * 60 * 1000) } },
        ],
      },
      data: {
        processingAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
      },
    });
    if (claim.count !== 1) {
      throw new Error(`Polar webhook ${eventId} is already being processed`);
    }

    try {
      const result = await this.dispatchWebhook(event);
      await this._prisma.polarWebhookEvent.update({
        where: { eventId },
        data: { processedAt: new Date(), processingAt: null, lastError: null },
      });
      return result;
    } catch (error) {
      await this._prisma.polarWebhookEvent.update({
        where: { eventId },
        data: {
          attempts: { increment: 1 },
          processingAt: null,
          lastError:
            error instanceof Error
              ? error.message.slice(0, 1000)
              : 'Unknown error',
        },
      });
      throw error;
    }
  }

  private async dispatchWebhook(event: any) {
    switch (event.type) {
      case 'subscription.created':
      case 'subscription.active':
      case 'subscription.updated':
      case 'subscription.uncanceled':
      case 'subscription.canceled':
      case 'subscription.cycled':
      case 'subscription.past_due':
      case 'subscription.paused':
      case 'subscription.resumed':
      case 'subscription.revoked':
        // Polar emits subscription.canceled as soon as a customer schedules a
        // cancellation, while its status remains active until period end. Only
        // terminal statuses lose PostSider access; past_due keeps access while
        // Polar retries the payment.
        return this.hasLostSubscriptionAccess(event.data)
          ? this.onSubscriptionCanceled(event.data)
          : this.onSubscriptionUpserted(event.data);
      default:
        return { ok: true };
    }
  }

  private hasLostSubscriptionAccess(subscription: any) {
    return ['canceled', 'paused', 'unpaid', 'revoked'].includes(
      String(subscription?.status || '').toLowerCase()
    );
  }

  /**
   * Handle subscription create/active/update events. Resolves the tier from
   * the Polar product id and writes it through the existing subscription
   * repository.
   */
  private async onSubscriptionUpserted(subscription: any) {
    // Both misses below THROW instead of returning {ok:false}: the controller
    // turns a return value into HTTP 200, which Polar records as delivered and
    // NEVER retries — so an unmapped product (new tier, price change) silently
    // desynced billing: the customer paid, the org stayed FREE, and the only
    // trace was a warn line in docker logs. A 5xx makes Polar retry with
    // backoff and flag the failing webhook in its dashboard.
    const orgId = this.extractOrgId(subscription);
    if (!orgId) {
      const msg = `Polar subscription ${subscription?.id} has no resolvable organization id — cannot apply billing event`;
      this._logger.error(msg);
      throw new Error(msg);
    }

    const productId =
      subscription?.product?.id || subscription?.productId || null;
    const ref = resolveProductRef(productId);
    if (!ref) {
      const msg = `Polar product ${productId} is not mapped to a PostSider tier (check POLAR_PRODUCT_* env) — subscription ${subscription?.id} for org ${orgId} NOT applied`;
      this._logger.error(msg);
      throw new Error(msg);
    }

    // Polar status: incomplete | trialing | active | canceled | unpaid ...
    const status: string = subscription?.status || '';
    const isTrailing = status === 'trialing';

    // If the subscription is set to cancel at period end, Polar exposes
    // either `cancelAtPeriodEnd` + `currentPeriodEnd` or `endsAt`.
    const cancelAtSeconds = this.extractCancelAt(subscription);

    // Ensure we have a Polar customer id cached on the org for portal links.
    const customerId: string | undefined =
      subscription?.customer?.id || subscription?.customerId || undefined;
    if (customerId) {
      await this._subscriptionService.updateCustomerId(orgId, customerId);
    }

    // Snapshot before the upsert so we can tell a genuine plan change (worth
    // emailing the org's admins about) apart from a duplicate/retry webhook
    // delivery or an unrelated field update on the same tier — Polar can
    // resend 'subscription.updated' for reasons that aren't a tier change.
    const previous =
      await this._subscriptionService.getSubscriptionByOrganizationId(orgId);
    const planChanged =
      !previous ||
      previous.subscriptionTier !== ref.tier ||
      previous.period !== ref.period;

    await this._subscriptionService.createOrUpdateSubscription(
      isTrailing,
      subscription?.id || makeId(10),
      customerId || orgId,
      pricing[ref.tier].channel!,
      ref.tier,
      ref.period,
      cancelAtSeconds,
      undefined,
      orgId
    );

    if (planChanged) {
      await this._notificationService.notifyApprovers(
        orgId,
        'Subscription plan updated',
        `Your organization's plan is now ${
          ref.tier
        } (billed ${ref.period.toLowerCase()}).`
      );
    }

    return { ok: true };
  }

  private async onSubscriptionCanceled(subscription: any) {
    const identifier = String(subscription?.id || '');
    if (!identifier) {
      throw new Error('Polar cancellation has no subscription identifier');
    }

    // A customer can replace a canceled subscription before its terminal
    // webhook is delivered. Resolve fallback orgs through the event ID, then
    // delete atomically only when that ID is still the current subscription.
    const current = await this._subscriptionService.getSubscriptionByIdentifier(
      identifier
    );
    const orgId = this.extractOrgId(subscription) || current?.organizationId;
    if (!orgId) {
      this._logger.warn(
        `Ignoring stale Polar cancellation for subscription ${identifier}: no current matching subscription`
      );
      return { ok: true, stale: true };
    }

    const deleted =
      await this._subscriptionService.deleteSubscriptionByOrganizationIdIfCurrent(
        orgId,
        identifier
      );
    if (!deleted?.count) {
      this._logger.warn(
        `Ignoring stale Polar cancellation for subscription ${identifier}: organization ${orgId} now has a different subscription`
      );
      return { ok: true, stale: true };
    }

    return { ok: true };
  }

  /**
   * Resolve our organization id from a Polar subscription payload. We set it as
   * `externalCustomerId` on the customer and also stuff `orgId` into metadata.
   */
  private extractOrgId(subscription: any): string | null {
    return (
      subscription?.metadata?.orgId ||
      subscription?.customer?.externalId ||
      subscription?.customer?.externalCustomerId ||
      null
    );
  }

  private extractCancelAt(subscription: any): number | null {
    const ends =
      subscription?.endsAt ||
      (subscription?.cancelAtPeriodEnd ? subscription?.currentPeriodEnd : null);
    if (!ends) {
      return null;
    }
    // The repository expects seconds since epoch (it multiplies by 1000).
    return Math.floor(new Date(ends).getTime() / 1000);
  }

  // ──────────────────────────────────────────────────────────────────────
  // Checkout / subscribe
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Create a hosted checkout session and return its URL. Mirrors
   * StripeService.subscribe()'s redirect path.
   */
  async subscribe(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const productId = getPolarProductId(
      body.billing as BillingTier,
      body.period as BillingPeriod
    );
    if (!productId) {
      throw new Error(
        `No Polar product configured for ${body.billing} ${body.period}`
      );
    }

    // Change an existing Polar subscription in place. Creating another
    // checkout for the same customer would create a second recurring charge.
    if (await this.updateExistingSubscription(organizationId, productId)) {
      return {};
    }

    const org = await this._organizationService.getOrgById(organizationId);

    const checkout = await this._polar.checkouts.create({
      products: [productId],
      externalCustomerId: organizationId,
      successUrl:
        process.env.FRONTEND_URL +
        '/billing?check={CHECKOUT_ID}&onboarding=true',
      metadata: {
        service: 'postsider',
        orgId: organizationId,
        userId,
        billing: body.billing,
        period: body.period,
        uniqueId: uniqueId || makeId(10),
      },
      ...(org?.name ? { customerName: org.name } : {}),
    });

    return { url: checkout.url, id: checkout.id };
  }

  /**
   * Create an embedded checkout session and return its client secret. Mirrors
   * StripeService.embedded().
   */
  async embedded(
    uniqueId: string,
    organizationId: string,
    userId: string,
    body: BillingSubscribeDto,
    allowTrial: boolean
  ) {
    const productId = getPolarProductId(
      body.billing as BillingTier,
      body.period as BillingPeriod
    );
    if (!productId) {
      throw new Error(
        `No Polar product configured for ${body.billing} ${body.period}`
      );
    }

    // Embedded checkout must use the same duplicate-safe path as hosted
    // subscribe. Polar does not replace an existing subscription on checkout.
    if (await this.updateExistingSubscription(organizationId, productId)) {
      return {};
    }

    const checkout = await this._polar.checkouts.create({
      products: [productId],
      externalCustomerId: organizationId,
      embedOrigin: process.env.FRONTEND_URL,
      successUrl:
        process.env.FRONTEND_URL +
        '/billing?check={CHECKOUT_ID}&onboarding=true',
      metadata: {
        service: 'postsider',
        orgId: organizationId,
        userId,
        billing: body.billing,
        period: body.period,
        uniqueId: uniqueId || makeId(10),
      },
    });

    return { client_secret: checkout.clientSecret };
  }

  private async updateExistingSubscription(
    organizationId: string,
    productId: string
  ) {
    const existing = await this._subscriptionService.getSubscription(
      organizationId
    );
    if (
      !existing?.identifier ||
      existing.identifier === 'trial' ||
      existing.isLifetime
    ) {
      return false;
    }

    let updated: any;
    try {
      updated = await this._polar.subscriptions.update({
        id: existing.identifier,
        subscriptionUpdate: { productId },
      });
    } catch (err) {
      // Never create a second recurring checkout after an update failure. The
      // owner can retry once Polar is reachable; a duplicate charge is worse
      // than a temporarily failed upgrade.
      this._logger.error(
        `Could not update existing Polar subscription ${existing.identifier}: ${
          err instanceof Error ? err.message : err
        }`
      );
      throw new Error('Could not update the existing subscription');
    }

    // Keep local limits in sync immediately; the webhook is still expected
    // and is idempotent.
    await this.onSubscriptionUpserted(updated);
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  // Customer portal & management
  // ──────────────────────────────────────────────────────────────────────

  async getCustomerByOrganizationId(organizationId: string) {
    const org = await this._organizationService.getOrgById(organizationId);
    return org?.paymentId || null;
  }

  /**
   * Create a Polar Customer Portal session for an organization. Returns
   * { url } so the controller shape matches the Stripe billing portal.
   *
   * We prefer the cached Polar customer id, but fall back to the org id used
   * as `externalCustomerId` during checkout.
   */
  async createBillingPortalLink(
    customerId: string | null,
    organizationId?: string
  ) {
    try {
      const session = await this._polar.customerSessions.create(
        customerId ? { customerId } : { externalCustomerId: organizationId! }
      );
      return { url: session.customerPortalUrl };
    } catch (err) {
      this._logger.warn(
        `Could not create Polar customer portal session: ${
          err instanceof Error ? err.message : err
        }`
      );
      return { url: process.env.FRONTEND_URL + '/billing' };
    }
  }

  /**
   * Cancel a subscription at period end (toggle off auto-renew). Used by the
   * user-initiated "cancel" action.
   */
  async setToCancel(organizationId: string) {
    const id = makeId(10);
    const sub = await this._subscriptionService.getSubscription(organizationId);
    if (!sub?.identifier) {
      return { id, cancel_at: new Date() };
    }
    if (sub.identifier === 'trial') {
      return { id, cancel_at: sub.cancelAt || new Date() };
    }

    const updated = await this._polar.subscriptions.update({
      id: sub.identifier,
      subscriptionUpdate: { cancelAtPeriodEnd: true },
    });

    const endsAt =
      (updated as any)?.endsAt || (updated as any)?.currentPeriodEnd;
    return {
      id,
      cancel_at: endsAt ? new Date(endsAt) : undefined,
    };
  }

  /**
   * Cancel the org's real Polar subscription as part of deleting the org
   * itself. Best-effort and never throws: account deletion is irreversible
   * local state (the caller runs it right before wiping the org's rows) and
   * must not be blocked by a Polar API hiccup — but a swallowed failure here
   * would leave the customer billed forever with no PostSider org left to
   * manage or even see it from, so a failure is logged loudly instead.
   * No-ops for trial/lifetime/no-subscription orgs, same as subscribe()'s
   * upgrade guard — there is no real Polar subscription to revoke there.
   */
  async cancelActiveSubscriptionBestEffort(organizationId: string) {
    const sub = await this._subscriptionService.getSubscription(organizationId);
    if (!sub?.identifier || sub.identifier === 'trial' || sub.isLifetime) {
      return;
    }
    try {
      await this._polar.subscriptions.revoke({ id: sub.identifier });
    } catch (err) {
      this._logger.error(
        `Account deletion for org ${organizationId} could not cancel its Polar subscription ${
          sub.identifier
        } — it may keep billing the customer and needs manual cancellation in the Polar dashboard: ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  /**
   * Immediately revoke a subscription (admin action).
   */
  async cancelSubscription(organizationId: string) {
    const sub = await this._subscriptionService.getSubscription(organizationId);
    if (!sub?.identifier) {
      throw new Error('No active subscription found');
    }
    if (sub.identifier === 'trial') {
      return { cancelled: true };
    }
    await this._polar.subscriptions.revoke({ id: sub.identifier });
    // A webhook or plan change can replace the local row while Polar revokes
    // the subscription. Only remove the exact identifier that was revoked.
    await this._subscriptionService.deleteSubscriptionByOrganizationIdIfCurrent(
      organizationId,
      sub.identifier
    );
    return { cancelled: true };
  }

  // ──────────────────────────────────────────────────────────────────────
  // Plan listing
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Return the configured plans with their pricing. Polar product prices live
   * in the dashboard, but we expose the local `pricing` table so the frontend
   * has display data without extra round-trips.
   */
  async getPackages() {
    const tiers: BillingTier[] = ['STANDARD', 'TEAM', 'PRO', 'ULTIMATE'];
    const month = tiers
      .filter((t) => getPolarProductId(t, 'MONTHLY'))
      .map((t) => ({
        name: t,
        recurring: 'month',
        price: pricing[t].month_price,
      }));
    const year = tiers
      .filter((t) => getPolarProductId(t, 'YEARLY'))
      .map((t) => ({
        name: t,
        recurring: 'year',
        price: pricing[t].year_price,
      }));

    return { month, year };
  }

  /**
   * Check whether a checkout completed for this org. Returns:
   *   2 — subscription is already provisioned in our DB
   *   1 — checkout exists but not yet provisioned (still processing)
   *   0 — nothing found
   */
  async checkSubscription(organizationId: string, checkoutId: string) {
    let resultingSubscriptionId: string | null = null;
    try {
      const checkout = await this._polar.checkouts.get({ id: checkoutId });
      const checkoutOrgId =
        (checkout as any)?.externalCustomerId ||
        (checkout as any)?.metadata?.orgId ||
        null;
      // A checkout id is user-supplied. Never report another organization's
      // checkout as the current org's billing result.
      if (checkoutOrgId !== organizationId) {
        return 0;
      }
      resultingSubscriptionId = (checkout as any)?.subscriptionId || null;
      const sub = await this._subscriptionService.getSubscription(
        organizationId
      );
      // On a plain first-time subscribe there is no prior subscription, so
      // any subscription showing up means THIS checkout provisioned it. But
      // on an upgrade the org can already have an older subscription while
      // this checkout's webhook hasn't landed yet — match it to the
      // checkout's own resulting subscription id when Polar gives us one, so
      // we don't report "done" against the stale pre-upgrade tier.
      if (
        sub &&
        (!resultingSubscriptionId || sub.identifier === resultingSubscriptionId)
      ) {
        return 2;
      }
      if (
        checkout?.status === 'confirmed' ||
        checkout?.status === 'succeeded'
      ) {
        return 1;
      }
    } catch (err) {
      return 0;
    }
    return 0;
  }
}

export { WebhookVerificationError };
