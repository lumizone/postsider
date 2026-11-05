jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { ConflictException, INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { PostPolicyGateService } from '@postsider/nestjs-libraries/database/prisma/policies/post-policy-gate.service';
import { passthroughPolicyGate } from './passthrough-policy-gate.spec-helper';
import { PublicApiIdempotencyService } from '@postsider/nestjs-libraries/database/prisma/idempotency/public-api-idempotency.service';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { PUBLIC_API_SCOPES } from '@postsider/nestjs-libraries/services/public-api-scopes';

describe('POST /posts/group/:group/retry-failed', () => {
  let app: INestApplication;
  let base: string;
  let scopes: string[] = [];
  const postsService = { retryFailedByGroup: jest.fn() };
  const idempotency = { claim: jest.fn(), complete: jest.fn(), release: jest.fn() };
  const result = { group: 'g1', results: [{ postId: 'p1', action: 'requeued' }] };

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [PostsService, postsService],
      [PublicApiIdempotencyService, idempotency],
      [PostPolicyGateService, passthroughPolicyGate],
    ]);
    const moduleRef = await Test.createTestingModule({ controllers: [PublicIntegrationsController] })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', defaultTimezone: null, users: [{ role: 'SUPERADMIN' }] };
      req.publicApiScopes = scopes;
      next();
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    scopes = [...PUBLIC_API_SCOPES];
    postsService.retryFailedByGroup.mockResolvedValue(result);
    idempotency.claim.mockResolvedValue(null);
  });

  const post = (body: unknown = {}, headers: Record<string, string> = {}) =>
    fetch(`${base}/posts/group/g1/retry-failed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('returns the service result and defaults includeUnknownOutcome to false', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ...result, policy: { effect: 'ALLOW', matched: [] } });
    expect(postsService.retryFailedByGroup).toHaveBeenCalledWith('org-1', 'g1', {
      includeUnknownOutcome: false,
      routeToApproval: expect.any(Function),
      approvalPostIds: new Set(),
      evaluatedPostIds: new Set(),
    });
  });

  it('rejects a non-boolean includeUnknownOutcome', async () => {
    expect((await post({ includeUnknownOutcome: 'yes' })).status).toBe(400);
    expect(postsService.retryFailedByGroup).not.toHaveBeenCalled();
  });

  it('requires posts:write', async () => {
    scopes = ['posts:read'];
    expect((await post()).status).toBe(403);
    expect(postsService.retryFailedByGroup).not.toHaveBeenCalled();
  });

  it('claims idempotency with the route, group and flag', async () => {
    await post({}, { 'Idempotency-Key': 'k1' });
    expect(idempotency.claim).toHaveBeenCalledWith('org-1', 'k1', {
      route: 'retry-failed',
      group: 'g1',
      includeUnknownOutcome: false,
    });
  });

  it('completes a new claim with the result', async () => {
    idempotency.claim.mockResolvedValue({ kind: 'new', id: 'c1' });
    await post({}, { 'Idempotency-Key': 'k1' });
    expect(idempotency.complete).toHaveBeenCalledWith('c1', { ...result, policy: { effect: 'ALLOW', matched: [] } });
  });

  it('replays without calling the service', async () => {
    idempotency.claim.mockResolvedValue({ kind: 'replay', response: { replayed: true } });
    const res = await post({}, { 'Idempotency-Key': 'k1' });
    expect(await res.json()).toEqual({ replayed: true });
    expect(postsService.retryFailedByGroup).not.toHaveBeenCalled();
  });

  it('releases the claim when the service rejects', async () => {
    idempotency.claim.mockResolvedValue({ kind: 'new', id: 'c1' });
    postsService.retryFailedByGroup.mockRejectedValue(new ConflictException('conflict'));
    const res = await post({}, { 'Idempotency-Key': 'k1' });
    expect(res.status).toBe(409);
    expect(idempotency.release).toHaveBeenCalledWith('c1');
  });

  it('answers 404 for an unknown or foreign group', async () => {
    postsService.retryFailedByGroup.mockRejectedValue(new NotFoundException('Group not found'));
    expect((await post()).status).toBe(404);
  });
});
