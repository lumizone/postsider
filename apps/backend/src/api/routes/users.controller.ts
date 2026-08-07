import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { SubscriptionService } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { PolarService } from '@postsider/nestjs-libraries/services/polar.service';
import { isBillingEnabled } from '@postsider/nestjs-libraries/services/billing.flag';
import { isPlatformAiEnabled } from '@postsider/nestjs-libraries/services/ai.flag';
import { Response, Request } from 'express';
import { AuthService } from '@postsider/backend/services/auth/auth.service';
import { AuthService as AuthChecker } from '@postsider/helpers/auth/auth.service';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { getCookieUrlFromDomain } from '@postsider/helpers/subdomain/subdomain.management';
import { pricing } from '@postsider/nestjs-libraries/database/prisma/subscriptions/pricing';
import { ApiTags } from '@nestjs/swagger';
import { UsersService } from '@postsider/nestjs-libraries/database/prisma/users/users.service';
import { UserDetailDto } from '@postsider/nestjs-libraries/dtos/users/user.details.dto';
import { EmailNotificationsDto } from '@postsider/nestjs-libraries/dtos/users/email-notifications.dto';
import { HttpForbiddenException } from '@postsider/nestjs-libraries/services/exception.filter';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@postsider/nestjs-libraries/user/user.agent';
import { TrackEnum } from '@postsider/nestjs-libraries/user/track.enum';
import { TrackService } from '@postsider/nestjs-libraries/track/track.service';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { AuthorizationActions, Sections } from '@postsider/backend/services/auth/permissions/permission.exception.class';

