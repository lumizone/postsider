import { PrismaRepository, PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { Role, ShortLinkPreference, SubscriptionTier } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { CreateOrgUserDto } from '@postsider/nestjs-libraries/dtos/auth/create.org.user.dto';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { isBillingEnabled } from '@postsider/nestjs-libraries/services/billing.flag';
import { pricing } from '@postsider/nestjs-libraries/database/prisma/subscriptions/pricing';

@Injectable()
export class OrganizationRepository {
  constructor(
    private _organization: PrismaRepository<'organization'>,
    private _userOrg: PrismaRepository<'userOrganization'>,
    private _user: PrismaRepository<'user'>,
    private _prisma: PrismaService
  ) {}

  createMaxUser(id: string, name: string, saasName: string, email: string) {
    return this._organization.model.organization.create({
      select: {
        id: true,
        apiKey: true,
      },
      data: {
        name: name ? `${name}###${id}` : `Unnamed User###${id}`,
        apiKey: AuthService.fixedEncryption(makeId(20)),
        isTrailing: false,
        subscription: {
          create: {
            totalChannels: 1000000,
            subscriptionTier: 'ULTIMATE',
            isLifetime: true,
            period: 'YEARLY',
          },
        },
        users: {
          create: {
            role: Role.SUPERADMIN,
            user: {
              create: {
                activated: true,
                email: email
                  ? email.split('@').join(`+${saasName}@`)
                  : `${saasName}+` + makeId(10) + '@postsider.com',
                name: name ? `${name}###${id}` : `Unnamed User###${id}`,
                providerName: 'LOCAL',
                password: AuthService.hashPassword(makeId(500)),
                timezone: 0,
              },
            },
          },
        },
      },
    });
  }

  async getOrgByApiKey(api: string) {
    const subscriptionInclude = {
      subscription: {
        select: {
          subscriptionTier: true,
          totalChannels: true,
          isLifetime: true,
        },
      },
    } as const;

    // Legacy single per-org key (Organization.apiKey), still issued at org
    // creation and shown as `publicApi` in Settings — checked first since
    // it's the common path for every existing org.
    const legacy = await this._organization.model.organization.findFirst({
      where: { apiKey: api },
      include: subscriptionInclude,
    });
    if (legacy) return legacy;

    // Self-service keys from Settings -> API (`ps_...`, multiple per org,
    // individually revocable) live in the ApiKey table and were never
    // checked here — every key generated through that flow 401'd on every
    // Public API / MCP call. Stored via AuthService.fixedEncryption at
    // creation (organization.repository.ts createApiKey), so the lookup
    // applies the same deterministic transform to the incoming header.
    const db = this._organization.model as any;
    const selfService = await db.apiKey.findFirst({
      where: { key: AuthService.fixedEncryption(api), deletedAt: null },
      include: { organization: { include: subscriptionInclude } },
    });
    return selfService?.organization ?? null;
  }

  getCount() {
    return this._organization.model.organization.count();
  }

  getUserOrg(id: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        id,
      },
      select: {
        user: true,
        organization: {
          include: {
            users: {
              select: {
                id: true,
                disabled: true,
                role: true,
                userId: true,
              },
            },
            subscription: {
              select: {
                subscriptionTier: true,
                totalChannels: true,
                isLifetime: true,
              },
            },
          },
        },
      },
    });
  }

  getImpersonateUser(name: string) {
    return this._userOrg.model.userOrganization.findMany({
      where: {
        OR: [
          {
            organizationId: {
              contains: name,
            },
          },
          {
            user: {
              OR: [
                {
                  name: {
                    contains: name,
                  },
                },
                {
                  email: {
                    contains: name,
                  },
                },
                {
                  id: {
                    contains: name,
                  },
                },
              ],
            },
          },
        ],
      },
      select: {
        id: true,
        organization: {
          select: {
            id: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  updateApiKey(orgId: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        apiKey: AuthService.fixedEncryption(makeId(20)),
      },
    });
  }

  async getOrgsByUserId(userId: string) {
    return this._organization.model.organization.findMany({
      where: {
        users: {
          some: {
            userId,
          },
        },
      },
      include: {
        users: {
          where: {
            userId,
          },
          select: {
            disabled: true,
            role: true,
          },
        },
        subscription: {
          select: {
            subscriptionTier: true,
            totalChannels: true,
            isLifetime: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getOrgById(id: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id,
      },
    });
  }

  async updateOrganizationProfile(
    id: string,
    data: {
      name?: string;
      description?: string | null;
      logo?: string | null;
      defaultTimezone?: string | null;
      referralSource?: string | null;
      brandVoice?: string | null;
      brandAudience?: string | null;
      brandRules?: string | null;
      brandForbiddenWords?: string | null;
    }
  ) {
    return this._organization.model.organization.update({
      where: { id },
      data,
    });
  }

  async addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN'
  ) {
    const checkIfInviteExists = await this._user.model.user.findFirst({
      where: {
        inviteId: id,
      },
    });

    if (checkIfInviteExists) {
      return false;
    }

    const checkForSubscription =
      await this._organization.model.organization.findFirst({
        where: {
          id: orgId,
        },
        select: {
          subscription: true,
        },
      });

    if (
      isBillingEnabled() &&
      checkForSubscription?.subscription?.subscriptionTier ===
        SubscriptionTier.STANDARD
    ) {
      return false;
    }

    const create = await this._userOrg.model.userOrganization.create({
      data: {
        role,
        userId,
        organizationId: orgId,
      },
    });

    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        inviteId: id,
      },
    });

    return create;
  }

  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & { providerId?: string },
    requireEmailActivation: boolean,
    ip: string,
    userAgent: string,
    allowTrial = true
  ) {
    // Grant a real 7-day trial of the STANDARD plan (with its channel limit) on
    // the first signup for an email — but only when billing is enforced. In
    // self-host mode (no billing) every org is already unlimited, so no trial
    // subscription is needed (and one would wrongly downgrade them to STANDARD).
    const TRIAL_DAYS = 7;
    return this._prisma.$transaction(async (tx) => {
      let grantTrial = allowTrial && isBillingEnabled();
      if (allowTrial) {
        try {
          await tx.trialUsage.create({
            data: { email: body.email.trim().toLowerCase() },
          });
        } catch (error: any) {
          if (error?.code === 'P2002') grantTrial = false;
          else throw error;
        }
      }

      return tx.organization.create({
      data: {
        name: body.company,
        apiKey: AuthService.fixedEncryption(makeId(20)),
        allowTrial: grantTrial,
        isTrailing: grantTrial,
        ...(grantTrial
          ? {
              subscription: {
                create: {
                  subscriptionTier: SubscriptionTier.STANDARD,
                  totalChannels: pricing.STANDARD.channel ?? 5,
                  period: 'MONTHLY',
                  isLifetime: false,
                  identifier: 'trial',
                  cancelAt: new Date(
                    Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000
                  ),
                },
              },
            }
          : {}),
        users: {
          create: {
            role: Role.SUPERADMIN,
            user: {
              create: {
                activated: body.provider !== 'LOCAL' || !requireEmailActivation,
                email: body.email,
                password: body.password
                  ? AuthService.hashPassword(body.password)
                  : '',
                providerName: body.provider,
                providerId: body.providerId || '',
                timezone: 0,
                ip,
                agent: userAgent,
              },
            },
          },
        },
      },
      select: {
        id: true,
        users: {
          select: {
            user: true,
          },
        },
      },
      });
    });
  }

  /**
   * Lets an ALREADY-authenticated user spin up an additional organization
   * (e.g. an agency onboarding client #21) without going through the public
   * signup flow — no new User row, just a new Organization with the caller
   * linked as its SUPERADMIN. Deliberately unrelated to DISABLE_REGISTRATION:
   * that gate is about new PEOPLE joining the platform; this creates more
   * orgs under someone who is already a vetted, logged-in user.
   */
  async createOrgForExistingUser(
    userId: string,
    name: string,
    allowTrial: boolean
  ) {
    const TRIAL_DAYS = 7;
    return this._prisma.$transaction(async (tx) => {
      let grantTrial = allowTrial && isBillingEnabled();
      const email = await tx.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (allowTrial && email?.email) {
        try {
          await tx.trialUsage.create({
            data: { email: email.email.trim().toLowerCase() },
          });
        } catch (error: any) {
          if (error?.code === 'P2002') grantTrial = false;
          else throw error;
        }
      }

      return tx.organization.create({
      data: {
        name,
        apiKey: AuthService.fixedEncryption(makeId(20)),
        allowTrial: grantTrial,
        isTrailing: grantTrial,
        ...(grantTrial
          ? {
              subscription: {
                create: {
                  subscriptionTier: SubscriptionTier.STANDARD,
                  totalChannels: pricing.STANDARD.channel ?? 5,
                  period: 'MONTHLY',
                  isLifetime: false,
                  identifier: 'trial',
                  cancelAt: new Date(
                    Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000
                  ),
                },
              },
            }
          : {}),
        users: {
          create: {
            role: Role.SUPERADMIN,
            userId,
          },
        },
      },
      select: { id: true, name: true },
      });
    });
  }

  getOrgByCustomerId(customerId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        paymentId: customerId,
      },
    });
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    try {
      await this._organization.model.organization.update({
        where: {
          id: organizationId,
          ...(type === 'start'
            ? {
                streakSince: null,
              }
            : {}),
        },
        data: {
          ...(type === 'end' ? { streakSince: null } : {}),
          ...(type === 'start' ? { streakSince: new Date() } : {}),
        },
      });
    } catch (err) {}
  }

  async getTeam(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        users: {
          select: {
            role: true,
            user: {
              select: {
                email: true,
                id: true,
                sendSuccessEmails: true,
                sendFailureEmails: true,
                sendStreakEmails: true,
              },
            },
          },
        },
      },
    });
  }

  getAllUsersOrgs(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        users: {
          select: {
            role: true,
            user: {
              select: {
                email: true,
                id: true,
                sendSuccessEmails: true,
                sendFailureEmails: true,
              },
            },
          },
        },
      },
    });
  }

  async deleteTeamMember(orgId: string, userId: string) {
    return this._userOrg.model.userOrganization.delete({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId,
        },
      },
    });
  }

  async changeTeamMemberRole(orgId: string, userId: string, role: 'ADMIN' | 'USER') {
    return this._userOrg.model.userOrganization.update({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId,
        },
      },
      data: {
        role,
      },
    });
  }

  async findUserByEmail(email: string) {
    return (this._organization.model as any).user.findFirst({
      where: { email: email.toLowerCase(), providerName: 'LOCAL' },
      select: { id: true, email: true },
    });
  }

  async createUserForOrg(
    orgId: string,
    data: { email: string; password: string; role: 'USER' | 'ADMIN' }
  ) {
    return this._userOrg.model.userOrganization.create({
      data: {
        role: data.role,
        organization: { connect: { id: orgId } },
        user: {
          create: {
            email: data.email,
            password: data.password,
            providerName: 'LOCAL',
            providerId: '',
            timezone: 0,
            activated: true,
            // name is null — triggers the setup screen on first login.
          },
        },
      },
      select: {
        userId: true,
        user: { select: { id: true, email: true } },
      },
    });
  }

  async createUserOrgLink(orgId: string, userId: string, role: 'USER' | 'ADMIN') {
    return this._userOrg.model.userOrganization.upsert({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId,
        },
      },
      update: { role, disabled: false },
      create: {
        role,
        organization: { connect: { id: orgId } },
        user: { connect: { id: userId } },
      },
    });
  }

  async getUserOrgLink(orgId: string, userId: string) {
    return this._userOrg.model.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId,
        },
      },
      select: { disabled: true, role: true },
    });
  }

  async getMediaStats(orgId: string) {
    const media = this._organization.model as any;
    const [total, images, videos, totalSize] = await Promise.all([
      media.media.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      media.media.count({
        where: { organizationId: orgId, deletedAt: null, type: 'image' },
      }),
      media.media.count({
        where: { organizationId: orgId, deletedAt: null, type: 'video' },
      }),
      media.media.aggregate({
        where: { organizationId: orgId, deletedAt: null },
        _sum: { fileSize: true },
      }),
    ]);
    return {
      total,
      images,
      videos,
      totalBytes: totalSize?._sum?.fileSize ?? 0,
    };
  }

  async listApiKeys(orgId: string) {
    const db = this._organization.model as any;
    return db.apiKey.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        name: true,
        key: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createApiKey(orgId: string, name: string) {
    const db = this._organization.model as any;
    const rawKey = 'ps_' + makeId(40);
    const hashedKey = AuthService.fixedEncryption(rawKey);
    const created = await db.apiKey.create({
      data: {
        name,
        key: hashedKey,
        organization: { connect: { id: orgId } },
      },
      select: { id: true, name: true, createdAt: true },
    });
    // Return the raw key only at creation (never again).
    return { ...created, key: rawKey };
  }

  async renameApiKey(orgId: string, keyId: string, name: string) {
    const db = this._organization.model as any;
    return db.apiKey.update({
      where: { id: keyId, organizationId: orgId },
      data: { name },
      select: { id: true, name: true },
    });
  }

  async deleteApiKey(orgId: string, keyId: string) {
    const db = this._organization.model as any;
    return db.apiKey.update({
      where: { id: keyId, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }

  disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    return this._userOrg.model.userOrganization.updateMany({
      where: {
        organizationId: orgId,
        role: {
          not: Role.SUPERADMIN,
        },
      },
      data: {
        disabled: disable,
      },
    });
  }

  getShortlinkPreference(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        shortlink: true,
      },
    });
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        shortlink,
      },
    });
  }

  /**
   * Has this email already consumed a free trial? Checked against the
   * permanent TrialUsage table (which survives account deletion).
   */
  async hasUsedTrial(email: string): Promise<boolean> {
    const normalized = email.trim().toLowerCase();
    const found = await this._prisma.trialUsage.findUnique({
      where: { email: normalized },
    });
    return !!found;
  }

  /**
   * Permanently record that an email has used its free trial. Idempotent.
   */
  async markTrialUsed(email: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    await this._prisma.trialUsage.upsert({
      where: { email: normalized },
      update: {},
      create: { email: normalized },
    });
  }

  /**
   * Permanently delete an organization and ALL of its data.
   *
   * The schema has no ON DELETE CASCADE, so we delete every dependent row in
   * FK-safe order (children before parents) inside a single transaction. This
   * is irreversible.
   */
  async deleteOrganizationCascade(orgId: string) {
    const prisma = this._prisma;

    // Collect ids we need for nested relations.
    const posts = await prisma.post.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    });
    const postIds = posts.map((p) => p.id);

    const integrations = await prisma.integration.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    });
    const integrationIds = integrations.map((i) => i.id);

    const webhooks = await prisma.webhooks.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    });
    const webhookIds = webhooks.map((w) => w.id);

    await prisma.$transaction(async (tx) => {
      // Post-dependent rows
      if (postIds.length) {
        await tx.postAnalytics.deleteMany({ where: { organizationId: orgId } });
        await tx.tagsPosts.deleteMany({ where: { postId: { in: postIds } } });
        await tx.errors.deleteMany({ where: { postId: { in: postIds } } });
        await tx.comments.deleteMany({ where: { postId: { in: postIds } } });
        await tx.payoutProblems.deleteMany({
          where: { postId: { in: postIds } },
        });
      }

      // Integration-dependent rows
      if (integrationIds.length) {
        await tx.exisingPlugData.deleteMany({
          where: { integrationId: { in: integrationIds } },
        });
        await tx.integrationsWebhooks.deleteMany({
          where: { integrationId: { in: integrationIds } },
        });
        await tx.orderItems.deleteMany({
          where: { integrationId: { in: integrationIds } },
        });
      }
      if (webhookIds.length) {
        await tx.integrationsWebhooks.deleteMany({
          where: { webhookId: { in: webhookIds } },
        });
      }

      // Org-scoped rows that reference posts/integrations indirectly
      await tx.plugs.deleteMany({ where: { organizationId: orgId } });
      await tx.errors.deleteMany({ where: { organizationId: orgId } });
      await tx.comments.deleteMany({ where: { organizationId: orgId } });

      // Posts: clear self-references first, then delete
      await tx.post.updateMany({
        where: { organizationId: orgId },
        data: { parentPostId: null, lastMessageId: null, submittedForOrderId: null },
      });
      await tx.post.deleteMany({ where: { organizationId: orgId } });

      // Tags
      await tx.tags.deleteMany({ where: { orgId } });

      // Integrations + customers
      await tx.integration.deleteMany({ where: { organizationId: orgId } });
      await tx.customer.deleteMany({ where: { orgId } });

      // Misc org-scoped data
      await tx.webhooks.deleteMany({ where: { organizationId: orgId } });
      await tx.sets.deleteMany({ where: { organizationId: orgId } });
      await tx.thirdParty.deleteMany({ where: { organizationId: orgId } });
      await tx.signatures.deleteMany({ where: { organizationId: orgId } });
      await tx.notifications.deleteMany({ where: { organizationId: orgId } });
      await tx.credits.deleteMany({ where: { organizationId: orgId } });
      await tx.media.deleteMany({ where: { organizationId: orgId } });
      await tx.gitHub.deleteMany({ where: { organizationId: orgId } });
      await tx.usedCodes.deleteMany({ where: { orgId } });
      await tx.subscription.deleteMany({ where: { organizationId: orgId } });
      await tx.apiKey.deleteMany({ where: { organizationId: orgId } });
      await tx.providerCredentials.deleteMany({
        where: { organizationId: orgId },
      });
      await tx.oAuthAuthorization.deleteMany({
        where: { organizationId: orgId },
      });
      await tx.oAuthApp.deleteMany({ where: { organizationId: orgId } });

      // Finally the membership links and the org itself
      await tx.userOrganization.deleteMany({
        where: { organizationId: orgId },
      });
      await tx.organization.delete({ where: { id: orgId } });
    });
  }

  /**
   * Delete a user if they no longer belong to any organization, removing
   * personal rows first.
   */
  async deleteUserIfOrphan(userId: string) {
    const prisma = this._prisma;
    const remaining = await prisma.userOrganization.count({
      where: { userId },
    });
    if (remaining > 0) {
      return false;
    }
    await prisma.$transaction(async (tx) => {
      await tx.itemUser.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
    });
    return true;
  }
}
