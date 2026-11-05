jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import 'reflect-metadata';
import {
  ConflictException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicApprovalsController } from './public.approvals.controller';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import { PublicApiIdempotencyService } from '@postsider/nestjs-libraries/database/prisma/idempotency/public-api-idempotency.service';
import { PUBLIC_API_SCOPES_KEY } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { isPublicApiScope } from '@postsider/nestjs-libraries/services/public-api-scopes';
import type { PostActor } from '@postsider/nestjs-libraries/actor/post-actor';

describe('PublicApprovalsController', () => {
  let app: INestApplication;
  let base: string;
  let scopes: string[] = [];
  let actor: PostActor = { type: 'API_KEY', apiKeyId: 'key-1' };
  const approvals = { listForApi: jest.fn(), getDetailForApi: jest.fn(), decide: jest.fn() };
  const idem = { claim: jest.fn(), complete: jest.fn(), release: jest.fn() };

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [ApprovalService, approvals],
      [PublicApiIdempotencyService, idem],
    ]);
    const moduleRef = await Test.createTestingModule({ controllers: [PublicApprovalsController] })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', users: [{ role: 'SUPERADMIN' }] };
      req.publicApiScopes = scopes;
      runWithActor(actor, () => next());
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    scopes = ['approvals:read', 'approvals:decide'];
    actor = { type: 'API_KEY', apiKeyId: 'key-1' };
    idem.claim.mockResolvedValue(null);
  });

  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const item = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    postId: 'p1',
    status: 'PENDING',
    note: null,
    requestedAt: '2026-11-01T00:00:00.000Z',
    resolvedAt: null,
    requestedBy: { type: 'API_KEY', apiKeyId: 'k9' },
    decidedBy: null,
    stage: { position: 1, total: 2, name: 'Legal' },
    stages: [],
    flow: null,
    channel: { id: 'c1', name: 'Page', providerIdentifier: 'x' },
    ...over,
  });
  const decision = (over: Record<string, unknown> = {}) => ({
    approvalId: 'a1',
    postId: 'p1',
    status: 'APPROVED',
    changed: true,
    stage: { position: 1, total: 1 },
    final: true,
    ...over,
  });

  it('route metadata: approvals:read for list and get, exactly approvals:decide for approve and reject', () => {
    const proto: any = PublicApprovalsController.prototype;
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.list)).toEqual(['approvals:read']);
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.get)).toEqual(['approvals:read']);
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.approve)).toEqual(['approvals:decide']);
    expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, proto.reject)).toEqual(['approvals:decide']);
    for (const fn of [proto.list, proto.get, proto.approve, proto.reject]) {
      expect(Reflect.getMetadata(PUBLIC_API_SCOPES_KEY, fn).every(isPublicApiScope)).toBe(true);
    }
  });

  it.each([
    ['POST', '/approvals/a1/approve'],
    ['POST', '/approvals/a1/reject'],
  ])('%s %s is refused 403 for a key with approvals:write only', async (method, path) => {
    scopes = ['approvals:write', 'approvals:read', 'posts:write'];
    const res = await send(method, path, {});
    expect(res.status).toBe(403);
    expect(approvals.decide).not.toHaveBeenCalled();
  });

  it.each([['/approvals'], ['/approvals/a1']])('GET %s needs approvals:read', async (path) => {
    scopes = ['approvals:write', 'approvals:decide'];
    expect((await send('GET', path)).status).toBe(403);
    expect(approvals.listForApi).not.toHaveBeenCalled();
    expect(approvals.getDetailForApi).not.toHaveBeenCalled();
  });

  describe('GET /approvals', () => {
    it('wraps the page as { approvals, nextCursor } and forwards the filters', async () => {
      approvals.listForApi.mockResolvedValue({ items: [item()], nextCursor: 'c2' });
      const res = await send(
        'GET',
        '/approvals?status=PENDING&limit=10&cursor=c1&since=2026-11-01T00:00:00Z'
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ approvals: [item()], nextCursor: 'c2' });
      expect(approvals.listForApi).toHaveBeenCalledWith('org-1', {
        status: 'PENDING',
        limit: 10,
        cursor: 'c1',
        since: '2026-11-01T00:00:00Z',
      });
    });

    it('an empty page is { approvals: [], nextCursor: null }', async () => {
      approvals.listForApi.mockResolvedValue({ items: [], nextCursor: null });
      const body = await (await send('GET', '/approvals')).json();
      expect(body).toEqual({ approvals: [], nextCursor: null });
    });

    it.each([['limit=101'], ['limit=0'], ['status=DONE'], ['status=pending'], ['since=nope']])(
      'rejects %s with 400',
      async (qs) => {
        expect((await send('GET', `/approvals?${qs}`)).status).toBe(400);
        expect(approvals.listForApi).not.toHaveBeenCalled();
      }
    );

    it('cursor round trip: the nextCursor of page 1 is passed back untouched for page 2', async () => {
      approvals.listForApi
        .mockResolvedValueOnce({ items: [item({ id: 'a2' })], nextCursor: 'CUR1' })
        .mockResolvedValueOnce({ items: [item({ id: 'a1' })], nextCursor: null });
      const first = await (await send('GET', '/approvals?limit=1')).json();
      const second = await (await send('GET', `/approvals?limit=1&cursor=${first.nextCursor}`)).json();
      expect(approvals.listForApi.mock.calls[1][1]).toMatchObject({ cursor: 'CUR1' });
      expect(second.nextCursor).toBeNull();
    });

    it('an invalid cursor surfaces as the service 400', async () => {
      const { BadRequestException } = jest.requireActual('@nestjs/common');
      approvals.listForApi.mockRejectedValue(new BadRequestException({ error: 'invalid_cursor' }));
      expect((await send('GET', '/approvals?cursor=garbage')).status).toBe(400);
    });

    it('response items carry no guest token material, requester id or organization id', async () => {
      approvals.listForApi.mockResolvedValue({ items: [item()], nextCursor: null });
      const text = await (await send('GET', '/approvals')).text();
      expect(text).not.toMatch(/guestToken|requestedById|organizationId/);
    });
  });

  describe('GET /approvals/:id', () => {
    it('returns the item with its preview', async () => {
      approvals.getDetailForApi.mockResolvedValue({ ...item(), preview: 'Hello' });
      const res = await send('GET', '/approvals/a1');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ id: 'a1', preview: 'Hello' });
      expect(approvals.getDetailForApi).toHaveBeenCalledWith('org-1', 'a1');
    });

    it('a foreign or unknown id is 404', async () => {
      approvals.getDetailForApi.mockRejectedValue(new NotFoundException('Approval not found'));
      expect((await send('GET', '/approvals/other-org-approval')).status).toBe(404);
    });
  });

  describe('POST /approvals/:id/approve and /reject', () => {
    it('approve calls the engine with the verified key actor, via API, and answers 200 with the result', async () => {
      approvals.decide.mockResolvedValue(decision());
      const res = await send('POST', '/approvals/a1/approve', { note: 'looks good' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(decision());
      expect(approvals.decide).toHaveBeenCalledWith(
        'org-1',
        'a1',
        { actor: { type: 'API_KEY', apiKeyId: 'key-1' }, via: 'API' },
        'approve',
        { note: 'looks good' }
      );
    });

    it('reject works the same with decision reject; an empty body means no note', async () => {
      approvals.decide.mockResolvedValue(decision({ status: 'REJECTED' }));
      const res = await send('POST', '/approvals/a1/reject');
      expect(res.status).toBe(200);
      expect(approvals.decide.mock.calls[0].slice(3)).toEqual(['reject', { note: null }]);
    });

    it('the decider comes from the credential, never from the body', async () => {
      approvals.decide.mockResolvedValue(decision());
      await send('POST', '/approvals/a1/approve', {
        note: 'x',
        actor: { type: 'USER', userId: 'boss' },
        via: 'DASHBOARD',
      });
      expect(approvals.decide.mock.calls[0][2]).toEqual({
        actor: { type: 'API_KEY', apiKeyId: 'key-1' },
        via: 'API',
      });
    });

    it('a note over 500 characters is 400', async () => {
      const res = await send('POST', '/approvals/a1/approve', { note: 'x'.repeat(501) });
      expect(res.status).toBe(400);
      expect(approvals.decide).not.toHaveBeenCalled();
    });

    it('a USER actor is refused 403 and nothing is decided', async () => {
      actor = { type: 'USER', userId: 'u1' };
      const res = await send('POST', '/approvals/a1/approve', {});
      expect(res.status).toBe(403);
      expect(approvals.decide).not.toHaveBeenCalled();
    });

    it('the SYSTEM actor (no credential context) is refused 403', async () => {
      actor = { type: 'SYSTEM' };
      expect((await send('POST', '/approvals/a1/reject', {})).status).toBe(403);
      expect(approvals.decide).not.toHaveBeenCalled();
    });

    it('engine refusals pass through: self_approval_blocked is 403', async () => {
      const { ForbiddenException } = jest.requireActual('@nestjs/common');
      approvals.decide.mockRejectedValue(new ForbiddenException({ error: 'self_approval_blocked' }));
      const res = await send('POST', '/approvals/a1/approve', {});
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).toContain('self_approval_blocked');
    });

    it('approval_already_resolved is 409 and releases the claim', async () => {
      idem.claim.mockResolvedValue({ kind: 'new', id: 'claim-1' });
      approvals.decide.mockRejectedValue(
        new ConflictException({ error: 'approval_already_resolved', status: 'REJECTED' })
      );
      const res = await send('POST', '/approvals/a1/approve', {}, { 'idempotency-key': 'k-1' });
      expect(res.status).toBe(409);
      expect(JSON.stringify(await res.json())).toContain('approval_already_resolved');
      expect(idem.release).toHaveBeenCalledWith('claim-1');
      expect(idem.complete).not.toHaveBeenCalled();
    });

    it('the same decision twice (engine says changed false) is 200', async () => {
      approvals.decide.mockResolvedValue(decision({ changed: false }));
      const res = await send('POST', '/approvals/a1/approve', {});
      expect(res.status).toBe(200);
      expect((await res.json()).changed).toBe(false);
    });

    it('a foreign approval id is 404 and releases the claim', async () => {
      idem.claim.mockResolvedValue({ kind: 'new', id: 'claim-2' });
      approvals.decide.mockRejectedValue(new NotFoundException('Approval not found'));
      const res = await send('POST', '/approvals/foreign/approve', {}, { 'idempotency-key': 'k-2' });
      expect(res.status).toBe(404);
      expect(idem.release).toHaveBeenCalledWith('claim-2');
    });

    describe('Idempotency-Key', () => {
      it('claims with { approvalId, decision, note } and completes with the stored result', async () => {
        idem.claim.mockResolvedValue({ kind: 'new', id: 'claim-3' });
        approvals.decide.mockResolvedValue(decision());
        await send('POST', '/approvals/a1/approve', { note: 'n' }, { 'idempotency-key': 'abc' });
        expect(idem.claim).toHaveBeenCalledWith('org-1', 'abc', {
          approvalId: 'a1',
          decision: 'approve',
          note: 'n',
        });
        expect(idem.complete).toHaveBeenCalledWith('claim-3', decision());
      });

      it('a replay returns the stored response without calling decide again', async () => {
        idem.claim.mockResolvedValue({ kind: 'replay', response: decision({ changed: true }) });
        const res = await send('POST', '/approvals/a1/approve', {}, { 'idempotency-key': 'abc' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(decision({ changed: true }));
        expect(approvals.decide).not.toHaveBeenCalled();
      });

      it('the same key with a different body is 409 (service conflict) and nothing is decided', async () => {
        idem.claim.mockRejectedValue(
          new ConflictException('Idempotency-Key was already used with a different request')
        );
        const res = await send('POST', '/approvals/a1/reject', {}, { 'idempotency-key': 'abc' });
        expect(res.status).toBe(409);
        expect(approvals.decide).not.toHaveBeenCalled();
      });

      it('without a key nothing is claimed', async () => {
        approvals.decide.mockResolvedValue(decision());
        await send('POST', '/approvals/a1/approve', {});
        expect(idem.claim).toHaveBeenCalledWith('org-1', undefined, expect.any(Object));
        expect(idem.complete).not.toHaveBeenCalled();
      });
    });
  });
});
