import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { WebhooksDto } from '@postsider/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from '@postsider/helpers/auth/auth.service';

@Injectable()
export class WebhooksRepository {
  constructor(private _prisma: PrismaService) {}

  getTotal(orgId: string) {
    return this._prisma.webhooks.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
  }

  getWebhooks(orgId: string) {
    return this._prisma.webhooks.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      include: {
        integrations: {
          select: {
            integration: {
              select: {
                id: true,
                picture: true,
                name: true,
              },
            },
          },
        },
      },
    }).then((rows) => rows.map(({ secret: _secret, ...row }) => row));
  }

  async getWebhooksForDelivery(orgId: string) {
    const rows = await this._prisma.webhooks.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: { integrations: { select: { integration: { select: { id: true } } } } },
    });
    return rows.map((row) => ({
      ...row,
      secret: this.decryptWebhookSecret(row.secret),
    }));
  }

  private decryptWebhookSecret(secret: string | null) {
    if (!secret) return null;
    try {
      return AuthService.decryptSecret(secret);
    } catch {
      // Secrets created before HMAC support were stored as deterministic
      // plaintext migration values. Keep those endpoints deliverable.
      return secret;
    }
  }

  deleteWebhook(orgId: string, id: string) {
    return this._prisma.webhooks.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async createWebhook(orgId: string, body: WebhooksDto) {
    if (body.id) {
      throw new BadRequestException('Webhook creation must not include an id');
    }
    return this.saveWebhook(orgId, body, true);
  }

  async updateWebhook(orgId: string, body: WebhooksDto) {
    const existing = await this._prisma.webhooks.findFirst({
      where: { id: body.id, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new BadRequestException('Webhook not found');
    }
    return this.saveWebhook(orgId, body, false);
  }

  private async saveWebhook(orgId: string, body: WebhooksDto, creating: boolean) {
    // The integration ids come straight from the request body — link only the
    // ones this org actually owns, otherwise another org's channel gets exposed
    // through this webhook.
    const integrationIds = body.integrations?.map((i) => i.id) || [];
    const owned = await this._prisma.integration.findMany({
      where: {
        id: { in: integrationIds },
        organizationId: orgId,
        deletedAt: null,
      },
      select: { id: true },
    });
    const ownedIds = owned.map((i) => i.id);

    // Write + relink must be atomic — a crash between them would persist a
    // webhook with no (or stale) integrations and no way to detect it.
    const secret = AuthService.encryptSecret(
      'whsec_' + uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '')
    );
    return this._prisma.$transaction(async (tx) => {
      const webhook = creating
        ? await tx.webhooks.create({
            data: { organizationId: orgId, url: body.url, name: body.name, secret },
          })
        : await tx.webhooks.update({
            where: { id: body.id },
            data: { url: body.url, name: body.name },
          });
      const { id } = webhook;

      await tx.webhooks.update({
        where: { id },
        data: {
          integrations: {
            deleteMany: {},
            create: ownedIds.map((integrationId) => ({ integrationId })),
          },
        },
      });

      return {
        id,
        ...(creating ? { secret: AuthService.decryptSecret(secret) } : {}),
      };
    });
  }
}
