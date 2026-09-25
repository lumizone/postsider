import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PUBLIC_API_SCOPES_KEY } from './public-api-scope.decorator';
import { PublicApiScope } from '@postsider/nestjs-libraries/services/public-api-scopes';

@Injectable()
export class PublicApiScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PublicApiScope[]>(
      PUBLIC_API_SCOPES_KEY,
      [context.getHandler(), context.getClass()]
    );
    const request = context.switchToHttp().getRequest();
    const granted: string[] = request.publicApiScopes ?? [];

    if (granted.includes('*')) return true;
    if (
      !required?.length ||
      !required.every((scope) => granted.includes(scope))
    ) {
      throw new ForbiddenException({
        msg: 'API key does not have the required scope',
        requiredScopes: required ?? [],
      });
    }
    return true;
  }
}
