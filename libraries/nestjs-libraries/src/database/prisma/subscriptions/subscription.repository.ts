import { Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaService,
} from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import dayjs from 'dayjs';
import { Organization, Role } from '@prisma/client';
import {
  TRIAL_X_POSTS_LIMIT,
  TRIAL_X_RESERVATION_TTL_MS,
  TRIAL_X_RESERVATION_TYPE,
} from './trial.x.limit';

const MONTHLY_POST_RESERVATION_TYPE = 'monthly_post_reservation';
const MONTHLY_POST_RESERVATION_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class SubscriptionRepository {
  constructor(
    private readonly _subscription: PrismaRepository<'subscription'>,
    private readonly _organization: PrismaRepository<'organization'>,
    private readonly _user: PrismaRepository<'user'>,
    private readonly _credits: PrismaRepository<'credits'>,
    private _usedCodes: PrismaRepository<'usedCodes'>,
    private readonly _prisma: PrismaService
  ) {}

  getUserAccount(userId: string) {
    return this._user.model.user.findFirst({
      where: {
        id: userId,
      },
      select: {
        account: true,
        connectedAccount: true,
      },
    });
  }

  getCode(code: string) {
    return this._usedCodes.model.usedCodes.findFirst({
      where: {
        code,
      },
    });
  }

  updateAccount(userId: string, account: string) {
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        account,
      },
    });
  }

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  updateConnectedStatus(account: string, accountCharges: boolean) {
    return this._user.model.user.updateMany({
      where: {
        account,
      },
      data: {
        connectedAccount: accountCharges,
      },
    });
  }

  getCustomerIdByOrgId(organizationId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        id: organizationId,
      },
      select: {
        paymentId: true,
      },
    });
  }

  checkSubscription(organizationId: string, subscriptionId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        identifier: subscriptionId,
        deletedAt: null,
      },
    });
  }

  deleteSubscriptionByCustomerId(customerId: string) {
    return this._prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findFirst({
        where: { paymentId: customerId },
        select: { id: true },
      });
      if (!organization) return { count: 0 };

      return this.deleteSubscriptionAndDisableChannels(tx, organization.id);
    });
  }

  deleteSubscriptionByOrgId(organizationId: string) {
    return this._prisma.$transaction((tx) =>
      this.deleteSubscriptionAndDisableChannels(tx, organizationId)
    );
  }

  deleteSubscriptionByOrgIdIfCurrent(organizationId: string, identifier: string) {
    return this._prisma.$transaction((tx) =>
      this.deleteSubscriptionAndDisableChannels(tx, organizationId, identifier)
    );
  }

  private async deleteSubscriptionAndDisableChannels(
    tx: any,
    organizationId: string,
    identifier?: string
  ) {
    // Plan changes and channel activation share this lock. Removing paid
    // entitlement and disabling channels must be one decision.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:channel-capacity`}))`;
    const where = {
      organizationId,
      isLifetime: false,
      ...(identifier ? { identifier, deletedAt: null } : {}),
    };
    const subscription = await tx.subscription.findFirst({
      where,
      select: { subscriptionTier: true },
    });
    const deleted = await tx.subscription.deleteMany({
      where,
    });
    if (deleted.count === 0) return deleted;
    await tx.integration.updateMany({
      where: {
        organizationId,
        deletedAt: null,
        disabled: false,
      },
      data: { disabled: true, revision: { increment: 1 } },
    });
    if (['TEAM', 'PRO', 'ULTIMATE'].includes(subscription?.subscriptionTier)) {
      await tx.userOrganization.updateMany({
        where: {
          organizationId,
          role: { not: Role.SUPERADMIN },
        },
        data: { disabled: true },
      });
    }
    return deleted;
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: organizationId,
      },
      data: {
        paymentId: customerId,
      },
    });
  }

  async getSubscriptionByOrgId(orgId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId: orgId,
      },
    });
  }

  async getSubscriptionByCustomerId(customerId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organization: {
          paymentId: customerId,
        },
      },
    });
  }

  async getOrganizationByCustomerId(customerId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        paymentId: customerId,
      },
    });
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
    org?: { id: string }
  ) {
    const findOrg =
      org || (await this.getOrganizationByCustomerId(customerId))!;

    if (!findOrg) {
      return;
    }

    return this._prisma.$transaction(async (tx) => {
      // This is deliberately the same lock used by connect, reconnect, and
      // enable. The new entitlement and disabled excess must become visible as
      // one decision, never as a stale paid limit followed by a downgrade.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${findOrg.id}:channel-capacity`}))`;
      const subscription = await tx.subscription.upsert({
        where: { organizationId: findOrg.id },
        update: {
          subscriptionTier: billing,
          totalChannels,
          period,
          identifier,
          isLifetime: !!code,
          cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
          deletedAt: null,
        },
        create: {
          organizationId: findOrg.id,
          subscriptionTier: billing,
          isLifetime: !!code,
          totalChannels,
          period,
          cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
          identifier,
          deletedAt: null,
        },
      });

      const activeChannels = await tx.integration.count({
        where: {
          organizationId: findOrg.id,
          deletedAt: null,
          disabled: false,
        },
      });
      const excess = Math.max(0, activeChannels - totalChannels);
      if (excess) {
        const channels = await tx.integration.findMany({
          where: {
            organizationId: findOrg.id,
            deletedAt: null,
            disabled: false,
          },
          take: excess,
          select: { id: true },
        });
        await tx.integration.updateMany({
          where: { id: { in: channels.map((channel) => channel.id) } },
          data: { disabled: true, revision: { increment: 1 } },
        });
      }

      await tx.organization.update({
        where: { id: findOrg.id },
        data: { isTrailing, allowTrial: false },
      });

      if (code) {
        await tx.usedCodes.create({ data: { code, orgId: findOrg.id } });
      }

      return subscription;
    });
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        identifier,
        deletedAt: null,
      },
      include: {
        organization: true,
      },
    });
  }

  getSubscription(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  async getCreditsFrom(
    organizationId: string,
    from: dayjs.Dayjs,
    type = 'ai_images'
  ) {
    const load = await this._credits.model.credits.groupBy({
      by: ['organizationId'],
      where: {
        organizationId,
        type,
        createdAt: {
          gte: from.toDate(),
        },
      },
      _sum: {
        credits: true,
      },
    });

    return load?.[0]?._sum?.credits || 0;
  }

  async useCredit<T>(
    org: Organization,
    type = 'ai_images',
    func: () => Promise<T>
  ) {
    const data = await this._credits.model.credits.create({
      data: {
        organizationId: org.id,
        credits: 1,
        type,
      },
    });

    try {
      return await func();
    } catch (err) {
      await this._credits.model.credits.delete({
        where: {
          id: data.id,
        },
      });
      throw err;
    }
  }

  async reserveCredits(
    organizationId: string,
    type: string,
    from: Date,
    amount: number,
    limit: number
  ) {
    return this._prisma.$transaction(async (tx) => {
      // Serialize aggregate-and-insert for this organization and usage type.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:${type}`}))`;
      const used = await tx.credits.aggregate({
        where: { organizationId, type, createdAt: { gte: from } },
        _sum: { credits: true },
      });
      if ((used._sum.credits || 0) + amount > limit) return null;
      return tx.credits.create({
        data: { organizationId, type, credits: amount },
      });
    });
  }

  refundCredit(id: string) {
    return this._credits.model.credits.delete({ where: { id } });
  }

  refundCredits(id: string, amount: number) {
    if (amount <= 0) return Promise.resolve();
    return this._credits.model.credits.update({
      where: { id },
      data: { credits: { decrement: amount } },
    });
  }

  async reserveTrialXPosts(organizationId: string, from: Date, amount: number) {
    const pendingSince = new Date(Date.now() - TRIAL_X_RESERVATION_TTL_MS);
    return this._prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:${TRIAL_X_RESERVATION_TYPE}`}))`;
      const [existing, pending] = await Promise.all([
        tx.post.count({
          where: {
            organizationId,
            createdAt: { gte: from },
            parentPostId: null,
            integration: { providerIdentifier: 'x' },
          },
        }),
        tx.credits.aggregate({
          where: {
            organizationId,
            type: TRIAL_X_RESERVATION_TYPE,
            createdAt: { gte: pendingSince },
          },
          _sum: { credits: true },
        }),
      ]);
      if (existing + (pending._sum.credits || 0) + amount > TRIAL_X_POSTS_LIMIT) {
        return null;
      }
      return tx.credits.create({
        data: {
          organizationId,
          type: TRIAL_X_RESERVATION_TYPE,
          credits: amount,
        },
      });
    });
  }

  async reserveMonthlyPostSlots(organizationId: string, from: Date, amount: number, limit: number) {
    const pendingSince = new Date(Date.now() - MONTHLY_POST_RESERVATION_TTL_MS);
    return this._prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:${MONTHLY_POST_RESERVATION_TYPE}`}))`;
      const [existing, pending] = await Promise.all([
        tx.post.count({
          where: {
            organizationId,
            publishDate: { gte: from },
            OR: [
              { deletedAt: null, state: { in: ['QUEUE'] } },
              { state: 'PUBLISHED' },
            ],
          },
        }),
        tx.credits.aggregate({
          where: {
            organizationId,
            type: MONTHLY_POST_RESERVATION_TYPE,
            createdAt: { gte: pendingSince },
          },
          _sum: { credits: true },
        }),
      ]);
      if (existing + (pending._sum.credits || 0) + amount > limit) return null;
      return tx.credits.create({
        data: { organizationId, type: MONTHLY_POST_RESERVATION_TYPE, credits: amount },
      });
    });
  }

  setCustomerId(orgId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        paymentId: customerId,
      },
    });
  }
}
