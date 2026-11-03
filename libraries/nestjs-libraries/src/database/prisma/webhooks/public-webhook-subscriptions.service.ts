import { HttpException, Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'crypto';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import {
  CreatePublicWebhookSubscriptionDto,
  UpdatePublicWebhookSubscriptionDto,
} from '@postsider/nestjs-libraries/dtos/webhooks/public-webhook-subscription.dto';

const publicFields = {
  id: true,
  name: true,
  url: true,
  events: true,
  active: true,
  consecutiveFailures: true,
  lastDeliveryAt: true,
  lastFailureAt: true,
  disabledAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class PublicWebhookSubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(organizationId: string) {
    return this.prisma.publicWebhookSubscription.findMany({
      where: { organizationId },
      select: publicFields,
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(organizationId: string, id: string) {
    const subscription = await this.prisma.publicWebhookSubscription.findFirst({
      where: { id, organizationId },
      select: publicFields,
    });
    if (!subscription)
      throw new HttpException('Webhook subscription not found', 404);
    return subscription;
  }

  async create(
    organizationId: string,
    input: CreatePublicWebhookSubscriptionDto
  ) {
    const secretVersion = randomUUID();
    const subscription = await this.prisma.publicWebhookSubscription.create({
      data: {
        organizationId,
        name: input.name.trim(),
        url: input.url,
        events: input.events,
        secretVersion,
      },
      select: publicFields,
    });
    return {
      ...subscription,
      secret: this.deriveSecret(subscription.id, secretVersion),
    };
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdatePublicWebhookSubscriptionDto
  ) {
    await this.assertOwned(organizationId, id);
    return this.prisma.publicWebhookSubscription.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.url === undefined ? {} : { url: input.url }),
        ...(input.events === undefined ? {} : { events: input.events }),
        ...(input.active === undefined
          ? {}
          : input.active
          ? { active: true, disabledAt: null, consecutiveFailures: 0 }
          : { active: false, disabledAt: new Date() }),
      },
      select: publicFields,
    });
  }

  async rotateSecret(organizationId: string, id: string) {
    await this.assertOwned(organizationId, id);
    const secretVersion = randomUUID();
    const subscription = await this.prisma.publicWebhookSubscription.update({
      where: { id },
      data: { secretVersion },
      select: { id: true },
    });
    return {
      id: subscription.id,
      secret: this.deriveSecret(subscription.id, secretVersion),
    };
  }

  async delete(organizationId: string, id: string) {
    await this.assertOwned(organizationId, id);
    await this.prisma.publicWebhookSubscription.delete({ where: { id } });
    return { id, deleted: true };
  }

  deriveSecret(id: string, secretVersion: string) {
    // A dedicated signing key is optional: PostSider already requires
    // JWT_SECRET (and usually ENCRYPTION_KEY) to boot, so reuse that material
    // instead of silently generating a different secret per process.
    const masterKey =
      process.env.WEBHOOK_SIGNING_KEY ||
      process.env.ENCRYPTION_KEY ||
      process.env.JWT_SECRET;
    if (!masterKey) {
      throw new Error(
        'WEBHOOK_SIGNING_KEY, ENCRYPTION_KEY or JWT_SECRET must be configured'
      );
    }
    return `pwhsec_${createHmac('sha256', masterKey)
      .update(`postsider-public-webhook:${id}:${secretVersion}`)
      .digest('base64url')}`;
  }

  private async assertOwned(organizationId: string, id: string) {
    const subscription = await this.prisma.publicWebhookSubscription.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!subscription)
      throw new HttpException('Webhook subscription not found', 404);
  }
}
