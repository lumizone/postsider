jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (value: string) => value },
}));

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PublicWorkspaceController } from './public.workspace.controller';
import { PublicAuditController } from './public.audit.controller';
import { PublicPoliciesController } from './public.policies.controller';
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
    ['getPostActivity', ['posts:read']],
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


describe('PublicWorkspaceController scope contract', () => {
  const prototype = PublicWorkspaceController.prototype;
  const handlers = Object.getOwnPropertyNames(prototype)
    .map((name) => ({ name, handler: (prototype as any)[name] }))
    .filter(({ handler }) => Reflect.hasMetadata(METHOD_METADATA, handler));

  it('denies newly added workspace APIs to unscoped credentials', () => {
    expect(handlers).toHaveLength(14);
    for (const { name, handler } of handlers) {
      const scopes = Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, handler);
      expect(scopes?.length).toBeGreaterThan(0);
      expect(scopes.every(isPublicApiScope)).toBe(true);
    }
  });

  it.each([
    ['disableChannel', ['channels:write']],
    ['deleteMedia', ['media:write']],
  ])('authorizes %s only with %j', (name, expected) => {
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, (prototype as any)[name])).toEqual(expected);
  });
});

describe('PublicAuditController scope contract', () => {
  const prototype = PublicAuditController.prototype;
  const handlers = Object.getOwnPropertyNames(prototype)
    .map((name) => ({ name, handler: (prototype as any)[name] }))
    .filter(({ handler }) => Reflect.hasMetadata(METHOD_METADATA, handler));

  it('has exactly one handler, guarded by audit:read', () => {
    expect(handlers).toHaveLength(1);
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, handlers[0].handler)).toEqual(['audit:read']);
  });
});

describe('PublicPoliciesController scope contract', () => {
  const prototype = PublicPoliciesController.prototype;
  const handlers = Object.getOwnPropertyNames(prototype)
    .map((name) => ({ name, handler: (prototype as any)[name] }))
    .filter(({ handler }) => Reflect.hasMetadata(METHOD_METADATA, handler));

  it('has six handlers, each with known scopes', () => {
    expect(handlers).toHaveLength(6);
    for (const { handler } of handlers) {
      const scopes = Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, handler);
      expect(scopes?.length).toBeGreaterThan(0);
      expect(scopes.every(isPublicApiScope)).toBe(true);
    }
  });

  it.each([
    ['list', ['policies:read']],
    ['get', ['policies:read']],
    ['create', ['policies:write']],
    ['update', ['policies:write']],
    ['remove', ['policies:write']],
    ['evaluate', ['posts:read']],
  ])('authorizes %s only with %j', (name, expected) => {
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, (prototype as any)[name])).toEqual(expected);
  });
});
