import {
  PrismaRepository,
  PrismaTransaction,
} from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { IntegrationTimeDto } from '@postsider/nestjs-libraries/dtos/integrations/integration.time.dto';
import { UploadFactory } from '@postsider/nestjs-libraries/upload/upload.factory';
import { PlugDto } from '@postsider/nestjs-libraries/dtos/plugs/plug.dto';

export class ChannelCapacityExceededError extends Error {}

function activeChannelEntitlement(
  subscription: {
    totalChannels: number;
    identifier: string | null;
    cancelAt: Date | null;
  } | null
) {
  // Match SubscriptionService: an elapsed local trial has fallen back to FREE.
  if (
    subscription?.identifier === 'trial' &&
    subscription.cancelAt &&
    subscription.cancelAt.getTime() < Date.now()
  ) {
    return 0;
  }
  return subscription?.totalChannels || 0;
}

@Injectable()
export class IntegrationRepository {
  private storage = UploadFactory.createStorage();
  constructor(
    private _integration: PrismaRepository<'integration'>,
    private _posts: PrismaRepository<'post'>,
    private _plugs: PrismaRepository<'plugs'>,
    private _exisingPlugData: PrismaRepository<'exisingPlugData'>,
    private _customers: PrismaRepository<'customer'>,
    private _mentions: PrismaRepository<'mentions'>,
    private _transaction: PrismaTransaction
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

  // NOTE: checkPreviousConnections was REMOVED (2026-08-09). The OSS original
  // probed ALL orgs by rootInternalId (a cross-tenant data leak — an attacker
  // could learn which orgs had connected a given social account during OAuth
  // connect). Scoping it to the caller's org closed the leak but inverted its
  // semantics (same-org reconnects started 409ing), and same-org duplicates are
  // already handled by createOrUpdateIntegration's upsert — so the method had no
  // remaining purpose and was deleted outright rather than kept as dead code.

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
        ...(times.timezone ? { timezone: times.timezone } : {}),
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
        revision: { increment: 1 },
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
        revision: { increment: 1 },
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
    customInstanceDetails?: string,
    activeChannelLimit?: number,
    reactivate = false
  ) {
    // Default posting times are LOCAL minutes-from-midnight (Integration.timezone,
    // default 'UTC') — no longer baked against a raw browser-offset number, which
    // (a) can't be reversed into an actual IANA zone (many zones share an offset)
    // and (b) isn't DST-safe. The channel starts on 'UTC' until the operator sets
    // a real zone on the Queue Plan page; `timezone` here is otherwise unused now.
    const postTimes = timezone
      ? {
          postingTimes: JSON.stringify([
            { time: 560 },
            { time: 850 },
            { time: 1140 },
          ]),
        }
      : {};
    return this._transaction.model.$transaction(async (tx) => {
      if (activeChannelLimit !== undefined) {
        // Count and activation must share this per-org lock or concurrent OAuth
        // callbacks can both observe the final available channel slot.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${org}:channel-capacity`}))`;
        const [existing, subscription] = await Promise.all([
          tx.integration.findUnique({
          where: {
            organizationId_internalId: {
              internalId,
              organizationId: org,
            },
          },
          select: { deletedAt: true, disabled: true },
          }),
          // The caller may have read the plan before waiting for this lock.
          // Always use the entitlement that was persisted under the lock.
          tx.subscription.findFirst({
            where: { organizationId: org, deletedAt: null },
            select: { totalChannels: true, identifier: true, cancelAt: true },
          }),
        ]);
        const channelLimit = activeChannelEntitlement(subscription);
        const activatesChannel =
          !existing ||
          (reactivate && (existing.deletedAt !== null || existing.disabled));

        if (activatesChannel) {
          const activeChannels = await tx.integration.count({
            where: { organizationId: org, deletedAt: null, disabled: false },
          });
          if (activeChannels >= channelLimit) {
            throw new ChannelCapacityExceededError();
          }
        }
      }

      const upsert = await tx.integration.upsert({
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
          // `name` was missing here (only set in `create`), so reconnecting an
          // EXISTING integration (matched by internalId+org) never refreshed
          // its display name — only `picture` did. Found live via Discord: a
          // fix that made `authenticate()` resolve the real server name
          // instead of the shared bot's own name appeared to do nothing on
          // reconnect, because the corrected value was computed but then
          // silently dropped by this update clause. The silent token-refresh
          // path (RefreshIntegrationService) round-trips the integration's
          // own existing `name`/`picture` back through this same function, so
          // writing it unconditionally here is a no-op for that path, not a
          // behavior change.
          name,
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
          ...(reactivate ? { disabled: false } : {}),
          deletedAt: null,
          refreshNeeded: false,
          revision: { increment: 1 },
        },
      });

      if (oneTimeToken) {
        const rootId =
          (
            await tx.integration.findFirst({
              where: {
                organizationId: org,
                internalId: internalId,
              },
            })
          )?.rootInternalId || internalId;

        await tx.integration.updateMany({
          where: {
            id: {
              not: upsert.id,
            },
            organizationId: org,
            rootInternalId: rootId,
          },
          data: {
            token,
            refreshToken,
            refreshNeeded: false,
            ...(expiresIn
              ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
              : {}),
            revision: { increment: 1 },
          },
        });
      }

      return upsert;
    });
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

