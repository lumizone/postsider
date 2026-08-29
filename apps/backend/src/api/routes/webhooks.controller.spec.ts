import { Reflector } from '@nestjs/core';
import { WebhookController } from './webhooks.controller';
import { CHECK_POLICIES_KEY } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@postsider/backend/services/auth/permissions/permission.exception.class';

describe('WebhookController plan authorization', () => {
  it('requires both administrator access and the webhook quota to create a webhook', () => {
    const policies = Reflect.getMetadata(
      CHECK_POLICIES_KEY,
      WebhookController.prototype.createAWebhook,
    );

    expect(policies).toEqual([
      [AuthorizationActions.Create, Sections.ADMIN],
      [AuthorizationActions.Create, Sections.WEBHOOKS],
    ]);
  });
});
