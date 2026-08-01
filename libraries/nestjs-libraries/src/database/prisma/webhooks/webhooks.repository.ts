import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { WebhooksDto } from '@postsider/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { v4 as uuidv4 } from 'uuid';

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
    });
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

    // Upsert + relink must be atomic — a crash between them would persist a
    // webhook with no (or stale) integrations and no way to detect it.
    return this._prisma.$transaction(async (tx) => {
      const { id } = await tx.webhooks.upsert({
        where: {
          id: body.id || uuidv4(),
          organizationId: orgId,
        },
        create: {
          organizationId: orgId,
          url: body.url,
          name: body.name,
        },
        update: {
          url: body.url,
          name: body.name,
        },
      });

      await tx.webhooks.update({
        where: {
          id,
          organizationId: orgId,
        },
        data: {
          integrations: {
            deleteMany: {},
            create: ownedIds.map((integrationId) => ({ integrationId })),
          },
        },
      });

      return { id };
    });
  }
}
