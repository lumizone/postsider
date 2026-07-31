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
    if (
      request.path.startsWith('/auth') ||
      request.path.startsWith('/public') ||
      request.path.startsWith('/integrations/social-connect') ||
      request.path.startsWith('/integrations/provider/')
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
