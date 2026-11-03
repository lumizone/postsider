import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PublicApiScopeGuard } from './public-api-scope.guard';
import { PUBLIC_API_SCOPES_KEY } from './public-api-scope.decorator';
import {
  PUBLIC_API_SCOPES,
  isPublicApiScope,
} from '@postsider/nestjs-libraries/services/public-api-scopes';

describe('PublicApiScopeGuard', () => {
  const context = (scopes: string[]) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ publicApiScopes: scopes }) }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as any);

  it('allows a credential with every scope required by the route', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['posts:read']),
    } as unknown as Reflector;
    const guard = new PublicApiScopeGuard(reflector);

    expect(guard.canActivate(context(['posts:read', 'channels:read']))).toBe(
      true
    );
  });

  it('keeps legacy and OAuth credentials backward compatible through wildcard access', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['posts:write']),
    } as unknown as Reflector;
    const guard = new PublicApiScopeGuard(reflector);

    expect(guard.canActivate(context(['*']))).toBe(true);
  });

  it('denies a scoped credential when the route scope is missing', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['posts:write']),
    } as unknown as Reflector;
    const guard = new PublicApiScopeGuard(reflector);

    expect(() => guard.canActivate(context(['posts:read']))).toThrow(
      ForbiddenException
    );
  });

  it('fails closed for scoped credentials on an unclassified public route', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new PublicApiScopeGuard(reflector);

    expect(() => guard.canActivate(context(['posts:read']))).toThrow(
      ForbiddenException
    );
  });

  it('exposes the metadata key used by the scope decorator', () => {
    expect(PUBLIC_API_SCOPES_KEY).toBe('public-api-scopes');
  });

  it('keeps the supported scope catalog closed and machine-validatable', () => {
    expect(PUBLIC_API_SCOPES).toContain('posts:write');
    expect(isPublicApiScope('webhooks:read')).toBe(true);
    expect(isPublicApiScope('admin:everything')).toBe(false);
  });
});
