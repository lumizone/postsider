jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { PublicApiIdempotencyService } from '@postsider/nestjs-libraries/database/prisma/idempotency/public-api-idempotency.service';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { PUBLIC_API_SCOPES } from '@postsider/nestjs-libraries/services/public-api-scopes';

describe('post provenance over HTTP', () => {
  let app: INestApplication;
  let base: string;
  const postsService = {
    mapTypeToPost: jest.fn(),
    createPost: jest.fn(),
    buildPostUpdate: jest.fn(),
    validatePosts: jest.fn(),
  };
  const idempotency = { claim: jest.fn(), complete: jest.fn(), release: jest.fn() };
  const mapped = () => ({ type: 'draft', posts: [], tags: [] });

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [PostsService, postsService],
      [PublicApiIdempotencyService, idempotency],
    ]);
    const moduleRef = await Test.createTestingModule({ controllers: [PublicIntegrationsController] })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', defaultTimezone: null, users: [{ role: 'SUPERADMIN' }] };
      req.publicApiScopes = [...PUBLIC_API_SCOPES];
      next();
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    postsService.mapTypeToPost.mockImplementation(async () => mapped());
    postsService.createPost.mockResolvedValue([{ postId: 'p1' }]);
    postsService.validatePosts.mockResolvedValue([]);
    postsService.buildPostUpdate.mockResolvedValue({ dto: {}, state: 'DRAFT' });
    idempotency.claim.mockResolvedValue(null);
  });

  const send = (method: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('POST /posts merges body and header provenance into createPost', async () => {
    const res = await send(
      'POST',
      '/posts',
      { type: 'draft', provenance: { agentName: 'ads-agent', runId: 'r-1' } },
      { 'x-postsider-source': 'n8n' }
    );
    expect(res.status).toBe(201);
    expect(postsService.createPost).toHaveBeenCalledWith('org-1', expect.anything(), 'API', {
      provenance: { agentName: 'ads-agent', runId: 'r-1', source: 'n8n' },
    });
  });

  it('rejects a 256-char workflowId before the claim and the service', async () => {
    const res = await send(
      'POST',
      '/posts',
      { type: 'draft', provenance: { workflowId: 'w'.repeat(256) } },
      { 'Idempotency-Key': 'k1' }
    );
    expect(res.status).toBe(400);
    expect(postsService.createPost).not.toHaveBeenCalled();
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('keeps creationMethod WEB mapped to API', async () => {
    await send('POST', '/posts', { type: 'draft', creationMethod: 'WEB' });
    expect(postsService.createPost.mock.calls[0][2]).toBe('API');
  });

  it('PUT /posts/p1 passes the parsed provenance', async () => {
    const res = await send('PUT', '/posts/p1', { content: 'new', provenance: { source: 'zapier' } });
    expect(res.status).toBe(200);
    expect(postsService.createPost).toHaveBeenCalledWith('org-1', expect.anything(), 'API', {
      provenance: { source: 'zapier' },
    });
  });

  it('PUT with only provenance is still Nothing to update', async () => {
    const res = await send('PUT', '/posts/p1', { provenance: { source: 'zapier' } });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain('Nothing to update');
    expect(postsService.createPost).not.toHaveBeenCalled();
  });
});
