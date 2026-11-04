jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PublicPostFailureFieldsDto } from '@postsider/nestjs-libraries/dtos/posts/public-post-failure.dto';

describe('public reliability OpenAPI', () => {
  it('documents the failure taxonomy', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicIntegrationsController],
    })
      .useMocker(() => ({}))
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const document: any = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
      { extraModels: [PublicPostFailureFieldsDto] }
    );

    expect(
      document.components.schemas.PublicPostFailureFieldsDto.properties
        .errorCategory.enum
    ).toEqual([
      'AUTH_EXPIRED',
      'PERMISSION_MISSING',
      'RATE_LIMITED',
      'INVALID_CONTENT',
      'PROVIDER_UNAVAILABLE',
      'UNKNOWN_OUTCOME',
      'POLICY_BLOCKED',
      'UNKNOWN',
    ]);
    expect(document.paths['/public/v1/posts/{id}'].get.description).toContain(
      'errorCategory'
    );
    const retry = document.paths['/public/v1/posts/group/{group}/retry-failed'].post;
    expect(retry.description).toContain('approval_requested');
    expect(retry.description).toContain('422');
    await app.close();
  });
});
