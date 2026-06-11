import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';

export const loadSwagger = (app: INestApplication) => {
  const config = new DocumentBuilder()
    .setTitle('PostSider API')
    .setDescription(
      'PostSider REST API. The Agent Bridge surface is served under /public/v1 and authenticated with an agent token (agt_), OAuth token (pos_) or organization API key.'
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'token' },
      'agent-token'
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // Expose the raw OpenAPI document so agents/SDKs can consume the contract
  // programmatically (Requirement 12.2). Served under the public API prefix.
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get(
    '/public/v1/openapi.json',
    (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(document);
    }
  );
};
