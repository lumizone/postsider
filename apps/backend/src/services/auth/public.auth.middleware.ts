import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { OAuthService } from '@postsider/nestjs-libraries/database/prisma/oauth/oauth.service';
import { HttpForbiddenException } from '@postsider/nestjs-libraries/services/exception.filter';
import { isBillingEnabled } from '@postsider/nestjs-libraries/services/billing.flag';
import { pricing } from '@postsider/nestjs-libraries/database/prisma/subscriptions/pricing';

@Injectable()
export class PublicAuthMiddleware implements NestMiddleware {
  constructor(
    private _organizationService: OrganizationService,
    private _oauthService: OAuthService
  ) {}
  async use(req: Request, res: Response, next: NextFunction) {
    const auth = (req.headers.authorization ||
      req.headers.Authorization) as string;
    if (!auth) {
      res.status(HttpStatus.UNAUTHORIZED).json({ msg: 'No API Key found' });
      return;
    }
    try {
      if (auth.startsWith('pos_')) {
        const authorization = await this._oauthService.getOrgByOAuthToken(auth);
        if (!authorization) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'Invalid OAuth token' });
          return;
        }

        const org = authorization.organization;
        if (isBillingEnabled() && !org.subscription) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'No subscription found' });
          return;
        }
        if (isBillingEnabled() && !pricing[org.subscription?.subscriptionTier || 'FREE']?.public_api) {
          res.status(HttpStatus.PAYMENT_REQUIRED).json({ msg: 'Public API is not available on this plan' });
          return;
        }

        // @ts-ignore
        req.org = { ...org, users: [{ role: 'SUPERADMIN', disabled: false }] };
      } else {
        const org = await this._organizationService.getOrgByApiKey(auth);
        if (!org) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'Invalid API key' });
          return;
        }

        if (isBillingEnabled() && !org.subscription) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'No subscription found' });
          return;
        }
        if (isBillingEnabled() && !pricing[org.subscription?.subscriptionTier || 'FREE']?.public_api) {
          res.status(HttpStatus.PAYMENT_REQUIRED).json({ msg: 'Public API is not available on this plan' });
          return;
        }

        // @ts-ignore
        req.org = { ...org, users: [{ role: 'SUPERADMIN', disabled: false }] };
      }
    } catch (err) {
      throw new HttpForbiddenException();
    }
    next();
  }
}
