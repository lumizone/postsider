import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { IntegrationTimeDto } from '@postsider/nestjs-libraries/dtos/integrations/integration.time.dto';
import { UploadFactory } from '@postsider/nestjs-libraries/upload/upload.factory';
import { PlugDto } from '@postsider/nestjs-libraries/dtos/plugs/plug.dto';

@Injectable()
export class IntegrationRepository {
  private storage = UploadFactory.createStorage();
  constructor(
    private _integration: PrismaRepository<'integration'>,
    private _posts: PrismaRepository<'post'>,
    private _plugs: PrismaRepository<'plugs'>,
    private _exisingPlugData: PrismaRepository<'exisingPlugData'>,
    private _customers: PrismaRepository<'customer'>,
    private _mentions: PrismaRepository<'mentions'>
  ) {}

  getMentions(platform: string, q: string) {
    return this._mentions.model.mentions.findMany({
      where: {
        platform,
        OR: [
          {
            name: {
              contains: q,
              mode: 'insensitive',
            },
          },
          {
            username: {
              contains: q,
              mode: 'insensitive',
            },
          },
        ],
      },
      orderBy: {
        name: 'asc',
      },
      take: 100,
      select: {
        name: true,
        username: true,
        image: true,
      },
    });
  }

  insertMentions(
    platform: string,
    mentions: { name: string; username: string; image: string }[]
  ) {
    if (mentions.length === 0) {
      return [] as any[];
    }
    return this._mentions.model.mentions.createMany({
      data: mentions.map((mention) => ({
        platform,
        name: mention.name,
        username: mention.username,
        image: mention.image,
      })),
      skipDuplicates: true,
    });
  }

  async checkPreviousConnections(org: string, id: string) {
    const findIt = await this._integration.model.integration.findMany({
      where: {
        rootInternalId: id,
      },
      select: {
        organizationId: true,
        id: true,
      },
    });

    if (findIt.some((f) => f.organizationId === org)) {
      return false;
    }

    return findIt.length > 0;
  }