  /**
   * A provider exception is only actionable while the channel lifecycle that
   * started the refresh is still current. Never let an old activity strand a
   * newly reconnected or re-enabled channel between setup steps.
   */
  async setBetweenRefreshStepsIfCurrent(
    org: string,
    id: string,
    revision: number
  ): Promise<boolean> {
    const result = await this._integration.model.integration.updateMany({
      where: {
        id,
        organizationId: org,
        revision,
        disabled: false,
        deletedAt: null,
        inBetweenSteps: false,
        refreshNeeded: false,
      },
      data: {
        inBetweenSteps: true,
        revision: { increment: 1 },
      },
    });

    return result.count === 1;
  }
  refreshNeeded(org: string, id: string) {
    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        refreshNeeded: true,
        revision: { increment: 1 },
      },
    });
  }

  /**
   * Persist a refreshed token only while this is still the same active channel.
   * The caller's revision was read before contacting the provider, so a
   * disconnect, disable, or reconnect makes this compare-and-swap a no-op.
   */
  async refreshSucceededIfCurrent(
    org: string,
    id: string,
    revision: number,
    refresh: {
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
    }
  ): Promise<boolean> {
    const result = await this._integration.model.integration.updateMany({
      where: {
        id,
        organizationId: org,
        revision,
        disabled: false,
        deletedAt: null,
        inBetweenSteps: false,
        refreshNeeded: false,
      },
      data: {
        token: refresh.accessToken,
        ...(refresh.refreshToken !== undefined
          ? { refreshToken: refresh.refreshToken }
          : {}),
        ...(refresh.expiresIn
          ? { tokenExpiration: new Date(Date.now() + refresh.expiresIn * 1000) }
          : {}),
        // A successful write invalidates another in-flight refresh that read
        // the same credentials before this one completed.
        revision: { increment: 1 },
      },
    });

    return result.count === 1;
  }

  /**
   * Some providers share one renewable credential across child channels. Keep
   * only siblings that still hold the credential just refreshed in sync, so a
   * reconnect with a different token is never overwritten.
   */
  async refreshLinkedTokensIfCurrent(
    org: string,
    id: string,
    rootInternalId: string | null,
    previousRefreshToken: string | null,
    siblings: { id: string; revision: number }[],
    refresh: {
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
    }
  ) {
    if (!rootInternalId || !previousRefreshToken || siblings.length === 0) return;

    await this._integration.model.integration.updateMany({
      where: {
        OR: siblings.map((sibling) => ({
          id: sibling.id,
          revision: sibling.revision,
        })),
        organizationId: org,
        rootInternalId,
        disabled: false,
        deletedAt: null,
        inBetweenSteps: false,
        refreshNeeded: false,
      },
      data: {
        token: refresh.accessToken,
        ...(refresh.refreshToken !== undefined
          ? { refreshToken: refresh.refreshToken }
          : {}),
        ...(refresh.expiresIn
          ? { tokenExpiration: new Date(Date.now() + refresh.expiresIn * 1000) }
          : {}),
        refreshNeeded: false,
        revision: { increment: 1 },
      },
    });
  }

  getLinkedTokenSiblingsForRefresh(
    org: string,
    id: string,
    rootInternalId: string | null,
    refreshToken: string | null
  ) {
    if (!rootInternalId || !refreshToken) return [];

    return this._integration.model.integration.findMany({
      where: {
        id: { not: id },
        organizationId: org,
        rootInternalId,
        disabled: false,
        deletedAt: null,
        inBetweenSteps: false,
        refreshNeeded: false,
      },
      // Integration secrets use randomized encryption, so a database equality
      // condition on refreshToken can never match its plaintext value. The
      // Prisma extension decrypts this result; revision is the write-side CAS.
      select: { id: true, revision: true, refreshToken: true },
    }).then((siblings) =>
      siblings
        .filter((sibling) => sibling.refreshToken === refreshToken)
        .map(({ id: siblingId, revision }) => ({ id: siblingId, revision }))
    );
  }

  /** Mark a token unusable only if no newer channel lifecycle superseded it. */
  async refreshFailedIfCurrent(
    org: string,
    id: string,
    revision: number
  ): Promise<boolean> {
    const result = await this._integration.model.integration.updateMany({
      where: {
        id,
        organizationId: org,
        revision,
        disabled: false,
        deletedAt: null,
        inBetweenSteps: false,
        refreshNeeded: false,
      },
      data: {
        refreshNeeded: true,
        revision: { increment: 1 },
      },
    });

    return result.count === 1;
  }

  /** Refresh extension cookies without allowing a stale extension JWT to revive a channel. */
  async refreshExtensionCredentialsIfCurrent(
    org: string,
    id: string,
    revision: number,
    accessToken: string,
    expiresIn: number | undefined,
    customInstanceDetails: string
  ): Promise<boolean> {
    const result = await this._integration.model.integration.updateMany({
      where: {
        id,
        organizationId: org,
        revision,
        disabled: false,
        deletedAt: null,
      },
      data: {
        token: accessToken,
        ...(expiresIn
          ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
          : {}),
        customInstanceDetails,
        refreshNeeded: false,
        revision: { increment: 1 },
      },
    });

    return result.count === 1;
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
        revision: { increment: 1 },
      },
    });
  }

  async enableChannel(
    org: string,
    id: string,
    activeChannelLimit?: number
  ) {
    if (activeChannelLimit === undefined) {
      return this._integration.model.integration.update({
        where: { id, organizationId: org },
        data: { disabled: false, revision: { increment: 1 } },
      });
    }

    return this._transaction.model.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${org}:channel-capacity`}))`;
      const [integration, subscription] = await Promise.all([
        tx.integration.findFirst({
        where: { id, organizationId: org },
        select: { deletedAt: true, disabled: true },
        }),
        // Do not trust an entitlement calculated before waiting for this lock.
        tx.subscription.findFirst({
          where: { organizationId: org, deletedAt: null },
          select: { totalChannels: true, identifier: true, cancelAt: true },
        }),
      ]);
      const channelLimit = activeChannelEntitlement(subscription);

      if (integration?.deletedAt === null && integration.disabled) {
        const activeChannels = await tx.integration.count({
          where: { organizationId: org, deletedAt: null, disabled: false },
        });
        if (activeChannels >= channelLimit) {
          throw new ChannelCapacityExceededError();
        }
      }

      return tx.integration.update({
        where: { id, organizationId: org },
        data: { disabled: false, revision: { increment: 1 } },
      });
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

  /**
   * Disconnecting a channel used to delete every post that belonged to it —
   * published history included — so a reconnect (disconnect + connect) wiped
   * weeks of scheduled content with no warning and no undo. Nothing about
   * removing an integration means the user wanted the content gone.
   *
   * Instead, park everything unpublished as DRAFT: the publish workflow only
   * acts on `QUEUE` (`post.workflow.v1.0.5.ts:90`), so a draft can never fire
   * at its old scheduled time, and the user keeps the text/media to re-assign
   * to the reconnected channel. PUBLISHED rows are left untouched as history.
   */
  parkPostsForDeletedChannel(org: string, id: string) {
    return this._posts.model.post.updateMany({
      where: {
        organizationId: org,
        integrationId: id,
        deletedAt: null,
        state: { in: ['QUEUE', 'ERROR', 'APPROVAL'] },
      },
      data: {
        state: 'DRAFT',
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
        // Disconnecting used to soft-delete the row and leave a WORKING access
        // token (and refresh token) in the database indefinitely — the user
        // revoked our access in their eyes, and we kept the keys. Drop the
        // credentials with the channel; a later reconnect goes through
        // `createOrUpdateIntegration`, which revives the row (`deletedAt: null`)
        // with fresh tokens from OAuth, so nothing depends on keeping them.
        // Name/picture/internalId stay so past posts remain attributable.
        token: '',
        refreshToken: null,
        tokenExpiration: null,
        revision: { increment: 1 },
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
        revision: { increment: 1 },
      },
    });
  }

  markDeauthorized(ids: string[]) {
    return this._integration.model.integration.updateMany({
      where: { id: { in: ids } },
      data: {
        disabled: true,
        refreshNeeded: true,
        revision: { increment: 1 },
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

  /**
   * Complete a two-step OAuth selection exactly once for the staged channel.
   * The provider lookup may race, but only the request that still owns the
   * observed staged revision can persist its selected account.
   */
  async completeProviderPageIfCurrent(
    org: string,
    id: string,
    revision: number,
    params: Partial<Integration>
  ): Promise<boolean> {
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

    return this._transaction.model.$transaction(async (tx) => {
      const current = {
        id,
        organizationId: org,
        revision,
        inBetweenSteps: true,
        disabled: false,
        deletedAt: null,
        refreshNeeded: false,
      };

      // Claim first. A losing page-selection request must not mutate a
      // soft-deleted duplicate while discovering that it is stale.
      const claimed = await tx.integration.updateMany({
        where: current,
        data: { revision: { increment: 1 } },
      });
      if (claimed.count !== 1) return false;

      // Release a previous soft-deleted selection inside the same transaction
      // as the claim below, rather than opening a check-then-update window.
      await tx.integration.updateMany({
        where: {
          organizationId: org,
          internalId: params.internalId!,
          deletedAt: { not: null },
        },
        data: { internalId: makeId(10) },
      });

      const existing = await tx.integration.findUnique({
        where: {
          organizationId_internalId: {
            organizationId: org,
            internalId: params.internalId!,
          },
        },
        select: { id: true },
      });

      if (!existing || existing.id === id) {
        await tx.integration.update({
          where: { id },
          data: {
            ...params,
            disabled: false,
            deletedAt: null,
            inBetweenSteps: false,
          },
        });
        return true;
      }

      await tx.post.updateMany({
        where: { integrationId: id },
        data: { deletedAt: new Date() },
      });
      await tx.integration.update({
        where: { id },
        data: {
          internalId: `deleted_${params.internalId}_${makeId(10)}`,
          deletedAt: new Date(),
        },
      });
      await tx.integration.update({
        where: { id: existing.id },
        data: {
          ...params,
          disabled: false,
          deletedAt: null,
          revision: { increment: 1 },
        },
      });
      return true;
    });
  }

  async disableIntegrations(org: string, activeChannelLimit: number) {
    return this._transaction.model.$transaction(async (tx) => {
      // This is intentionally the same lock used by connect/reconnect and
      // enable. A plan downgrade cannot choose channels to disable while a
      // concurrent request is reviving another channel.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${org}:channel-capacity`}))`;

      const where = {
        organizationId: org,
        disabled: false,
        deletedAt: null,
      };
      const activeChannels = await tx.integration.count({ where });
      const excess = Math.max(0, activeChannels - activeChannelLimit);
      if (!excess) return { count: 0 };

      const channels = await tx.integration.findMany({
        where,
        take: excess,
        select: { id: true },
      });
      return tx.integration.updateMany({
        where: { id: { in: channels.map((channel) => channel.id) } },
        data: {
          disabled: true,
          revision: { increment: 1 },
        },
      });
    });
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
        timezone: true,
      },
    });
  }
}
