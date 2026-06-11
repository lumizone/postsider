import { Injectable, Logger } from '@nestjs/common';
import { Polar } from '@polar-sh/sdk';
import {
  validateEvent,
  WebhookVerificationError,
} from '@polar-sh/sdk/webhooks';
import { Organization } from '@prisma/client';
import { SubscriptionService } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { BillingSubscribeDto } from '@postsider/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { pricing } from '@postsider/nestjs-libraries/database/prisma/subscriptions/pricing';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
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
    server:
      (process.env.POLAR_SERVER as 'sandbox' | 'production') || 'sandbox',
  });

  constructor(
    private _subscriptionService: SubscriptionService,
    private _organizationService: OrganizationService
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
  async handleWebhook(event: any) {
    switch (event.type) {
      case 'subscription.created':
      case 'subscription.active':
      case 'subscription.updated':
      case 'subscription.uncanceled':
        return this.onSubscriptionUpserted(event.data);
      case 'subscription.canceled':
      case 'subscription.revoked':
        return this.onSubscriptionCanceled(event.data);
      default:
        return { ok: true };
    }
  }

  /**
   * Handle subscription create/active/update events. Resolves the tier from
   * the Polar product id and writes it through the existing subscription
   * repository.
   */
  private async onSubscriptionUpserted(subscription: any) {
    const orgId = this.extractOrgId(subscription);
    if (!orgId) {
      this._logger.warn(
        `Polar subscription ${subscription?.id} has no resolvable organization id`
      );
      return { ok: false };
    }

    const productId =
      subscription?.product?.id || subscription?.productId || null;
    const ref = resolveProductRef(productId);
    if (!ref) {
      this._logger.warn(
        `Polar product ${productId} is not mapped to a PostSider tier`
      );
      return { ok: false };
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

    return { ok: true };
  }

  private async onSubscriptionCanceled(subscription: any) {
    const orgId = this.extractOrgId(subscription);
    const customerId: string | undefined =
      subscription?.customer?.id || subscription?.customerId || undefined;

    if (customerId) {
      await this._subscriptionService.deleteSubscription(customerId);
      return { ok: true };
    }

    // Fall back to downgrading by org if no customer id is present.
    if (orgId) {
      await this._subscriptionService.modifySubscriptionByOrg(
        orgId,
        pricing.FREE.channel || 0,
        'FREE'
      );
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
      (subscription?.cancelAtPeriodEnd
        ? subscription?.currentPeriodEnd
        : null);
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
        customerId
          ? { customerId }
          : { externalCustomerId: organizationId! }
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

    const updated = await this._polar.subscriptions.update({
      id: sub.identifier,
      subscriptionUpdate: { cancelAtPeriodEnd: true },
    });

    const endsAt = (updated as any)?.endsAt || (updated as any)?.currentPeriodEnd;
    return {
      id,
      cancel_at: endsAt ? new Date(endsAt) : undefined,
    };
  }

  /**
   * Immediately revoke a subscription (admin action).
   */
  async cancelSubscription(organizationId: string) {
    const sub = await this._subscriptionService.getSubscription(organizationId);
    if (!sub?.identifier) {
      throw new Error('No active subscription found');
    }
    await this._polar.subscriptions.revoke({ id: sub.identifier });
    if (sub.organizationId) {
      const customerId = await this.getCustomerByOrganizationId(organizationId);
      if (customerId) {
        await this._subscriptionService.deleteSubscription(customerId);
      }
    }
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
    const sub = await this._subscriptionService.getSubscription(organizationId);
    if (sub) {
      return 2;
    }
    try {
      const checkout = await this._polar.checkouts.get({ id: checkoutId });
      if (checkout?.status === 'confirmed' || checkout?.status === 'succeeded') {
        return 1;
      }
    } catch (err) {
      return 0;
    }
    return 0;
  }
}

export { WebhookVerificationError };
