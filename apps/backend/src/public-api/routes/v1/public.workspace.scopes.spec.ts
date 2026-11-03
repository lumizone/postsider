jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (value: string) => value },
}));

import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { PublicWorkspaceController } from './public.workspace.controller';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';
import { PUBLIC_API_SCOPES_KEY } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { isPublicApiScope } from '@postsider/nestjs-libraries/services/public-api-scopes';

describe('PublicWorkspaceController route permissions', () => {
  const handlers = Object.getOwnPropertyNames(PublicWorkspaceController.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => ({
      name,
      handler: (PublicWorkspaceController.prototype as any)[name],
    }))
    .filter(({ handler }) => Reflect.hasMetadata(METHOD_METADATA, handler));

  it('enforces the scope guard on every workspace route', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PublicWorkspaceController);
    expect(guards).toContain(PublicApiScopeGuard);
    expect(handlers.length).toBe(14);
    for (const { name, handler } of handlers) {
      const scopes = Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, handler);
      expect({ name, scopes }).toEqual({
        name,
        scopes: expect.arrayContaining([expect.any(String)]),
      });
      expect(scopes.every(isPublicApiScope)).toBe(true);
    }
  });

  it('needs channels:write to change channel settings and posts:write to change content', () => {
    const scopeOf = (name: string) =>
      Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, (PublicWorkspaceController.prototype as any)[name]);
    expect(scopeOf('disableChannel')).toEqual(['channels:write']);
    expect(scopeOf('setQueuePlan')).toEqual(['channels:write']);
    expect(scopeOf('duplicatePost')).toEqual(['posts:write']);
    expect(scopeOf('deleteMedia')).toEqual(['media:write']);
  });
});
