import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';

import { CreateOrgUserDto } from '@postsider/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@postsider/nestjs-libraries/dtos/auth/login.user.dto';
import { AuthService } from '@postsider/backend/services/auth/auth.service';
import { ForgotReturnPasswordDto } from '@postsider/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { ForgotPasswordDto } from '@postsider/nestjs-libraries/dtos/auth/forgot.password.dto';
import { ResendActivationDto } from '@postsider/nestjs-libraries/dtos/auth/resend-activation.dto';
import { ApiTags } from '@nestjs/swagger';
import { getCookieUrlFromDomain } from '@postsider/helpers/subdomain/subdomain.management';
import { EmailService } from '@postsider/nestjs-libraries/services/email.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@postsider/nestjs-libraries/user/user.agent';
import { Provider, User } from '@prisma/client';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import * as Sentry from '@sentry/nestjs';
import { AuthRateLimitGuard } from '@postsider/nestjs-libraries/services/auth-rate-limit.guard';
import { MfaService } from '@postsider/backend/services/auth/mfa.service';
import { AuthService as AuthChecker } from '@postsider/helpers/auth/auth.service';

@ApiTags('Auth')
@Controller('/auth')
export class AuthController {
  constructor(
    private _authService: AuthService,
    private _emailService: EmailService,
    private _audit: AuditLogger,
    private _mfa: MfaService
  ) {}

  @Get('/can-register')
  async canRegister() {
    return {
      register: await this._authService.canRegister(Provider.LOCAL as string),
    };
  }

  @Post('/register')
  @UseGuards(AuthRateLimitGuard)
  async register(
    @Req() req: Request,
    @Body() body: CreateOrgUserDto & { org?: string },
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      // Prefer the explicit ?org/body.org token from the invite link;
      // fall back to the legacy cookie when present. This keeps the
      // header-only flow (NOT_SECURED) working without cross-site cookies.
      const getOrgFromCookie = this._authService.getOrgFromCookie(
        body?.org || req?.cookies?.org
      );

      const { jwt, addedOrg, user } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie
      );

      if (!jwt) throw new Error('Unable to create session');

      await this._audit.logAuthEvent('auth.register', {
        email: body.email,
        ip,
        provider: body.provider,
      });

      const activationRequired =
        body.provider === 'LOCAL' &&
        this._emailService.hasProvider() &&
        process.env.REQUIRE_EMAIL_ACTIVATION === 'true';

      if (activationRequired) {
        response.header('activate', 'true');
        response.status(200).json({ activate: true });
        return;
      }

      if (await this._mfa.requiresEnrollment(user)) {
        return this.requireMfaEnrollment(response, user.id);
      }

