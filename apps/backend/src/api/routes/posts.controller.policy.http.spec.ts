jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PostsController } from './posts.controller';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { PostPolicyGateService } from '@postsider/nestjs-libraries/database/prisma/policies/post-policy-gate.service';
import { PolicyBlockedException, policyInputTooLarge } from '@postsider/nestjs-libraries/policies/policy-errors';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';

const blockedOutcome = {
  effect: 'BLOCK' as const,
  matched: [{ ruleId: 'r1', name: 'No links', effect: 'BLOCK' as const, condition: 'CONTAINS_LINK' as const }],
  channels: [{ integrationId: 'i1', effect: 'BLOCK' as const }],
};

describe('PostsController dashboard policy path', () => {
  let app: INestApplication;
  let base: string;
  const posts = {
    validatePosts: jest.fn(),
    mapTypeToPost: jest.fn(),
    createPost: jest.fn(),
    changeDate: jest.fn(),
  };
  const gate = { preflightWrite: jest.fn(), finishCreate: jest.fn(), gateReschedule: jest.fn() };

  const post = (extra: Record<string, unknown> = {}) => ({
    integration: { id: 'i1' },
    value: [{ content: 'hello' }],
    ...extra,
  });
  const send = (body: Record<string, unknown>) =>
    fetch(`${base}/posts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shortLink: false, date: '2030-01-01T10:00:00Z', posts: [post()], ...body }),
    });

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [PostsService, posts],
      [PostPolicyGateService, gate],
    ]);
    const moduleRef = await Test.createTestingModule({ controllers: [PostsController] })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', users: [{ role: 'ADMIN' }] };
      req.user = { id: 'u1' };
      next();
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    posts.validatePosts.mockResolvedValue([
      { identifier: 'x', name: 'X', emptyContent: false, valid: true, errors: true, tooLong: false },
    ]);
    posts.mapTypeToPost.mockImplementation(async (raw: any) => raw);
    posts.createPost.mockResolvedValue([{ postId: 'p1', integration: 'i1' }]);
    gate.preflightWrite.mockResolvedValue({
      outcome: { effect: 'ALLOW', matched: [], channels: [] },
      approvalIntegrationIds: new Set<string>(),
    });
    gate.finishCreate.mockImplementation(async (_o: string, created: any[]) =>
      created.map((c) => ({ ...c, approvalRequested: false }))
    );
  });

  describe('POST /posts', () => {
    it('evaluates an update as a schedule with the USER actor', async () => {
      const res = await send({ type: 'update' });
      expect(res.status).toBe(201);
      const [orgId, gateBody, actor, opts] = gate.preflightWrite.mock.calls[0];
      expect(orgId).toBe('org-1');
      expect(gateBody.type).toBe('schedule');
      expect(actor).toEqual({ type: 'USER', userId: 'u1' });
      expect(opts).toEqual({});
      // The stored request keeps its real type so the write still updates in place.
      expect(posts.createPost.mock.calls[0][1].type).toBe('update');
    });

    it('maps now to now and keeps draft as a draft report', async () => {
      await send({ type: 'now' });
      expect(gate.preflightWrite.mock.calls[0][1].type).toBe('now');
      await send({ type: 'draft' });
      expect(gate.preflightWrite.mock.calls[1][1].type).toBe('draft');
      expect(posts.createPost).toHaveBeenCalledTimes(2);
    });

    it('names the stored post of an edit by value id, else by group', async () => {
      await send({
        type: 'update',
        posts: [
          post({ value: [{ id: 'old1', content: 'a' }] }),
          { ...post({ group: 'g-old' }), integration: { id: 'i2' } },
          { ...post(), integration: { id: 'i3' } },
        ],
      });
      const opts = gate.preflightWrite.mock.calls[0][3];
      expect(opts.editing).toEqual([
        { postId: 'old1', group: undefined },
        { postId: undefined, group: 'g-old' },
        undefined,
      ]);
    });

    it('a BLOCK answers 422 with the rule names and writes nothing', async () => {
      gate.preflightWrite.mockRejectedValue(new PolicyBlockedException(blockedOutcome));
      const res = await send({ type: 'schedule' });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toBe('policy_blocked');
      expect(JSON.stringify(json)).toContain('No links');
      expect(posts.createPost).not.toHaveBeenCalled();
      expect(gate.finishCreate).not.toHaveBeenCalled();
    });

    it('too large to evaluate answers 400 policy_input_too_large and writes nothing', async () => {
      gate.preflightWrite.mockRejectedValue(policyInputTooLarge());
      const res = await send({ type: 'schedule' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('policy_input_too_large');
      expect(posts.createPost).not.toHaveBeenCalled();
    });

    it('REQUIRE_APPROVAL writes the channel as a draft and reports approvalRequested', async () => {
      const approvalIds = new Set(['i1']);
      gate.preflightWrite.mockResolvedValue({
        outcome: { effect: 'REQUIRE_APPROVAL', matched: [], channels: [] },
        approvalIntegrationIds: approvalIds,
      });
      gate.finishCreate.mockImplementation(async (_o: string, created: any[]) =>
        created.map((c) => ({ ...c, approvalRequested: true, policy: { effect: 'REQUIRE_APPROVAL', matched: [] } }))
      );
      const res = await send({ type: 'update', posts: [post({ value: [{ id: 'old1', content: 'a' }] })] });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json[0].approvalRequested).toBe(true);
      expect(posts.createPost.mock.calls[0][3]).toEqual({ forceDraftIntegrationIds: approvalIds });
      // Router terminateWorkflow stays false: the post is written as a draft, not re-armed.
      expect(gate.finishCreate.mock.calls[0][3]).toBeUndefined();
    });

    it('a draft that cannot be evaluated is saved and the response omits policy', async () => {
      gate.preflightWrite.mockResolvedValue({
        outcome: { effect: 'ALLOW', matched: [], channels: [] },
        approvalIntegrationIds: new Set<string>(),
        evaluated: false,
      });
      gate.finishCreate.mockImplementation(async (_o: string, created: any[]) =>
        created.map((c) => ({ ...c, approvalRequested: false }))
      );
      const res = await send({ type: 'draft' });
      expect(res.status).toBe(201);
      expect((await res.json())[0].policy).toBeUndefined();
      expect(posts.createPost).toHaveBeenCalledTimes(1);
    });

    it('validation errors answer before the gate runs', async () => {
      posts.validatePosts.mockResolvedValue([
        { identifier: 'x', name: 'X', emptyContent: true, valid: true, errors: true, tooLong: false },
      ]);
      const res = await send({ type: 'schedule' });
      expect(res.status).toBe(400);
      expect(gate.preflightWrite).not.toHaveBeenCalled();
      expect(posts.createPost).not.toHaveBeenCalled();
    });
  });

  describe('PUT /posts/:id/date', () => {
    const put = (body: Record<string, unknown>) =>
      fetch(`${base}/posts/p1/date`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    it('schedule + BLOCK answers 422 and does not change the date', async () => {
      gate.gateReschedule.mockRejectedValue(new PolicyBlockedException(blockedOutcome));
      const res = await put({ date: '2030-02-01T10:00:00Z', action: 'schedule' });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('policy_blocked');
      expect(posts.changeDate).not.toHaveBeenCalled();
    });

    it('schedule + too large answers 400 and does not change the date', async () => {
      gate.gateReschedule.mockRejectedValue(policyInputTooLarge());
      const res = await put({ date: '2030-02-01T10:00:00Z' });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('policy_input_too_large');
      expect(posts.changeDate).not.toHaveBeenCalled();
    });

    it('schedule + REQUIRE_APPROVAL answers 200 approvalRequested and does not change the date', async () => {
      gate.gateReschedule.mockResolvedValue({
        proceed: false,
        approvalRequested: true,
        policy: { effect: 'REQUIRE_APPROVAL', matched: [], channels: [] },
      });
      const res = await put({ date: '2030-02-01T10:00:00Z', action: 'schedule' });
      expect(res.status).toBe(200);
      expect((await res.json()).approvalRequested).toBe(true);
      expect(posts.changeDate).not.toHaveBeenCalled();
    });

    it('schedule + ALLOW changes the date once, evaluated for the new date and the USER', async () => {
      gate.gateReschedule.mockResolvedValue({
        proceed: true,
        approvalRequested: false,
        policy: { effect: 'ALLOW', matched: [], channels: [] },
      });
      posts.changeDate.mockResolvedValue({ ok: true });
      const res = await put({ date: '2030-02-01T10:00:00Z', action: 'schedule' });
      expect(res.status).toBe(200);
      expect(gate.gateReschedule).toHaveBeenCalledWith('org-1', 'p1', '2030-02-01T10:00:00Z', {
        type: 'USER',
        userId: 'u1',
      });
      expect(posts.changeDate).toHaveBeenCalledTimes(1);
      expect(posts.changeDate).toHaveBeenCalledWith('org-1', 'p1', '2030-02-01T10:00:00Z', 'schedule');
    });

    it('a missing action defaults to schedule and is gated', async () => {
      gate.gateReschedule.mockResolvedValue({
        proceed: true,
        approvalRequested: false,
        policy: { effect: 'ALLOW', matched: [], channels: [] },
      });
      await put({ date: '2030-02-01T10:00:00Z' });
      expect(gate.gateReschedule).toHaveBeenCalledTimes(1);
    });

    it('action update is never gated', async () => {
      posts.changeDate.mockResolvedValue({ ok: true });
      const res = await put({ date: '2030-02-01T10:00:00Z', action: 'update' });
      expect(res.status).toBe(200);
      expect(gate.gateReschedule).not.toHaveBeenCalled();
      expect(posts.changeDate).toHaveBeenCalledWith('org-1', 'p1', '2030-02-01T10:00:00Z', 'update');
    });
  });
});
