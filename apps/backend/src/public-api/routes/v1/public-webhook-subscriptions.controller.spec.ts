import { METHOD_METADATA } from '@nestjs/common/constants';
import { PUBLIC_API_SCOPES_KEY } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { isPublicApiScope } from '@postsider/nestjs-libraries/services/public-api-scopes';
import { PublicWebhookSubscriptionsController } from './public-webhook-subscriptions.controller';

describe('PublicWebhookSubscriptionsController contract', () => {
  const prototype = PublicWebhookSubscriptionsController.prototype;

  it('requires a known webhook scope on every route', () => {
    const routeHandlers = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => (prototype as any)[name])
      .filter((handler) => Reflect.hasMetadata(METHOD_METADATA, handler));

    expect(routeHandlers.length).toBe(7);
    for (const handler of routeHandlers) {
      const scopes = Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, handler);
      expect(scopes).toEqual(expect.arrayContaining([expect.any(String)]));
      expect(scopes.every(isPublicApiScope)).toBe(true);
    }
  });

  it('returns samples for all supported events without exposing a real secret', () => {
    const controller = new PublicWebhookSubscriptionsController({} as any);
    const result = controller.events({ id: 'org-1' } as any);

    expect(result.map(({ event }) => event)).toEqual([
      'post.published',
      'post.failed',
      'approval.requested',
      'approval.resolved',
    ]);
    expect(JSON.stringify(result)).not.toContain('pwhsec_');
    expect(result[0].sample.organizationId).toBe('org-1');
  });
});
