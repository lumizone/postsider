jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (value: string) => value },
}));

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PUBLIC_API_SCOPES_KEY } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { isPublicApiScope } from '@postsider/nestjs-libraries/services/public-api-scopes';

describe('PublicIntegrationsController scope contract', () => {
  const prototype = PublicIntegrationsController.prototype;
  const routeHandlers = Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => ({ name, handler: (prototype as any)[name] }))
    .filter(({ handler }) => Reflect.hasMetadata(METHOD_METADATA, handler));

  it('requires known scopes on every Public API route', () => {
    expect(routeHandlers.length).toBeGreaterThan(0);
    for (const { name, handler } of routeHandlers) {
      const scopes = Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, handler);
      expect({ handler: name, scopes }).toEqual({
        handler: name,
        scopes: expect.arrayContaining([expect.any(String)]),
      });
      expect(scopes.every(isPublicApiScope)).toBe(true);
    }
  });

  it.each([
    ['createPost', ['posts:write']],
    ['getPosts', ['posts:read']],
    ['uploadsFromUrl', ['media:write']],
    ['requestApproval', ['approvals:write']],
    ['pausePublishing', ['publishing:write']],
  ])('maps %s to %j', (method, expectedScopes) => {
    expect(
      Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, (prototype as any)[method])
    ).toEqual(expectedScopes);
    expect(
      Reflect.getMetadata(PATH_METADATA, (prototype as any)[method])
    ).toBeDefined();
  });
});
