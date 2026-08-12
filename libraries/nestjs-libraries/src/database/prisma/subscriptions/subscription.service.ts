import { Injectable } from '@nestjs/common';
import { pricing } from '@postsider/nestjs-libraries/database/prisma/subscriptions/pricing';
import { SubscriptionRepository } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { Organization } from '@prisma/client';
import dayjs from 'dayjs';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';

export class AiQuotaExceededError extends Error {}
export class TrialUsageLimitError extends Error {}

const AI_TEXT_CREDIT_TYPE = 'ai_text';
const TRIAL_AI_USES_PER_MONTH = 10;

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly _subscriptionRepository: SubscriptionRepository,
    private readonly _integrationService: IntegrationService,
    private readonly _organizationService: OrganizationService
  ) {}

  async getSubscriptionByOrganizationId(organizationId: string) {
    const subscription =
      await this._subscriptionRepository.getSubscriptionByOrganizationId(
        organizationId
      );
    // A local free trial whose cancelAt has passed has ended — treat the org as
    // having no active plan (it drops to FREE) so trial limits stop applying.
    // Scoped to `identifier === 'trial'` so Polar-managed subscriptions are left
    // entirely to Polar's own webhook lifecycle.
    if (
      subscription?.identifier === 'trial' &&
      subscription.cancelAt &&
      subscription.cancelAt.getTime() < Date.now()
    ) {
      return null;
    }
    return subscription;
  }

  useCredit<T>(
    organization: Organization,
    type = 'ai_images',
    func: () => Promise<T>
  ): Promise<T> {
    return this._subscriptionRepository.useCredit(organization, type, func);
  }

  getCode(code: string) {
    return this._subscriptionRepository.getCode(code);
  }

  async deleteSubscription(customerId: string) {
    // modifySubscription refuses to touch a lifetime (code-redeemed)
    // subscription and returns false — deleting the row here too would undo
    // that protection the moment a matching customerId shows up (e.g. a
    // Polar cancellation webhook for an org that also happens to hold a
    // manually-granted lifetime plan).
    const modified = await this.modifySubscription(
      customerId,
      pricing.FREE.channel || 0,
      'FREE'
    );
    if (!modified) {
      return;
    }
    return this._subscriptionRepository.deleteSubscriptionByCustomerId(
      customerId
    );
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._subscriptionRepository.updateCustomerId(
      organizationId,
      customerId
    );
  }

  async checkSubscription(organizationId: string, subscriptionId: string) {
    return await this._subscriptionRepository.checkSubscription(
      organizationId,
      subscriptionId
    );
  }

  async modifySubscriptionByOrg(
    organizationId: string,
    totalChannels: number,
    billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE'
  ) {
    if (!organizationId) {
      return false;
    }

    const getCurrentSubscription =
      (await this._subscriptionRepository.getSubscriptionByOrgId(
        organizationId
      ))!;

    // An unknown persisted tier must not produce `undefined` and NPE on the
    // team_members comparisons below — fall back to FREE.
    const from =
      pricing[getCurrentSubscription?.subscriptionTier || 'FREE'] ??
      pricing.FREE;
    const to = pricing[billing] ?? pricing.FREE;

    const currentTotalChannels = (
      await this._integrationService.getIntegrationsList(organizationId)
    ).filter((f) => !f.disabled);

    if (currentTotalChannels.length > totalChannels) {
      await this._integrationService.disableIntegrations(
        organizationId,
        currentTotalChannels.length - totalChannels
      );
    }

    if (from.team_members && !to.team_members) {
      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        organizationId,
        true
      );
    }

    if (!from.team_members && to.team_members) {
      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        organizationId,
        false
      );
    }

    if (billing === 'FREE') {
      await this._integrationService.changeActiveCron(organizationId);
      await this._subscriptionRepository.deleteSubscriptionByOrgId(
        organizationId
      );
    }

    return true;
  }

  async modifySubscription(
    customerId: string,
    totalChannels: number,
    billing: 'FREE' | 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE'
  ) {
    if (!customerId) {
      return false;
    }

    const getOrgByCustomerId =
      await this._subscriptionRepository.getOrganizationByCustomerId(
        customerId
      );

    const getCurrentSubscription =
      (await this._subscriptionRepository.getSubscriptionByCustomerId(
        customerId
      ))!;

    if (
      !getOrgByCustomerId ||
      (getCurrentSubscription && getCurrentSubscription?.isLifetime)
    ) {
      return false;
    }

    // An unknown persisted tier must not produce `undefined` and NPE on the
    // team_members comparisons below — fall back to FREE.
    const from =
      pricing[getCurrentSubscription?.subscriptionTier || 'FREE'] ??
      pricing.FREE;
    const to = pricing[billing] ?? pricing.FREE;

    const currentTotalChannels = (
      await this._integrationService.getIntegrationsList(
        getOrgByCustomerId?.id!
      )
    ).filter((f) => !f.disabled);

    if (currentTotalChannels.length > totalChannels) {
      await this._integrationService.disableIntegrations(
        getOrgByCustomerId?.id!,
        currentTotalChannels.length - totalChannels
      );
    }

    if (from.team_members && !to.team_members) {
      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        getOrgByCustomerId?.id!,
        true
      );
    }

    if (!from.team_members && to.team_members) {
      await this._organizationService.disableOrEnableNonSuperAdminUsers(
        getOrgByCustomerId?.id!,
        false
      );
    }

    if (billing === 'FREE') {
      await this._integrationService.changeActiveCron(getOrgByCustomerId?.id!);
    }

    return true;
  }

  async createOrUpdateSubscription(
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    code?: string,
    org?: string
  ) {
    if (!code) {
      try {
        const load = org
          ? await this.modifySubscriptionByOrg(
              org,
              totalChannels,
              billing
            )
          : await this.modifySubscription(customerId, totalChannels, billing);
        if (!load) {
          return {};
        }
      } catch (e) {
        return {};
      }
    }
    return this._subscriptionRepository.createOrUpdateSubscription(
      isTrailing,
      identifier,
      customerId,
      totalChannels,
      billing,
      period,
      cancelAt,
      code,
      org ? { id: org } : undefined
    );
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscriptionRepository.getSubscriptionByIdentifier(identifier);
  }

  async getSubscription(organizationId: string) {
    const subscription = await this._subscriptionRepository.getSubscription(
      organizationId
    );
    // Same expired-trial rule as getSubscriptionByOrganizationId above. This
    // path gates PUBLISHING (post.activity), which used to keep honoring an
    // expired trial while the rest of the app already treated the org as FREE.
    if (
      subscription?.identifier === 'trial' &&
      subscription.cancelAt &&
      subscription.cancelAt.getTime() < Date.now()
    ) {
      return null;
    }
    return subscription;
  }

  async checkCredits(organization: Organization, checkType = 'ai_images') {
    // @ts-ignore
    const type = organization?.subscription?.subscriptionTier || 'FREE';

    if (type === 'FREE') {
      return { credits: 0 };
    }

    // @ts-ignore
    let date = dayjs(organization.subscription.createdAt);
    while (date.isBefore(dayjs())) {
      date = date.add(1, 'month');
    }

    const checkFromMonth = date.subtract(1, 'month');
    const imageGenerationCount =
      checkType === 'ai_images'
        ? pricing[type].image_generation_count
        : pricing[type].generate_videos;

    const totalUse = await this._subscriptionRepository.getCreditsFrom(
      organization.id,
      checkFromMonth,
      checkType
    );

    return {
      credits: imageGenerationCount - totalUse,
    };
  }

  private aiPeriodStart(createdAt: Date) {
    let date = dayjs(createdAt);
    while (date.add(1, 'month').isBefore(dayjs())) {
      date = date.add(1, 'month');
    }
    return date.toDate();
  }

  private aiPeriod(createdAt: Date) {
    const startsAt = this.aiPeriodStart(createdAt);
    return { startsAt, renewsAt: dayjs(startsAt).add(1, 'month').toDate() };
  }

  async getAiQuota(organizationId: string) {
    const subscription = await this.getSubscriptionByOrganizationId(organizationId);
    const tier = subscription?.subscriptionTier || 'FREE';
    const isTrial = subscription?.identifier === 'trial';
    const limit = isTrial
      ? TRIAL_AI_USES_PER_MONTH
      : pricing[tier]?.ai_uses_per_month ?? 0;
    const period = this.aiPeriod(subscription?.createdAt || new Date());
    const used = await this._subscriptionRepository.getCreditsFrom(
      organizationId,
      dayjs(period.startsAt),
      AI_TEXT_CREDIT_TYPE
    );

    return {
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
      renewsAt: period.renewsAt,
    };
  }

  async useAiCredits<T>(organizationId: string, amount: number, func: () => Promise<T>) {
    const subscription = await this.getSubscriptionByOrganizationId(organizationId);
    const tier = subscription?.subscriptionTier || 'FREE';
    const limit = subscription?.identifier === 'trial'
      ? TRIAL_AI_USES_PER_MONTH
      : pricing[tier]?.ai_uses_per_month ?? 0;
    if (limit === null) return func();

    const credit = await this._subscriptionRepository.reserveCredits(
      organizationId,
      AI_TEXT_CREDIT_TYPE,
      this.aiPeriodStart(subscription?.createdAt || new Date()),
      amount,
      limit
    );
    if (!credit) throw new AiQuotaExceededError('Monthly AI limit reached');

    try {
      return await func();
    } catch (error) {
      await this._subscriptionRepository.refundCredit(credit.id);
      throw error;
    }
  }

  async reserveAiCredits(organizationId: string, amount: number) {
    const subscription = await this.getSubscriptionByOrganizationId(organizationId);
    const tier = subscription?.subscriptionTier || 'FREE';
    const limit = subscription?.identifier === 'trial'
      ? TRIAL_AI_USES_PER_MONTH
      : pricing[tier]?.ai_uses_per_month ?? 0;
    if (limit === null) return null;

    const credit = await this._subscriptionRepository.reserveCredits(
      organizationId,
      AI_TEXT_CREDIT_TYPE,
      this.aiPeriodStart(subscription?.createdAt || new Date()),
      amount,
      limit
    );
    if (!credit) throw new AiQuotaExceededError('Monthly AI limit reached');
    return credit.id;
  }

  releaseAiCredits(id: string | null, amount: number) {
    return id ? this._subscriptionRepository.refundCredits(id, amount) : undefined;
  }

  async reserveTrialXPosts(organizationId: string, amount: number) {
    if (!amount) return null;
    const subscription = await this.getSubscriptionByOrganizationId(organizationId);
    if (subscription?.identifier !== 'trial') return null;

    const reservation = await this._subscriptionRepository.reserveTrialXPosts(
      organizationId,
      subscription.createdAt,
      amount
    );
    if (!reservation) throw new TrialUsageLimitError('Trial usage limit reached');
    return reservation.id;
  }

  releaseTrialXReservation(id: string | null) {
    return id ? this._subscriptionRepository.refundCredit(id) : undefined;
  }

  async addSubscription(orgId: string, userId: string, subscription: any) {
    await this._subscriptionRepository.setCustomerId(orgId, userId);
    return this.createOrUpdateSubscription(
      false,
      makeId(5),
      userId,
      pricing[subscription].channel!,
      subscription,
      'MONTHLY',
      null,
      undefined,
      orgId
    );
  }
}
