import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PUBLIC_API_SCOPES_KEY } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';
import { PublicWebhookSubscriptionsService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-subscriptions.service';
import { PublicWebhookDeliveriesService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-deliveries.service';
import { PublicWebhookSubscriptionsController } from './public-webhook-subscriptions.controller';

describe('PublicWebhookSubscriptionsController deliveries routes', () => {
  const proto = PublicWebhookSubscriptionsController.prototype as any;
  const org = { id: 'org-1' } as any;
  const deliveries = {
    list: jest.fn().mockResolvedValue('L'),
    replay: jest.fn().mockResolvedValue('R'),
    sendTest: jest.fn().mockResolvedValue('T'),
  };
  const controller = new PublicWebhookSubscriptionsController({} as any, deliveries as any);

  it('delegates with the organization id', async () => {
    await expect(controller.deliveriesList(org, 's1', '10', 'c1')).resolves.toBe('L');
    expect(deliveries.list).toHaveBeenCalledWith('org-1', 's1', { limit: '10', cursor: 'c1' });
    await expect(controller.replayDelivery(org, 's1', 'd1')).resolves.toBe('R');
    expect(deliveries.replay).toHaveBeenCalledWith('org-1', 's1', 'd1');
    await expect(controller.sendTest(org, 's1')).resolves.toBe('T');
    expect(deliveries.sendTest).toHaveBeenCalledWith('org-1', 's1');
  });

  it('requires the right scopes', () => {
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.deliveriesList)).toEqual(['webhooks:read']);
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.replayDelivery)).toEqual(['webhooks:write']);
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.sendTest)).toEqual(['webhooks:write']);
  });

  it('publishes the operations in OpenAPI', async () => {
    const module = await Test.createTestingModule({
      controllers: [PublicWebhookSubscriptionsController],
      providers: [
        PublicApiScopeGuard,
        { provide: PublicWebhookSubscriptionsService, useValue: {} },
        { provide: PublicWebhookDeliveriesService, useValue: {} },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const base = '/public/v1/webhook-subscriptions/{id}';
    expect(doc.paths[`${base}/deliveries`]?.get).toBeDefined();
    expect(doc.paths[`${base}/deliveries/{deliveryId}/replay`]?.post).toBeDefined();
    expect(doc.paths[`${base}/test`]?.post).toBeDefined();
    await app.close();
  });
});