      response.cookie('auth', jwt, {
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
        response.header('auth', jwt);
      }

      if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
        response.cookie('showorg', addedOrg.organizationId, {
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
          response.header('showorg', addedOrg.organizationId);
        }
      }

      Sentry.metrics.count('new_user', 1);
      response.header('onboarding', 'true');
      response.status(200).json({
        register: true,
      });
    } catch (e: any) {
      response.status(400).send(e.message);
    }
  }

  @Post('/login')
  @UseGuards(AuthRateLimitGuard)
  async login(
    @Req() req: Request,
    @Body() body: LoginUserDto & { org?: string },
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this._authService.getOrgFromCookie(
        body?.org || req?.cookies?.org
      );

      const { addedOrg, user } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie,
        false
      );

      if (await this._mfa.requiresEnrollment(user)) {
        return this.requireMfaEnrollment(response, user.id);
      }

      if (user.mfaEnabledAt) {
        return this.requireMfa(response, user.id);
      }

      const jwt = await this._authService.issueSession(user);

      await this._audit.logAuthEvent('auth.login', {
        email: body.email,
        ip,
        provider: body.provider,
      });

      response.cookie('auth', jwt, {
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
        response.header('auth', jwt);
      }

      if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
        response.cookie('showorg', addedOrg.organizationId, {
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
          response.header('showorg', addedOrg.organizationId);
        }
      }

      response.header('reload', 'true');
      response.status(200).json({
        login: true,
      });
    } catch (e: any) {
      // Wrong password, unknown account, unactivated account — all land here.
      // The trail records the attempt, never the reason, so it cannot be used
      // to enumerate accounts.
      await this._audit.logAuthEvent('auth.login_failed', {
        email: body.email,
        ip,
        provider: body.provider,
      });
      response.status(400).send(e.message);
    }
  }

  @Post('/forgot')
  @UseGuards(AuthRateLimitGuard)
  async forgot(@Body() body: ForgotPasswordDto, @RealIP() ip: string) {
    try {
      await this._audit.logAuthEvent('auth.password_reset_requested', {
        email: body.email,
        ip,
      });
      await this._authService.forgot(body.email);
      return {
        forgot: true,
      };
    } catch (e) {
      return {
        forgot: false,
      };
    }
  }

  @Post('/forgot-return')
  @UseGuards(AuthRateLimitGuard)
  async forgotReturn(
    @Body() body: ForgotReturnPasswordDto,
    @RealIP() ip: string
  ) {
    const reset = await this._authService.forgotReturn(body);
    if (reset) {
      // A completed reset changes who can sign in — the single most useful
      // line in the trail when an account is disputed.
      await this._audit.logAuthEvent('auth.password_reset', { ip });
    }
    return {
      reset: !!reset,
    };
  }

  @Post('/mfa/verify')
  @UseGuards(AuthRateLimitGuard)
  async verifyMfa(
    @Req() req: Request,
    @Body('code') code: string,
    @Res({ passthrough: false }) response: Response
  ) {
    try {
      const challenge = AuthChecker.verifyJWT(req.cookies?.mfa) as {
        purpose?: string;
        userId?: string;
      };
      if (challenge?.purpose !== 'mfa' || !challenge.userId)
        throw new Error('Invalid challenge');
      const valid =
        (await this._mfa.verifySecondFactor(challenge.userId, code)) ||
        (await this._mfa.useRecoveryCode(challenge.userId, code));
      if (!valid) throw new Error('Invalid code');
      const user = await this._authService.getUserById(challenge.userId);
      if (!user) throw new Error('Unknown user');
      this.setAuthCookie(response, await this._authService.issueSession(user));
      response.cookie('mfa', '', {
        ...this.cookieFlags(),
        maxAge: -1,
        expires: new Date(0),
      });
      await this._audit.logAuthEvent('auth.mfa_verified', { userId: user.id });
      return response.status(200).json({ login: true });
    } catch {
      await this._audit.logAuthEvent('auth.mfa_failed', {});
      return response
        .status(400)
        .send('Invalid authenticator or recovery code');
    }
  }

  @Post('/mfa/enroll/begin')
  @UseGuards(AuthRateLimitGuard)
  async beginMfaEnrollment(
    @Req() req: Request,
    @Res({ passthrough: false }) response: Response
  ) {
    if (!this.hasValidEnrollmentOrigin(req)) {
      return response.status(403).send('Invalid enrollment origin');
    }
    try {
      const user = await this.getEnrollmentChallengeUser(req);
      if (!(await this._mfa.requiresEnrollment(user))) {
        throw new Error('Enrollment is no longer required');
      }
      const enrollment = await this._mfa.beginEnrollment(user.id, user.email);
      await this._audit.logAuthEvent('auth.mfa_setup_started', { userId: user.id });
      return response.status(200).json(enrollment);
    } catch {
      return response.status(400).send('Invalid enrollment challenge');
    }
  }

  @Post('/mfa/enroll/confirm')
  @UseGuards(AuthRateLimitGuard)
  async confirmMfaEnrollment(
    @Req() req: Request,
    @Body('code') code: string,
    @Res({ passthrough: false }) response: Response
  ) {
    if (!this.hasValidEnrollmentOrigin(req)) {
      return response.status(403).send('Invalid enrollment origin');
    }
    try {
      const user = await this.getEnrollmentChallengeUser(req);
      if (!(await this._mfa.requiresEnrollment(user))) {
        throw new Error('Enrollment is no longer required');
      }
      const result = await this._mfa.confirmEnrollment(user.id, code);
      this.clearMfaEnrollmentChallenge(response);
      this.setAuthCookie(response, await this._authService.issueSession(user));
      await this._audit.logAuthEvent('auth.mfa_enabled', { userId: user.id });
      return response.status(200).json(result);
    } catch {
      await this._audit.logAuthEvent('auth.mfa_failed', {});
      return response
        .status(400)
        .send('Invalid enrollment challenge or authenticator code');
    }
  }

  private requireMfa(response: Response, userId: string) {
    response.cookie(
      'mfa',
      AuthChecker.signSessionJWT({ purpose: 'mfa', userId }, 5 * 60),
      { ...this.cookieFlags(), maxAge: 5 * 60 * 1000 }
    );
    return response.status(202).json({ mfaRequired: true });
  }

  private requireMfaEnrollment(response: Response, userId: string) {
    response.cookie(
      'mfa_enroll',
      AuthChecker.signSessionJWT({ purpose: 'mfa_enrollment', userId }, 5 * 60),
      { ...this.cookieFlags(), httpOnly: true, maxAge: 5 * 60 * 1000 }
    );
    return response.status(202).json({ mfaEnrollmentRequired: true });
  }

  private async getEnrollmentChallengeUser(req: Request) {
    const challenge = AuthChecker.verifyJWT(req.cookies?.mfa_enroll) as {
      purpose?: string;
      userId?: string;
    };
    if (challenge?.purpose !== 'mfa_enrollment' || !challenge.userId) {
      throw new Error('Invalid enrollment challenge');
    }
    const user = await this._authService.getUserById(challenge.userId);
    if (!user) throw new Error('Unknown user');
    return user;
  }

  // The enrollment challenge is an HttpOnly SameSite=None cookie so the app
  // can use it across its API subdomain. Require the browser's exact frontend
  // origin before acting on that cookie, rather than trusting a host header.
  private hasValidEnrollmentOrigin(req: Request) {
    const origin = req.headers.origin;
    const frontendUrl = process.env.FRONTEND_URL;
    if (typeof origin !== 'string' || !frontendUrl) return false;
    try {
      return new URL(origin).origin === new URL(frontendUrl).origin;
    } catch {
      return false;
    }
  }

  private clearMfaEnrollmentChallenge(response: Response) {
    response.cookie('mfa_enroll', '', {
      ...this.cookieFlags(),
      httpOnly: true,
      maxAge: -1,
      expires: new Date(0),
    });
  }

  private cookieFlags() {
    return {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? { secure: true, httpOnly: true, sameSite: 'none' as const }
        : {}),
    };
  }

  private setAuthCookie(response: Response, jwt: string) {
    response.cookie('auth', jwt, {
      ...this.cookieFlags(),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
    });
  }

  @Get('/oauth-mobile-callback')
  mobileCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const scheme = process.env.MOBILE_APP_SCHEME || 'postsider://auth/callback';
    const params = new URLSearchParams();
    if (code) params.set('code', code);
    if (state) params.set('state', state);
    return response.redirect(302, `${scheme}?${params.toString()}`);
  }

  @Get('/oauth/:provider')
  async oauthLink(@Param('provider') provider: string, @Query() query: any) {
    return this._authService.oauthLink(provider, query);
  }

  @Post('/activate')
  @UseGuards(AuthRateLimitGuard)
  async activate(
    @Body('code') code: string,
    @Body('datafast_visitor_id') datafast_visitor_id: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const activate = await this._authService.activate(
      code,
      datafast_visitor_id
    );
    if (!activate) {
      return response.status(200).json({ can: false });
    }

    const activatedUser = AuthChecker.verifyJWT(activate) as { id?: string };
    const user = activatedUser.id
      ? await this._authService.getUserById(activatedUser.id)
      : null;
    if (user && (await this._mfa.requiresEnrollment(user))) {
      return this.requireMfaEnrollment(response, user.id);
    }

    response.cookie('auth', activate, {
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
      response.header('auth', activate);
    }

    response.header('onboarding', 'true');

    return response.status(200).json({ can: true });
  }

  @Post('/resend-activation')
  @UseGuards(AuthRateLimitGuard)
  async resendActivation(@Body() body: ResendActivationDto) {
    try {
      await this._authService.resendActivationEmail(body.email);
    } catch (e) {
      // Do not disclose whether the address exists (email-bombing / enumeration
      // vector); the rate-limit guard bounds the cost of a legit typo retry.
      console.error('resend-activation failed', e);
    }
    return {
      success: true,
    };
  }

  @Post('/oauth/:provider/exists')
  @UseGuards(AuthRateLimitGuard)
  async oauthExists(
    @Body('code') code: string,
    @Body('redirect_uri') redirect_uri: string,
    @Param('provider') provider: string,
    @Res({ passthrough: false }) response: Response
  ) {
    let token: string | undefined;
    let user: User | undefined;
    try {
      ({ token, user } = await this._authService.checkExists(
        provider,
        code,
        redirect_uri,
        false
      ));
    } catch (e) {
      console.error('OAuth exists check failed', e);
      return response.status(400).send('OAuth verification failed');
    }

    if (token) {
      return response.json({ token });
    }

    if (!user) {
      return response.status(400).send('OAuth verification failed');
    }

    if (await this._mfa.requiresEnrollment(user)) {
      return this.requireMfaEnrollment(response, user.id);
    }

    if (user.mfaEnabledAt) {
      return this.requireMfa(response, user.id);
    }

    const jwt = await this._authService.issueSession(user);

    response.cookie('auth', jwt, {
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
      response.header('auth', jwt);
    }

    response.header('reload', 'true');

    response.status(200).json({
      login: true,
    });
  }
}
