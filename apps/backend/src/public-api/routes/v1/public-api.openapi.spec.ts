import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  PublicOrganizationController,
  PublicOrganizationResponseDto,
} from './public.organization.controller';
import { PublicWebhookSubscriptionsController } from './public-webhook-subscriptions.controller';
import { PublicWebhookSubscriptionsService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-subscriptions.service';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';

describe('Public API OpenAPI contract', () => {
  it('publishes stable identity and webhook subscription operations', async () => {
    const module = await Test.createTestingModule({
      controllers: [
        PublicOrganizationController,
        PublicWebhookSubscriptionsController,
      ],
      providers: [
        PublicApiScopeGuard,
        {
          provide: PublicWebhookSubscriptionsService,
          useValue: {},
        },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.init();

    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('PostSider Public API').build(),
      { extraModels: [PublicOrganizationResponseDto] }
    );

    expect(document.paths['/public/v1/organization']?.get).toBeDefined();
    expect(
      document.paths['/public/v1/webhook-subscriptions']?.post?.requestBody
    ).toBeDefined();
    expect(
      document.paths['/public/v1/webhook-subscriptions/{id}/rotate-secret']
        ?.post
    ).toBeDefined();
    expect(
      document.paths['/public/v1/webhook-subscriptions/events']?.get
    ).toBeDefined();

    const organizationGet = document.paths['/public/v1/organization']!.get!;
    expect(organizationGet.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Authorization', in: 'header' }),
      ])
    );
    expect(
      (organizationGet.responses['200'] as any).content['application/json']
        .schema.$ref
    ).toContain('PublicOrganizationResponseDto');

    expect(
      document.components?.schemas?.CreatePublicWebhookSubscriptionDto
    ).toMatchObject({
      required: expect.arrayContaining(['name', 'url', 'events']),
    });

    await app.close();
  });
});