@ApiTags('User')
@Controller('/user')
export class UsersController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _polarService: PolarService,
    private _authService: AuthService,
    private _orgService: OrganizationService,
    private _userService: UsersService,
    private _trackService: TrackService
  ) {}
  @Get('/self')
  async getSelf(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Req() req: Request
  ) {
    if (!organization) {
      throw new HttpForbiddenException();
    }

    const impersonate = req.cookies.impersonate || req.headers.impersonate;
    const billingOn = isBillingEnabled();
    // @ts-ignore
    const hasPaidSub = !!organization?.subscription;
    const onTrial = billingOn && !!organization?.isTrailing && !hasPaidSub;
    // Trial runs 7 days from org creation. Clamp at 0.
    let trialDaysLeft: number | null = null;
    if (onTrial && organization?.createdAt) {
      const end = new Date(organization.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000;
      const msLeft = end - Date.now();
      trialDaysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
    }
    // @ts-ignore
    return {
      ...user,
      orgId: organization.id,
      // @ts-ignore
      totalChannels: !billingOn ? 10000 : organization?.subscription?.totalChannels || pricing.FREE.channel,
      // @ts-ignore
      tier: organization?.subscription?.subscriptionTier || (!billingOn ? 'ULTIMATE' : 'FREE'),
      // @ts-ignore
      role: organization?.users[0]?.role,
      // @ts-ignore
      isLifetime: !!organization?.subscription?.isLifetime,
      admin: !!user.isSuperAdmin,
      impersonate: !!impersonate,
      isTrailing: !billingOn ? false : organization?.isTrailing,
      allowTrial: organization?.allowTrial,
      onTrial,
      trialDaysLeft,
      streakSince: organization?.streakSince || null,
      // @ts-ignore
      publicApi: organization?.users[0]?.role === 'SUPERADMIN' || organization?.users[0]?.role === 'ADMIN' ? organization?.apiKey : '',
      isPlatformAi: isPlatformAiEnabled(),
    };
  }

  @Get('/personal')
  async getPersonalInformation(@GetUserFromRequest() user: User) {
    return this._userService.getPersonal(user.id);
  }

  @Post('/change-password')
  async changePassword(
    @GetUserFromRequest() user: User,
    @Body() body: { currentPassword: string; newPassword: string }
  ) {
    if (!body.newPassword || body.newPassword.length < 8) {
      throw new HttpException('New password must be at least 8 characters', 400);
    }

    // Load the full user row to compare hashed password.
    const fullUser = await this._userService.getUserById(user.id);
    if (!fullUser) {
      throw new HttpForbiddenException();
    }

    // If user has a password set, validate the current one.
    // Bootstrap/setup users may have an empty password field — skip for them.
    if (fullUser.password && fullUser.password.length > 0) {
      if (!body.currentPassword || !AuthChecker.comparePassword(body.currentPassword, fullUser.password)) {
        throw new HttpException('Current password is incorrect', 400);
      }
    }

    await this._userService.updatePassword(user.id, body.newPassword);
    return { changed: true };
  }

  /**
   * First-time account setup. Called once after the initial bootstrap login.
   * Allows the admin to set their real email, name and password.
   */
  @Post('/setup')
  async setupAccount(
    @GetUserFromRequest() user: User,
    @Body() body: { email?: string; name?: string; password?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    // First-time setup is only for the bootstrap admin placeholder account.
    // Once the operator has set their real email, this route is dead, so a
    // stolen session cannot use it to silently change the login email/password.
    if (user.email !== 'admin@setup.local') {
      throw new HttpForbiddenException();
    }

    if (body.password && body.password.length < 8) {
      throw new HttpException('Password must be at least 8 characters', 400);
    }

    // Build an update payload — only set what was provided.
    const data: Record<string, any> = {};
    if (body.email && body.email !== user.email) {
      const email = body.email.toLowerCase();
      const existing = await this._userService.getUserByEmail(email);
      if (existing) {
        throw new HttpException('Email already exists', 409);
      }
      data.email = email;
    }
    if (body.name) {
      data.name = body.name;
    }
    if (body.password) {
      data.password = AuthChecker.hashPassword(body.password);
    }

    if (Object.keys(data).length > 0) {
      await this._userService.setupUser(user.id, data);
    }

    // Re-issue JWT with updated data.
    const updatedUser = await this._userService.getUserById(user.id);
    if (updatedUser) {
      delete (updatedUser as any).password;
      const jwt = AuthChecker.signJWT(updatedUser);
      response.header('auth', jwt);
    }

    return { setup: true };
  }

  @Get('/impersonate')
  async getImpersonate(
    @GetUserFromRequest() user: User,
    @Query('name') name: string
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    return this._userService.getImpersonateUser(name);
  }

  @Post('/impersonate')
  async setImpersonate(
    @GetUserFromRequest() user: User,
    @Body('id') id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    response.cookie('impersonate', id, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
    });

    if (process.env.NOT_SECURED) {
      response.header('impersonate', id);
    }
  }

  @Post('/personal')
  async changePersonal(
    @GetUserFromRequest() user: User,
    @Body() body: UserDetailDto
  ) {
    return this._userService.changePersonal(user.id, body);
  }

  @Get('/email-notifications')
  async getEmailNotifications(@GetUserFromRequest() user: User) {
    return this._userService.getEmailNotifications(user.id);
  }

  @Post('/email-notifications')
  async updateEmailNotifications(
    @GetUserFromRequest() user: User,
    @Body() body: EmailNotificationsDto
  ) {
    return this._userService.updateEmailNotifications(user.id, body);
  }

  @Post('/api-key/rotate')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async rotateApiKey(@GetOrgFromRequest() organization: Organization) {
    return this._orgService.updateApiKey(organization.id);
  }

  @Get('/subscription')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getSubscription(@GetOrgFromRequest() organization: Organization) {
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organization.id
      );

    return subscription ? { subscription } : { subscription: undefined };
  }

  @Get('/subscription/tiers')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async tiers() {
    return this._polarService.getPackages();
  }

  @Post('/join-org')
  async joinOrg(
    @GetUserFromRequest() user: User,
    @Body('org') org: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const getOrgFromCookie = this._authService.getOrgFromCookie(org);

    if (!getOrgFromCookie) {
      return response.status(200).json({ id: null });
    }

    const addedOrg = await this._orgService.addUserToOrg(
      user.id,
      getOrgFromCookie.id,
      getOrgFromCookie.orgId,
      getOrgFromCookie.role
    );

    response.status(200).json({
      id: typeof addedOrg !== 'boolean' ? addedOrg.organizationId : null,
    });
  }

  @Get('/organizations')
  async getOrgs(@GetUserFromRequest() user: User) {
    return (await this._orgService.getOrgsByUserId(user.id)).filter(
      (f) => !f.users?.[0]?.disabled
    );
  }

  // Lets an already-logged-in user create an ADDITIONAL organization (e.g.
  // an agency onboarding a new client) without touching the public signup
  // flow — unrelated to DISABLE_REGISTRATION, which gates new people
  // joining the platform, not more orgs under an existing account.
  @Post('/organizations')
  async createOrg(
    @GetUserFromRequest() user: User,
    @Body('name') name: string
  ) {
    const trimmed = (name || '').trim();
    if (!trimmed) {
      throw new BadRequestException('Organization name is required');
    }
    return this._orgService.createOrgForCurrentUser(
      user.id,
      user.email,
      trimmed
    );
  }

  @Post('/change-org')
  changeOrg(
    @Body('id') id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    response.cookie('showorg', id, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
    });

    if (process.env.NOT_SECURED) {
      response.header('showorg', id);
    }

    response.status(200).send();
  }

  @Post('/logout')
  logout(@Res({ passthrough: true }) response: Response) {
    response.header('logout', 'true');
    response.cookie('auth', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.cookie('showorg', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.cookie('impersonate', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'none',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.status(200).send();
  }

  @Post('/t')
  async trackEvent(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @GetUserFromRequest() user: User,
    @RealIP() ip: string,
    @UserAgent() userAgent: string,
    @Body()
    body: { tt: TrackEnum; fbclid: string; additional: Record<string, any> }
  ) {
    const uniqueId = req?.cookies?.track || makeId(10);
    const fbclid = req?.cookies?.fbclid || body.fbclid;
    await this._trackService.track(
      uniqueId,
      ip,
      userAgent,
      body.tt,
      body.additional,
      fbclid,
      user
    );
    if (!req.cookies.track) {
      res.cookie('track', uniqueId, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
              sameSite: 'none',
            }
          : {}),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      });
    }

    res.status(200).json({
      track: uniqueId,
    });
  }
}
