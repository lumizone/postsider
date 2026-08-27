import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { User } from '@prisma/client';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@postsider/nestjs-libraries/database/prisma/users/users.service';
import {
  getCookieUrlFromDomain,
  legacyCookieDomain,
} from '@postsider/helpers/subdomain/subdomain.management';
import { HttpForbiddenException } from '@postsider/nestjs-libraries/services/exception.filter';
import { MfaService } from './mfa.service';

export const removeAuth = (res: Response) => {
  const flags = {
    ...(!process.env.NOT_SECURED
      ? {
          secure: true,
          httpOnly: true,
          sameSite: 'none' as const,
        }
      : {}),
    expires: new Date(0),
    maxAge: -1,
  };

  // Clear the cookie in BOTH scopes. Sessions issued before the host-only
  // switch carry `domain=.<registrable>`, and a host-only clear does not touch
  // them — logging out would leave the old cookie alive and the user signed in.
  res.cookie('auth', '', {
    ...flags,
    domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
  });
  const legacyDomain = legacyCookieDomain(process.env.FRONTEND_URL!);
  if (legacyDomain) {
    res.cookie('auth', '', { ...flags, domain: legacyDomain });
  }

  res.header('logout', 'true');
};

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private _organizationService: OrganizationService,
    private _userService: UsersService,
    private _mfaService: MfaService
  ) {}
  async use(req: Request, res: Response, next: NextFunction) {
    const auth = req.headers.auth || req.cookies.auth;
    if (!auth) {
      throw new HttpForbiddenException();
    }
    try {
      // Verify the JWT signature only. Never trust authorization-relevant
      // claims (id, isSuperAdmin, activated) from the token body — always
      // re-resolve the user from the database using the id.
      const payload = AuthService.verifyJWT(auth) as User | null;
      const orgHeader = req.cookies.showorg || req.headers.showorg;

      if (!payload?.id) {
        throw new HttpForbiddenException();
      }

      let user = (await this._userService.getUserById(payload.id)) as User | null;

      if (!user) {
        throw new HttpForbiddenException();
      }

      if (!user.activated) {
        throw new HttpForbiddenException();
      }

      // MFA policy changes must take effect for already-issued sessions too.
      // The only unauthenticated enrollment path is AuthController's two
      // challenge-validated /auth/mfa/enroll/* endpoints; this middleware
      // applies solely to authenticated controllers and therefore must not
      // leave their full session usable while enrollment is required.
      if (await this._mfaService.requiresEnrollment(user)) {
        removeAuth(res);
        throw new HttpForbiddenException();
      }

      const impersonate = req.cookies.impersonate || req.headers.impersonate;
      if (user?.isSuperAdmin && impersonate) {
        const loadImpersonate = await this._organizationService.getUserOrg(
          impersonate
        );

        if (loadImpersonate) {
          user = loadImpersonate.user;
          user.isSuperAdmin = true;
          delete (user as any).password;

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.user = user;

          // @ts-ignore
          loadImpersonate.organization.users =
            loadImpersonate.organization.users.filter(
              (f) => f.userId === user!.id
            );
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.org = loadImpersonate.organization;
          next();
          return;
        }
      }

      delete (user as any).password;
      delete (user as any).mfaSecret;
      delete (user as any).mfaPendingSecret;
      delete (user as any).mfaEnabledAt;
      delete (user as any).mfaRecoveryCodes;
      const organization = (
        await this._organizationService.getOrgsByUserId(user.id)
      ).filter((f) => !f.users[0].disabled);

      if (!organization || organization.length === 0) {
        throw new HttpForbiddenException();
      }

      const setOrg =
        organization.find((org) => org.id === orgHeader) || organization[0];

      if (!setOrg.apiKey) {
        await this._organizationService.updateApiKey(setOrg.id);
      }

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      req.user = user;

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      req.org = setOrg;
    } catch (err) {
      throw new HttpForbiddenException();
    }
    next();
  }
}
