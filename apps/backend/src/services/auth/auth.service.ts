import { Injectable } from '@nestjs/common';
import { Provider, User } from '@prisma/client';
import { CreateOrgUserDto } from '@postsider/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@postsider/nestjs-libraries/dtos/auth/login.user.dto';
import { UsersService } from '@postsider/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { AuthService as AuthChecker } from '@postsider/helpers/auth/auth.service';
import { AuthProviderManager } from '@postsider/backend/services/auth/providers/providers.manager';
import dayjs from 'dayjs';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { ForgotReturnPasswordDto } from '@postsider/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { EmailService } from '@postsider/nestjs-libraries/services/email.service';
import { NewsletterService } from '@postsider/nestjs-libraries/newsletter/newsletter.service';
import { activateAccountEmail, resetPasswordEmail } from '@postsider/nestjs-libraries/emails/email.templates';

@Injectable()
export class AuthService {
  constructor(
    private _userService: UsersService,
    private _organizationService: OrganizationService,
    private _notificationService: NotificationService,
    private _emailService: EmailService,
    private _providerManager: AuthProviderManager
  ) {}
  async canRegister(provider: string, hasValidInvite = false) {
    if (
      process.env.DISABLE_REGISTRATION !== 'true' ||
      provider === Provider.GENERIC
    ) {
      return true;
    }

    // A signed invite from an existing org admin always opens the door,
    // regardless of DISABLE_REGISTRATION. The very first install (zero
    // orgs) is also allowed so the bootstrap CLI / first-run flow works.
    if (hasValidInvite) {
      return true;
    }

    return (await this._organizationService.getCount()) === 0;
  }

  async routeAuth(
    provider: Provider,
    body: CreateOrgUserDto | LoginUserDto,
    ip: string,
    userAgent: string,
    addToOrg?: boolean | { orgId: string; role: 'USER' | 'ADMIN'; id: string }
  ) {
    // Detect registration vs login by checking for the `company` field
    // (present only on CreateOrgUserDto). The `instanceof` check is unreliable
    // because NestJS ValidationPipe with intersection types doesn't always
    // produce a true class instance.
    const isRegistration = 'company' in body && !!(body as any).company;
    const hasValidInvite =
      !!addToOrg && typeof addToOrg !== 'boolean' && !!addToOrg.orgId;

    if (provider === Provider.LOCAL) {
      if (process.env.DISALLOW_PLUS && body.email.includes('+')) {
        throw new Error('Email with plus sign is not allowed');
      }
      if (isRegistration) {
        body.email = body.email.toLowerCase();
      }
      const user = await this._userService.getUserByEmail(body.email);
      if (isRegistration) {
        if (user) {
          throw new Error('Email already exists');
        }

        if (!(await this.canRegister(provider, hasValidInvite))) {
          throw new Error('Registration is disabled');
        }

        const create = await this._organizationService.createOrgAndUser(
          body as CreateOrgUserDto,
          ip,
          userAgent
        );

        const addedOrg =
          addToOrg && typeof addToOrg !== 'boolean'
            ? await this._organizationService.addUserToOrg(
                create.users[0].user.id,
                addToOrg.id,
                addToOrg.orgId,
                addToOrg.role
              )
            : false;

        const obj = { addedOrg, jwt: await this.jwt(create.users[0].user) };
        // The account is already committed at this point; a mail failure must not
        // fail the whole registration (the client could never retry — the email
        // would already be taken).
        this._emailService
          .sendEmail(
            body.email,
            'Activate your account',
            activateAccountEmail(`${process.env.FRONTEND_URL}/auth/activate/${obj.jwt}`),
            'top'
          )
          .catch(() => {});
        return obj;
      }

      if (!user || !AuthChecker.comparePassword(body.password, user.password!)) {
        throw new Error('Invalid user name or password');
      }

      if (!user.activated) {
        throw new Error('User is not activated');
      }

      return { addedOrg: false, jwt: await this.jwt(user) };
    }

    const user = await this.loginOrRegisterProvider(
      provider,
      body as CreateOrgUserDto,
      ip,
      userAgent,
      hasValidInvite
    );

    const addedOrg =
      addToOrg && typeof addToOrg !== 'boolean'
        ? await this._organizationService.addUserToOrg(
            user.id,
            addToOrg.id,
            addToOrg.orgId,
            addToOrg.role
          )
        : false;
    return { addedOrg, jwt: await this.jwt(user) };
  }

  public getOrgFromCookie(cookie?: string) {
    if (!cookie) {
      return false;
    }

    try {
      const getOrg: any = AuthChecker.verifyJWT(cookie);
      if (dayjs(getOrg.timeLimit).isBefore(dayjs())) {
        return false;
      }

      return getOrg as {
        email: string;
        role: 'USER' | 'ADMIN';
        orgId: string;
        id: string;
      };
    } catch (err) {
      return false;
    }
  }

