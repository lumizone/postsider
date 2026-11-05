jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicIntegrationsController } from './public.integrations.controller';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { PUBLIC_API_SCOPES } from '@postsider/nestjs-libraries/services/public-api-scopes';

describe('public approval endpoints', () => {
  let app: INestApplication;
  let base: string;
  const approvals = {
    requestApprovalFromApi: jest.fn(),
    getForPost: jest.fn(),
  };
  const row = {
    id: 'a1',
    postId: 'p1',
    status: 'PENDING',
    note: null,
    requestedAt: new Date('2026-11-01T00:00:00Z'),
    resolvedAt: null,
    guestToken: 'stored-secret-token',
    guestTokenExpiresAt: new Date('2026-11-08T00:00:00Z'),
    requestedById: 'u-super',
    requestedByType: 'API_KEY',
    requestedByApiKeyId: 'k1',
    decidedByType: null,
    guestName: null,
    guestEmail: null,
    approverId: null,
  };

  beforeAll(async () => {
    const tokens = new Map<any, any>([[ApprovalService, approvals]]);
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicIntegrationsController],
    })
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
  beforeEach(() => jest.resetAllMocks());

  it('201 on first request with an explicit projection and no token', async () => {
    approvals.requestApprovalFromApi.mockResolvedValue({ ...row, created: true });
    const res = await fetch(`${base}/posts/p1/request-approval`, { method: 'POST' });
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain('stored-secret-token');
    expect(text).not.toContain('u-super');
    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(
      ['created', 'id', 'note', 'postId', 'requestedAt', 'requestedBy', 'resolvedAt', 'status'].sort()
    );
    expect(body.created).toBe(true);
    expect(body.requestedBy).toEqual({ type: 'API_KEY', apiKeyId: 'k1' });
  });

  it('200 on a retried request and still hides the stored token', async () => {
    approvals.requestApprovalFromApi.mockResolvedValue({ ...row, created: false });
    const res = await fetch(`${base}/posts/p1/request-approval`, { method: 'POST' });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('stored-secret-token');
    expect(text).not.toContain('guestToken');
    expect(JSON.parse(text).created).toBe(false);
  });

  it('GET approval keeps the old keys and adds requestedBy and decidedBy', async () => {
    approvals.getForPost.mockResolvedValue({
      ...row,
      status: 'APPROVED',
      decidedByType: 'USER',
      approverId: 'u9',
    });
    const body = await (await fetch(`${base}/posts/p1/approval`)).json();
    expect(body).toMatchObject({
      status: 'APPROVED',
      note: null,
      requestedBy: { type: 'API_KEY', apiKeyId: 'k1' },
      decidedBy: { type: 'USER', userId: 'u9' },
    });
    expect(body).toHaveProperty('requestedAt');
    expect(body).toHaveProperty('resolvedAt');
    expect(body).toMatchObject({ stage: null, stages: [] });
    expect(JSON.stringify(body)).not.toContain('stored-secret-token');
  });

  it('GET approval reports stage progress while the status is still PENDING', async () => {
    approvals.getForPost.mockResolvedValue({
      ...row,
      status: 'PENDING',
      stage: { position: 2, total: 2, name: 'Legal' },
      stages: [
        { position: 1, name: 'Editor', status: 'APPROVED', decidedBy: { type: 'USER', userId: 'u1' }, decidedAt: null },
        { position: 2, name: 'Legal', status: 'PENDING', decidedBy: null, decidedAt: null },
      ],
    });
    const body = await (await fetch(`${base}/posts/p1/approval`)).json();
    expect(body.status).toBe('PENDING');
    expect(body.stage).toEqual({ position: 2, total: 2, name: 'Legal' });
    expect(body.stages).toHaveLength(2);
  });

  it('GET approval returns NONE when there is no approval', async () => {
    approvals.getForPost.mockResolvedValue(null);
    expect(await (await fetch(`${base}/posts/p1/approval`)).json()).toEqual({ status: 'NONE' });
  });
});
