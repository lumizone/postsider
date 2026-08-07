import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AppAbility,
  PermissionsService,
} from '@postsider/backend/services/auth/permissions/permissions.service';
import {
  AbilityPolicy,
  CHECK_POLICIES_KEY,
} from '@postsider/backend/services/auth/permissions/permissions.ability';
import { Organization } from '@prisma/client';
import { Request } from 'express';
import { SubscriptionException } from './permission.exception.class';
import { HttpForbiddenException } from '@postsider/nestjs-libraries/services/exception.filter';

@Injectable()
export class PoliciesGuard implements CanActivate {
  constructor(
    private _reflector: Reflector,
    private _authorizationService: PermissionsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request: Request = context.switchToHttp().getRequest();
    // BILLING AUDIT FIX (2026-08-06): this guard is registered globally
    // (APP_GUARD in app.module.ts), so these string-prefix bypasses applied
    // to EVERY route under the given path, not just the ones that actually
    // needed an exemption:
    //   - '/public' matched BOTH the truly-anonymous PublicController
    //     (no @CheckPolicies there, would have passed anyway via the
    //     policyHandlers.length===0 check below) AND the entire Public API
    //     (/public/v1/*, PublicIntegrationsController), which DOES have
    //     @CheckPolicies([Create, POSTS_PER_MONTH]) / ([Create, CHANNEL]) —
    //     PublicAuthMiddleware already sets req.org for every Public API
    //     request (verified), so there was no technical reason to bypass
    //     it; the effect was that a Public API key could publish and
    //     connect channels with the plan's limits completely unenforced.
    //   - '/integrations/provider/' matched IntegrationsController's
    //     /provider/:id/connect, which runs through the normal
    //     AuthMiddleware (req.org is set) — no reason to bypass either.
    // '/integrations/social-connect' is kept: NoAuthIntegrationsController
    // is NOT in authenticatedController (api.module.ts), so AuthMiddleware
    // never runs there and req.org is never set — the fail-closed check
    // below would 403 every legitimate OAuth connect without this
    // exemption. That endpoint now has its own manual channel-limit check
    // (see no.auth.integrations.controller.ts) since @CheckPolicies can
    // never fire for it.
    if (
      request.path.startsWith('/auth') ||
      request.path.startsWith('/integrations/social-connect')
    ) {
      return true;
    }

    const policyHandlers =
      this._reflector.get<AbilityPolicy[]>(
        CHECK_POLICIES_KEY,
        context.getHandler()
      ) || [];

    if (!policyHandlers || !policyHandlers.length) {
      return true;
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const { org }: { org: Organization } = request;

    const refreshChannelId = typeof request.query?.refresh === 'string' ? request.query.refresh : undefined;

    // Fail closed: a route reached without the auth middleware (or with an empty
    // users relation) must deny, not crash with a 500.
    // @ts-ignore
    const role = org?.users?.[0]?.role;
    if (!org?.id || !role) {
      throw new HttpForbiddenException();
    }

    // @ts-ignore
    const ability = await this._authorizationService.check(org.id, org.createdAt, role, policyHandlers, refreshChannelId);

    const item = policyHandlers.find(
      (handler) => !this.execPolicyHandler(handler, ability)
    );

    if (item) {
      throw new SubscriptionException({
        section: item[1],
        action: item[0],
      });
    }

    return true;
  }

  private execPolicyHandler(handler: AbilityPolicy, ability: AppAbility) {
    return ability.can(handler[0], handler[1]);
  }
}