  private async loginOrRegisterProvider(
    provider: Provider,
    body: CreateOrgUserDto,
    ip: string,
    userAgent: string,
    hasValidInvite = false
  ) {
    const providerInstance = this._providerManager.getProvider(provider);
    const providerUser = await providerInstance.getUser(body.providerToken);

    if (!providerUser) {
      throw new Error('Invalid provider token');
    }

    const user = await this._userService.getUserByProvider(
      providerUser.id,
      provider
    );
    if (user) {
      return user;
    }

    if (!(await this.canRegister(provider, hasValidInvite))) {
      throw new Error('Registration is disabled');
    }

    const create = await this._organizationService.createOrgAndUser(
      {
        company: body.company,
        email: providerUser.email,
        password: '',
        provider,
        providerId: providerUser.id,
        datafast_visitor_id: body.datafast_visitor_id,
      },
      ip,
      userAgent
    );

    this._track('register', providerUser.email, body.datafast_visitor_id).catch(
      (err) => {}
    );

    // Newsletter registration must not fail the auth flow — the org/user is
    // already persisted by this point.
    NewsletterService.register(providerUser.email).catch(() => {});

    try {
      if (providerInstance?.postRegistration) {
        await providerInstance.postRegistration(body.providerToken, create.id);
      }
    } catch (err) {
      // Don't fail registration if postRegistration fails
    }

    return create.users[0].user;
  }

  private async _track(
    name: string,
    email: string,
    datafast_visitor_id: string
  ) {
    if (email && datafast_visitor_id && process.env.DATAFAST_API_KEY) {
      try {
        await fetch('https://datafa.st/api/v1/goals', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.DATAFAST_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datafast_visitor_id: datafast_visitor_id,
            name: name,
            metadata: {
              email,
            },
          }),
        });
      } catch (err) {}
    }
  }

  async forgot(email: string) {
    const user = await this._userService.getUserByEmail(email);
    if (!user || user.providerName !== Provider.LOCAL) {
      return false;
    }

    const resetValues = AuthChecker.signJWT({
      id: user.id,
      expires: dayjs().add(20, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
    });

    await this._notificationService.sendEmail(
      user.email,
      'Reset your password',
      resetPasswordEmail(`${process.env.FRONTEND_URL}/auth/forgot/${resetValues}`)
    );
  }

  forgotReturn(body: ForgotReturnPasswordDto) {
    const user = AuthChecker.verifyJWT(body.token) as {
      id: string;
      expires: string;
    };
    if (dayjs(user.expires).isBefore(dayjs())) {
      return false;
    }

    return this._userService.updatePassword(user.id, body.password);
  }

  async activate(code: string, tracking: string) {
    const user = AuthChecker.verifyJWT(code) as {
      id: string;
      activated: boolean;
      email: string;
    };
    if (user.id && !user.activated) {
      const getUserAgain = await this._userService.getUserByEmail(user.email);
      if (getUserAgain!.activated) {
        return false;
      }
      await this._userService.activateUser(user.id);
      user.activated = true;
      this._track('register', user.email, tracking).catch((err) => {});
      NewsletterService.register(user.email).catch(() => {});
      return this.jwt(user as any);
    }

    return false;
  }

  async resendActivationEmail(email: string) {
    const user = await this._userService.getUserByEmail(email);

    if (!user) {
      throw new Error('User not found');
    }

    if (user.activated) {
      throw new Error('Account is already activated');
    }

    const jwt = await this.jwt(user);

    await this._emailService.sendEmail(
      user.email,
      'Activate your account',
      activateAccountEmail(`${process.env.FRONTEND_URL}/auth/activate/${jwt}`),
      'top'
    );

    return true;
  }

  oauthLink(provider: string, query?: any) {
    const providerInstance = this._providerManager.getProvider(provider);
    return providerInstance.generateLink(query);
  }

  async checkExists(provider: string, code: string, redirectUri?: string) {
    const providerInstance = this._providerManager.getProvider(provider);
    const token = await providerInstance.getToken(code, redirectUri);
    const user = await providerInstance.getUser(token);
    if (!user) {
      throw new Error('Invalid user');
    }
    const checkExists = await this._userService.getUserByProvider(
      user.id,
      provider as Provider
    );
    if (checkExists) {
      return { jwt: await this.jwt(checkExists) };
    }

    return { token };
  }

  private async jwt(user: User) {
    if (user.password) {
      delete (user as any).password;
    }
    return AuthChecker.signSessionJWT(user);
  }
}
