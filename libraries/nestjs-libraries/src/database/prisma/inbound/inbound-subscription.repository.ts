import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class InboundSubscriptionRepository {
  constructor(
    private _subscription: PrismaRepository<'inboundEventSubscription'>
  ) {}

  create(
    organizationId: string,
    sources: string[],
    webhookUrl: string,
    secret: string
  ) {
    return this._subscription.model.inboundEventSubscription.create({
      data: { organizationId, sources, webhookUrl, secret },
      select: {
        id: true,
        sources: true,
        webhookUrl: true,
        createdAt: true,
      },
    });
  }

  listByOrg(organizationId: string) {
    return this._subscription.model.inboundEventSubscription.findMany({
      where: { organizationId, revokedAt: null },
      select: {
        id: true,
        sources: true,
        webhookUrl: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Active subscriptions whose `sources` include the given source identifier. */
  findActiveForSource(organizationId: string, source: string) {
    return this._subscription.model.inboundEventSubscription.findMany({
      where: {
        organizationId,
        revokedAt: null,
        sources: { has: source },
      },
    });
  }

  revoke(organizationId: string, id: string) {
    return this._subscription.model.inboundEventSubscription.updateMany({
      where: { id, organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
