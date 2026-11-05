jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PublicPostIdentityFieldsDto } from '@postsider/nestjs-libraries/dtos/posts/public-post-identity.dto';

describe('public identity OpenAPI', () => {
  it('documents the 13 identity columns', async () => {
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
      { extraModels: [PublicPostIdentityFieldsDto] }
    );
    expect(
      Object.keys(document.components.schemas.PublicPostIdentityFieldsDto.properties).sort()
    ).toEqual(
      [
        'createdByType', 'createdByUserId', 'createdByApiKeyId', 'createdByOAuthClientId',
        'lastModifiedByType', 'lastModifiedByUserId', 'lastModifiedByApiKeyId', 'lastModifiedByOAuthClientId',
        'agentName', 'workflowId', 'runId', 'externalRef', 'source',
      ].sort()
    );
    expect(document.paths['/public/v1/posts/{id}'].get.description).toContain('agentName');
    await app.close();
  });
});
