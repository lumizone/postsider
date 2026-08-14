import { CreateOrgUserDto } from '@postsider/nestjs-libraries/dtos/auth/create.org.user.dto';
import { Injectable } from '@nestjs/common';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { AddTeamMemberDto } from '@postsider/nestjs-libraries/dtos/settings/add.team.member.dto';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import dayjs from 'dayjs';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { Organization, ShortLinkPreference } from '@prisma/client';
import { teamInviteEmail } from '@postsider/nestjs-libraries/emails/email.templates';

@Injectable()
export class OrganizationService {
  constructor(
    private _organizationRepository: OrganizationRepository,
    private _notificationsService: NotificationService
  ) {}
  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & { providerId?: string },
    ip: string,
    userAgent: string
  ) {
    // Free 7-day trial is granted only the FIRST time an email is seen.
    // The TrialUsage table is permanent (survives account deletion), so a
    // user can't delete + re-register the same email to farm new trials.
    const allowTrial = true;

    const created = await this._organizationRepository.createOrgAndUser(
      body,
      process.env.REQUIRE_EMAIL_ACTIVATION === 'true' &&
        this._notificationsService.hasEmailProvider(),
      ip,
      userAgent,
      allowTrial
    );

    return created;
  }

  /** New org for a user who's already logged in — see repository method for why. */
  async createOrgForCurrentUser(userId: string, email: string, name: string) {
    const allowTrial = true;
    const created = await this._organizationRepository.createOrgForExistingUser(
      userId,
      name,
      allowTrial
    );
    return created;
  }

  async getCount() {
    return this._organizationRepository.getCount();
  }

  async getOrganizationProfile(id: string) {
    const org = await this._organizationRepository.getOrgById(id);
    return {
      name: org?.name ?? '',
      description: org?.description ?? '',
      logo: org?.logo ?? null,
      defaultTimezone: org?.defaultTimezone ?? null,
      referralSource: org?.referralSource ?? null,
      brandVoice: org?.brandVoice ?? null,
      brandAudience: org?.brandAudience ?? null,
      brandRules: org?.brandRules ?? null,
      brandForbiddenWords: org?.brandForbiddenWords ?? null,
    };
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
    const org = await this._organizationRepository.updateOrganizationProfile(id, data);
    return {
      name: org.name,
      description: org.description ?? '',
      logo: org.logo ?? null,
      defaultTimezone: org.defaultTimezone ?? null,
      referralSource: org.referralSource ?? null,
      brandVoice: org.brandVoice ?? null,
      brandAudience: org.brandAudience ?? null,
      brandRules: org.brandRules ?? null,
      brandForbiddenWords: org.brandForbiddenWords ?? null,
    };
  }

  async createMaxUser(id: string, name: string, saasName: string, email: string) {
    return this._organizationRepository.createMaxUser(id, name, saasName, email);
  }

  addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN'
  ) {
    return this._organizationRepository.addUserToOrg(userId, id, orgId, role);
  }

  getOrgById(id: string) {
    return this._organizationRepository.getOrgById(id);
  }

  getOrgByApiKey(api: string) {
    return this._organizationRepository.getOrgByApiKey(api);
  }

  getUserOrg(id: string) {
    return this._organizationRepository.getUserOrg(id);
  }

  getOrgsByUserId(userId: string) {
    return this._organizationRepository.getOrgsByUserId(userId);
  }

  updateApiKey(orgId: string) {
    return this._organizationRepository.updateApiKey(orgId);
  }

  getTeam(orgId: string) {
    return this._organizationRepository.getTeam(orgId);
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationRepository.setStreak(organizationId, type);
  }

  getOrgByCustomerId(customerId: string) {
    return this._organizationRepository.getOrgByCustomerId(customerId);
  }

  async inviteTeamMember(orgId: string, body: AddTeamMemberDto) {
    // Create the user immediately with a random one-time password.
    // The invited user logs in with this password and is forced to set
    // their own on the /setup screen (name=null triggers this).
    const oneTimePassword = makeId(12);
    const hashedPassword = AuthService.hashPassword(oneTimePassword);

    // Check if user with that email already exists.
    const existingUser = await this._organizationRepository.findUserByEmail(
      body.email
    );

    if (existingUser) {
      // Check if user is already active in this org.
      const existingLink = await this._organizationRepository.getUserOrgLink(
        orgId,
        existingUser.id,
      );

      if (existingLink && !existingLink.disabled) {
        return {
          email: body.email,
          password: null,
          message: 'This user is already a member of this organization.',
        };
      }

      // The email belongs to an existing account, which may live in a DIFFERENT
      // organization. Link — or re-enable — their membership here, but NEVER
      // touch their credentials. The old code reset the password on invite,
      // which let an admin of one org reset (and learn, via the response) the
      // password of a user who belongs to another org — a cross-tenant account
      // takeover. Existing users sign in with their own existing password.
      await this._organizationRepository.createUserOrgLink(
        orgId,
        existingUser.id,
        body.role as 'USER' | 'ADMIN'
      );

      return {
        email: body.email,
        password: null,
        message:
          'Existing user added to the organization. They sign in with their existing password.',
      };
    }

    // Create new user + add to org.
    const newUser = await this._organizationRepository.createUserForOrg(
      orgId,
      {
        email: body.email.toLowerCase(),
        password: hashedPassword,
        role: body.role as 'USER' | 'ADMIN',
      }
    );

    if (body.sendEmail) {
      await this._notificationsService.sendEmail(
        body.email,
        'Your PostSider account is ready',
        teamInviteEmail(body.email, oneTimePassword)
      );
    }

    return {
      id: newUser?.user?.id || newUser?.userId || null,
      email: body.email,
      password: oneTimePassword,
      message: 'User created. Share the one-time password with them.',
    };
  }

  async deleteTeamMember(org: Organization, userId: string) {
    const userOrgs = await this._organizationRepository.getOrgsByUserId(userId);
    const findOrgToDelete = userOrgs.find((orgUser) => orgUser.id === org.id);
    if (!findOrgToDelete) {
      throw new Error('User is not part of this organization');
    }

    // @ts-ignore
    const myRole = org.users[0].role;
    const userRole = findOrgToDelete.users[0].role;
    const myLevel = myRole === 'USER' ? 0 : myRole === 'ADMIN' ? 1 : 2;
    const userLevel = userRole === 'USER' ? 0 : userRole === 'ADMIN' ? 1 : 2;

    if (myLevel < userLevel) {
      throw new Error('You do not have permission to delete this user');
    }

    // Equal-privilege check: myLevel < userLevel only blocks escalation, so a
    // SUPERADMIN could delete the other SUPERADMIN (the org's only owner).
    if (userRole === 'SUPERADMIN') {
      throw new Error('The organization owner cannot be removed');
    }

    return this._organizationRepository.deleteTeamMember(org.id, userId);
  }

  async changeTeamMemberRole(orgId: string, userId: string, role: 'ADMIN' | 'USER') {
    return this._organizationRepository.changeTeamMemberRole(orgId, userId, role);
  }

  async getMediaStats(orgId: string) {
    return this._organizationRepository.getMediaStats(orgId);
  }

  async listApiKeys(orgId: string) {
    return this._organizationRepository.listApiKeys(orgId);
  }

  async createApiKey(orgId: string, name: string) {
    return this._organizationRepository.createApiKey(orgId, name);
  }

  async renameApiKey(orgId: string, keyId: string, name: string) {
    return this._organizationRepository.renameApiKey(orgId, keyId, name);
  }

  async deleteApiKey(orgId: string, keyId: string) {
    return this._organizationRepository.deleteApiKey(orgId, keyId);
  }

  disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    return this._organizationRepository.disableOrEnableNonSuperAdminUsers(
      orgId,
      disable
    );
  }

  getShortlinkPreference(orgId: string) {
    return this._organizationRepository.getShortlinkPreference(orgId);
  }

  /**
   * Permanently delete an organization and all of its data, then remove the
   * user if they no longer belong to any organization. Irreversible.
   */
  async deleteAccount(orgId: string, userId: string) {
    await this._organizationRepository.deleteOrganizationCascade(orgId);
    await this._organizationRepository.deleteUserIfOrphan(userId);
    return { deleted: true };
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organizationRepository.updateShortlinkPreference(
      orgId,
      shortlink
    );
  }
}