  updateProviderSettings(org: string, id: string, settings: string) {
    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        additionalSettings: settings,
      },
    });
  }

  async setTimes(org: string, id: string, times: IntegrationTimeDto) {
    return this._integration.model.integration.update({
      select: {
        id: true,
      },
      where: {
        id,
        organizationId: org,
      },
      data: {
        postingTimes: JSON.stringify(times.time),
      },
    });
  }

  getPlug(plugId: string) {
    return this._plugs.model.plugs.findFirst({
      where: {
        id: plugId,
      },
      include: {
        integration: true,
      },
    });
  }

  async getPlugs(orgId: string, integrationId: string) {
    return this._plugs.model.plugs.findMany({
      where: {
        integrationId,
        organizationId: orgId,
        activated: true,
      },
      include: {
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
          },
        },
      },
    });
  }

  async updateIntegration(id: string, params: Partial<Integration>) {
    // The old `||` made this true unless the URL contained BOTH hosts (never),
    // so every already-hosted picture was re-downloaded/re-uploaded on each
    // integration update. Only upload when the picture is NOT already on one of
    // our hosts.
    const hostedPrefixes = [
      process.env.CLOUDFLARE_BUCKET_URL,
      process.env.FRONTEND_URL,
    ].filter((u): u is string => !!u);
    const alreadyHosted =
      !!params.picture &&
      hostedPrefixes.some((host) => params.picture!.includes(host));
    if (params.picture && !alreadyHosted) {
      params.picture = await this.storage.uploadSimple(params.picture);
    }

    const existing = await this._integration.model.integration.findUnique({
      where: {
        organizationId_internalId: {
          organizationId: params.organizationId!,
          internalId: params.internalId!,
        },
      },
    });

    if (existing) {
      await this._posts.model.post.updateMany({
        where: {
          integrationId: id,
        },
        data: {
          deletedAt: new Date(),
        },
      });

      await this._integration.model.integration.update({
        where: {
          id,
        },
        data: {
          internalId: `deleted_${params.internalId}_${makeId(10)}`,
          deletedAt: new Date(),
        },
      });
    }

    return this._integration.model.integration.update({
      where: {
        ...(existing ? { id: existing.id } : { id }),
      },
      data: {
        ...params,
        disabled: false,
        deletedAt: null,
      },
    });
  }

  disconnectChannel(org: string, id: string) {
    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        refreshNeeded: true,
      },
    });
  }

  async createOrUpdateIntegration(
    additionalSettings:
      | {
          title: string;
          description: string;
          type: 'checkbox' | 'text' | 'textarea';
          value: any;
          regex?: string;
        }[]
      | undefined,
    oneTimeToken: boolean,
    org: string,
    name: string,
    picture: string | undefined,
    type: 'article' | 'social',
    internalId: string,
    provider: string,
    token: string,
    refreshToken = '',
    expiresIn = 999999999,
    username?: string,
    isBetweenSteps = false,
    refresh?: string,
    timezone?: number,
    customInstanceDetails?: string
  ) {
    const postTimes = timezone
      ? {
          postingTimes: JSON.stringify([
            { time: 560 - timezone },
            { time: 850 - timezone },
            { time: 1140 - timezone },
          ]),
        }
      : {};
    const upsert = await this._integration.model.integration.upsert({
      where: {
        organizationId_internalId: {
          internalId,
          organizationId: org,
        },
      },
      create: {
        type: type as any,
        name,
        providerIdentifier: provider,
        token,
        profile: username,
        ...(picture ? { picture } : {}),
        inBetweenSteps: isBetweenSteps,
        refreshToken,
        ...(expiresIn
          ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
          : {}),
        internalId,
        ...postTimes,
        organizationId: org,
        refreshNeeded: false,
        rootInternalId: internalId,
        ...(customInstanceDetails ? { customInstanceDetails } : {}),
        additionalSettings: additionalSettings
          ? JSON.stringify(additionalSettings)
          : '[]',
      },
      update: {
        ...(additionalSettings
          ? { additionalSettings: JSON.stringify(additionalSettings) }
          : {}),
        ...(customInstanceDetails ? { customInstanceDetails } : {}),
        type: type as any,
        ...(!refresh
          ? {
              inBetweenSteps: isBetweenSteps,
            }
          : {}),
        ...(picture ? { picture } : {}),
        profile: username,
        providerIdentifier: provider,
        token,
        refreshToken,
        ...(expiresIn
          ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
          : {}),
        internalId,
        organizationId: org,
        deletedAt: null,
        refreshNeeded: false,
      },
    });

    if (oneTimeToken) {
      const rootId =
        (
          await this._integration.model.integration.findFirst({
            where: {
              organizationId: org,
              internalId: internalId,
            },
          })
        )?.rootInternalId || internalId;

      await this._integration.model.integration.updateMany({
        where: {
          id: {
            not: upsert.id,
          },
          rootInternalId: rootId,
        },
        data: {
          token,
          refreshToken,
          refreshNeeded: false,
          ...(expiresIn
            ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
            : {}),
        },
      });
    }

    return upsert;
  }

  needsToBeRefreshed() {
    return this._integration.model.integration.findMany({
      where: {
        tokenExpiration: {
          lte: dayjs().add(1, 'day').toDate(),
        },
        inBetweenSteps: false,
        deletedAt: null,
        refreshNeeded: false,
      },
    });
  }

  async setBetweenRefreshSteps(id: string) {
    return this._integration.model.integration.update({
      where: {
        id,
      },
      data: {
        inBetweenSteps: true,
      },
    });
  }
  refreshNeeded(org: string, id: string) {
    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        refreshNeeded: true,
      },
    });
  }

  updateNameAndUrl(id: string, name: string, url: string) {
    return this._integration.model.integration.update({
      where: {
        id,
      },
      data: {
        ...(name ? { name } : {}),
        ...(url ? { picture: url } : {}),
      },
    });
  }

  getIntegrationById(org: string, id: string) {
    return this._integration.model.integration.findFirst({
      where: {
        organizationId: org,
        id,
      },
    });
  }

  async getIntegrationForOrder(
    id: string,
    order: string,
    user: string,
    org: string
  ) {
    const integration = await this._posts.model.post.findFirst({
      where: {
        integrationId: id,
        submittedForOrder: {
          id: order,
          messageGroup: {
            OR: [
              { sellerId: user },
              { buyerId: user },
              { buyerOrganizationId: org },
            ],
          },
        },
      },
      select: {
        integration: {
          select: {
            id: true,
            name: true,
            picture: true,
            inBetweenSteps: true,
            providerIdentifier: true,
          },
        },
      },
    });

    return integration?.integration;
  }

  async updateOnCustomerName(org: string, id: string, name: string) {
    const customer = !name
      ? undefined
      : (await this._customers.model.customer.findFirst({
          where: {
            orgId: org,
            name,
          },
        })) ||
        (await this._customers.model.customer.create({
          data: {
            name,
            orgId: org,
          },
        }));

    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        customer: !customer
          ? { disconnect: true }
          : {
              connect: {
                id: customer.id,
              },
            },
      },
    });
  }

  updateIntegrationGroup(org: string, id: string, group: string) {
    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: !group
        ? {
            customer: {
              disconnect: true,
            },
          }
        : {
            customer: {
              connect: {
                id: group,
              },
            },
          },
    });
  }

  customers(orgId: string) {
    return this._customers.model.customer.findMany({
      where: {
        orgId,
        deletedAt: null,
      },
    });
  }

  getIntegrationsList(org: string) {
    return this._integration.model.integration.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
      },
      include: {
        customer: true,
      },
    });
  }

  // All live integrations (every org) eligible to have their token-refresh
  // workflow (re-)armed on boot. Excludes deleted/disabled/already-broken
  // (refreshNeeded) and half-connected (inBetweenSteps) channels.
  getAllForRefreshArming() {
    return this._integration.model.integration.findMany({
      where: {
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
      },
      select: {
        id: true,
        organizationId: true,
        providerIdentifier: true,
        refreshToken: true,
      },
    });
  }

  async disableChannel(org: string, id: string) {
    await this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        disabled: true,
      },
    });
  }

  async enableChannel(org: string, id: string) {
    await this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        disabled: false,
      },
    });
  }

  getPostsForChannel(org: string, id: string) {
    return this._posts.model.post.groupBy({
      by: ['group'],
      where: {
        organizationId: org,
        integrationId: id,
        deletedAt: null,
      },
    });
  }

  deleteChannel(org: string, id: string) {
    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  // Platform-initiated compliance callbacks (e.g. Meta data deletion) arrive
  // with only the provider-side user id, so these lookups are cross-org.
  findByPlatformInternalIds(
    providerIdentifiers: string[],
    internalIds: string[]
  ) {
    return this._integration.model.integration.findMany({
      where: {
        providerIdentifier: { in: providerIdentifiers },
        deletedAt: null,
        OR: [
          { rootInternalId: { in: internalIds } },
          { internalId: { in: internalIds } },
        ],
      },
    });
  }

  dataDeletionWipe(ids: string[]) {
    return this._integration.model.integration.updateMany({
      where: { id: { in: ids } },
      data: {
        deletedAt: new Date(),
        disabled: true,
        refreshNeeded: true,
        token: '',
        refreshToken: '',
      },
    });
  }

  markDeauthorized(ids: string[]) {
    return this._integration.model.integration.updateMany({
      where: { id: { in: ids } },
      data: {
        disabled: true,
        refreshNeeded: true,
      },
    });
  }

  async checkForDeletedOnceAndUpdate(org: string, page: string) {
    return this._integration.model.integration.updateMany({
      where: {
        organizationId: org,
        internalId: page,
        deletedAt: {
          not: null,
        },
      },
      data: {
        internalId: makeId(10),
      },
    });
  }

  async disableIntegrations(org: string, totalChannels: number) {
    const getChannels = await this._integration.model.integration.findMany({
      where: {
        organizationId: org,
        disabled: false,
        deletedAt: null,
      },
      take: totalChannels,
      select: {
        id: true,
      },
    });

    for (const channel of getChannels) {
      await this._integration.model.integration.update({
        where: {
          id: channel.id,
        },
        data: {
          disabled: true,
        },
      });
    }
  }

  getPlugsByIntegrationId(org: string, id: string) {
    return this._plugs.model.plugs.findMany({
      where: {
        organizationId: org,
        integrationId: id,
      },
    });
  }

  createOrUpdatePlug(org: string, integrationId: string, body: PlugDto) {
    return this._plugs.model.plugs.upsert({
      where: {
        organizationId: org,
        plugFunction_integrationId: {
          integrationId,
          plugFunction: body.func,
        },
      },
      create: {
        integrationId,
        organizationId: org,
        plugFunction: body.func,
        data: JSON.stringify(body.fields),
        activated: true,
      },
      update: {
        data: JSON.stringify(body.fields),
      },
      select: {
        activated: true,
      },
    });
  }

  changePlugActivation(orgId: string, plugId: string, status: boolean) {
    return this._plugs.model.plugs.update({
      where: {
        organizationId: orgId,
        id: plugId,
      },
      data: {
        activated: !!status,
      },
    });
  }

  async loadExisingData(
    methodName: string,
    integrationId: string,
    id: string[]
  ) {
    return this._exisingPlugData.model.exisingPlugData.findMany({
      where: {
        integrationId,
        methodName,
        value: {
          in: id,
        },
      },
    });
  }

  async saveExisingData(
    methodName: string,
    integrationId: string,
    value: string[]
  ) {
    return this._exisingPlugData.model.exisingPlugData.createMany({
      data: value.map((p) => ({
        integrationId,
        methodName,
        value: p,
      })),
    });
  }

  async getPostingTimes(orgId: string, integrationsId?: string) {
    return this._integration.model.integration.findMany({
      where: {
        ...(integrationsId ? { id: integrationsId } : {}),
        organizationId: orgId,
        disabled: false,
        deletedAt: null,
      },
      select: {
        postingTimes: true,
      },
    });
  }
}
