jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  PublicOrganizationController,
  PublicOrganizationResponseDto,
} from './public.organization.controller';
import { PublicWebhookSubscriptionsController } from './public-webhook-subscriptions.controller';
import { PublicWebhookSubscriptionsService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-subscriptions.service';
import { PublicWebhookDeliveriesService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-deliveries.service';
import { PublicAuditController } from './public.audit.controller';
import { PublicPoliciesController } from './public.policies.controller';
import { PublicIntegrationsController } from './public.integrations.controller';
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
        { provide: PublicWebhookDeliveriesService, useValue: {} },
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

  it('documents the audit read routes', async () => {
    const tokens = new Map<any, any>();
    const module = await Test.createTestingModule({
      controllers: [PublicAuditController, PublicIntegrationsController],
      providers: [PublicApiScopeGuard],
    })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    const app = module.createNestApplication();
    await app.init();
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('PostSider Public API').build());
    expect(document.paths['/public/v1/audit-events']?.get).toBeDefined();
    expect(document.paths['/public/v1/posts/{id}/activity']?.get).toBeDefined();
    expect(document.components?.schemas?.PublicAuditEventDto).toBeDefined();
    const names = ((document.paths['/public/v1/posts/{id}/activity']!.get!.parameters ?? []) as any[]).map((p) => p.name);
    expect(names).not.toContain('targetType');
    expect(names).not.toContain('targetId');
    expect(names).toContain('limit');
    await app.close();
  });

  it('documents the policy management routes', async () => {
    const module = await Test.createTestingModule({
      controllers: [PublicPoliciesController],
      providers: [PublicApiScopeGuard],
    })
      .useMocker(() => ({}))
      .compile();
    const app = module.createNestApplication();
    await app.init();
    const document: any = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('PostSider Public API').build());
    const paths = document.paths;
    expect(paths['/public/v1/policies']?.get).toBeDefined();
    expect(paths['/public/v1/policies']?.post).toBeDefined();
    expect(paths['/public/v1/policies/{id}']?.get).toBeDefined();
    expect(paths['/public/v1/policies/{id}']?.put).toBeDefined();
    expect(paths['/public/v1/policies/{id}']?.delete).toBeDefined();
    for (const op of [paths['/public/v1/policies'].get, paths['/public/v1/policies/{id}'].get]) {
      expect(op.description).toContain('policies:read');
    }
    for (const op of [paths['/public/v1/policies'].post, paths['/public/v1/policies/{id}'].put, paths['/public/v1/policies/{id}'].delete]) {
      expect(op.description).toContain('policies:write');
    }
    expect(paths['/public/v1/policies'].post.responses['201']).toBeDefined();
    expect(JSON.stringify(paths['/public/v1/policies'].post.responses['400'])).toContain('policy_limit_reached');
    expect(document.components.schemas.PublicPolicyRuleDto).toBeDefined();
    expect(Object.keys(document.components.schemas.PublicPolicyRuleDto.properties)).not.toEqual(
      expect.arrayContaining(['organizationId'])
    );
    expect(Object.keys(document.components.schemas.PublicPolicyRuleDto.properties)).not.toContain('deletedAt');
    await app.close();
  });
});
