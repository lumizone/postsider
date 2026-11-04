import { HttpStatus, Injectable, NestMiddleware, Optional } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { OAuthService } from '@postsider/nestjs-libraries/database/prisma/oauth/oauth.service';
import { HttpForbiddenException } from '@postsider/nestjs-libraries/services/exception.filter';
import { isBillingEnabled } from '@postsider/nestjs-libraries/services/billing.flag';
import { tokenAllows } from '@postsider/nestjs-libraries/database/prisma/oauth/mcp-scope-policy';
import { grantedScopesForOAuth } from '@postsider/nestjs-libraries/services/public-api-oauth-scopes';
import { pricing } from '@postsider/nestjs-libraries/database/prisma/subscriptions/pricing';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';
import { actorFromPublicCredential } from '@postsider/nestjs-libraries/actor/post-actor';
import { FunnelAttributionService } from '@postsider/nestjs-libraries/database/prisma/attribution/funnel-attribution.service';

@Injectable()
export class PublicAuthMiddleware implements NestMiddleware {
  constructor(
    private _organizationService: OrganizationService,
    private _oauthService: OAuthService,
    @Optional() private _funnelAttribution?: FunnelAttributionService
  ) {}
  async use(req: Request, res: Response, next: NextFunction) {
    const auth = (req.headers.authorization ||
      req.headers.Authorization) as string;
    if (!auth) {
      res.status(HttpStatus.UNAUTHORIZED).json({ msg: 'No API Key found' });
      return;
    }
    try {
      const bearerOAuthToken = auth.match(/^Bearer\s+(pos_\S+)\s*$/i)?.[1];
      const oauthToken =
        bearerOAuthToken || (auth.startsWith('pos_') ? auth : null);

      if (oauthToken) {
        const authorization = await this._oauthService.getOrgByOAuthToken(
          oauthToken
        );
        if (!authorization) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'Invalid OAuth token' });
          return;
        }

        // A token minted by the MCP authorization server carries the scopes
        // the user approved. The MCP server enforces them per tool, but the
        // token also works against this API directly, so enforce them here too:
        // a read-only grant must not be able to write.
        const scopeCheck = tokenAllows(
          (authorization as { scopes?: string[] }).scopes,
          req.method,
          req.originalUrl || req.url
        );
        if (!scopeCheck.allowed) {
          res
            .status(HttpStatus.FORBIDDEN)
            .setHeader(
              'WWW-Authenticate',
              `Bearer error="insufficient_scope", scope="${scopeCheck.required}"`
            );
          res.json({
            msg: `This token does not include the ${scopeCheck.required} scope.`,
            error: 'insufficient_scope',
            scope: scopeCheck.required,
          });
          return;
        }

        const org = authorization.organization;
        if (isBillingEnabled() && !org.subscription) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'No subscription found' });
          return;
        }
        if (
          isBillingEnabled() &&
          !pricing[org.subscription?.subscriptionTier || 'FREE']?.public_api
        ) {
          res
            .status(HttpStatus.PAYMENT_REQUIRED)
            .json({ msg: 'Public API is not available on this plan' });
          return;
        }

        if (Array.isArray((authorization as { scopes?: string[] }).scopes) && typeof res.once === 'function') {
          // Successful use of a scoped MCP OAuth token, not merely pressing
          // "Connect" in the onboarding UI. Do not log the token or request.
          res.once('finish', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              void this._funnelAttribution?.recordMcpConnected(org.id).catch(() => {});
            }
          });
        }

        // @ts-ignore
        req.org = { ...org, users: [authorization.membership] };
        // Deny newly introduced webhook capabilities to legacy OAuth, and
        // enforce the actual consented grants for MCP OAuth.
        // @ts-ignore
        req.publicApiScopes = grantedScopesForOAuth((authorization as { scopes?: string[] }).scopes);
        const oauthAuthorization = authorization as {
          mcpOAuthClientId?: string;
          oauthAppId?: string;
          userId?: string;
        };
        const oauthClientId =
          oauthAuthorization.mcpOAuthClientId ?? oauthAuthorization.oauthAppId;
        // @ts-ignore
        req.publicApiCredential = {
          type: 'oauth',
          ...(oauthClientId ? { oauthClientId } : {}),
          ...(oauthAuthorization.userId
            ? { oauthUserId: oauthAuthorization.userId }
            : {}),
        };
      } else {
        const credential = await this._organizationService.resolvePublicApiCredential(auth);
        if (!credential) {
          res.status(HttpStatus.UNAUTHORIZED).json({ msg: 'Invalid API key' });
          return;
        }
        const org = credential.organization;

        if (isBillingEnabled() && !org.subscription) {
          res
            .status(HttpStatus.UNAUTHORIZED)
            .json({ msg: 'No subscription found' });
          return;
        }
        if (
          isBillingEnabled() &&
          !pricing[org.subscription?.subscriptionTier || 'FREE']?.public_api
        ) {
          res
            .status(HttpStatus.PAYMENT_REQUIRED)
            .json({ msg: 'Public API is not available on this plan' });
          return;
        }

        // @ts-ignore
        req.org = { ...org, users: [{ role: 'SUPERADMIN', disabled: false }] };
        // @ts-ignore
        req.publicApiScopes = credential.scopes;
        // @ts-ignore
        req.publicApiCredential = {
          type: credential.credentialType,
          ...(credential.apiKeyId ? { id: credential.apiKeyId } : {}),
        };
      }
    } catch (err) {
      throw new HttpForbiddenException();
    }
    // The actor comes only from the credential verified above, never from the
    // body or headers. Everything downstream of next() runs inside this context.
    runWithActor(
      // @ts-ignore
      actorFromPublicCredential(req.publicApiCredential),
      () => next()
    );
  }
}
