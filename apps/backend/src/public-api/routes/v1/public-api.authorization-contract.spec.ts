jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (value: string) => value },
}));

import {
  CONTROLLERS_METADATA,
  GUARDS_METADATA,
  METHOD_METADATA,
} from '@nestjs/common/constants';
import { PublicApiModule } from '../public.api.module';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PublicWorkspaceController } from './public.workspace.controller';
import { PublicOrganizationController } from './public.organization.controller';
import { PublicWebhookSubscriptionsController } from './public-webhook-subscriptions.controller';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';
import { PUBLIC_API_SCOPES_KEY } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { isPublicApiScope } from '@postsider/nestjs-libraries/services/public-api-scopes';

describe('complete Public API authorization contract', () => {
  const controllers = [
    PublicIntegrationsController,
    PublicWorkspaceController,
    PublicOrganizationController,
    PublicWebhookSubscriptionsController,
  ];

  it('registers and guards every Public API controller', () => {
    const registered = Reflect.getMetadata(CONTROLLERS_METADATA, PublicApiModule);
    expect(registered).toEqual(expect.arrayContaining(controllers));
    for (const controller of controllers) {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller);
      expect({ controller: controller.name, guards }).toEqual({
        controller: controller.name,
        guards: expect.arrayContaining([PublicApiScopeGuard]),
      });
    }
  });

  it('classifies all 52 currently exposed Public API operations with an allowed scope', () => {
    let routes = 0;
    for (const controller of controllers) {
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === 'constructor') continue;
        const handler = (controller.prototype as any)[name];
        if (!Reflect.hasMetadata(METHOD_METADATA, handler)) continue;
        routes++;
        const required = Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, handler);
        expect({ controller: controller.name, name, required }).toEqual({
          controller: controller.name,
          name,
          required: expect.arrayContaining([expect.any(String)]),
        });
        expect(required.every(isPublicApiScope)).toBe(true);
      }
    }
    expect(routes).toBe(52);
  });
});
