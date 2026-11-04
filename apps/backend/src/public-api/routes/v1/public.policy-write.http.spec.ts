jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { PublicApiIdempotencyService } from '@postsider/nestjs-libraries/database/prisma/idempotency/public-api-idempotency.service';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import { PostPolicyGateService } from '@postsider/nestjs-libraries/database/prisma/policies/post-policy-gate.service';
import { PolicyApprovalRouter } from '@postsider/nestjs-libraries/database/prisma/policies/policy-approval-router';
import { PolicyEvaluationService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-evaluation.service';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { PUBLIC_API_SCOPES } from '@postsider/nestjs-libraries/services/public-api-scopes';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';

const rule = (effect: 'BLOCK' | 'REQUIRE_APPROVAL', name = 'No links') => ({
  ruleId: 'r1',
  name,
  effect,
  condition: 'CONTAINS_LINK' as const,
});

const outcomeFor = (effect: 'ALLOW' | 'BLOCK' | 'REQUIRE_APPROVAL', ids: string[]) => ({
  effect,
  matched: effect === 'ALLOW' ? [] : [rule(effect)],
  channels: ids.map((integrationId) => ({
    integrationId,
    effect,
    matched: effect === 'ALLOW' ? [] : [rule(effect)],
  })),
});

describe('write-time policy gate over HTTP', () => {
  let app: INestApplication;
  let base: string;

  const postsService = {
    mapTypeToPost: jest.fn(),
    validatePosts: jest.fn(),
    createPost: jest.fn(),
    buildPostUpdate: jest.fn(),
    getPost: jest.fn(),
    changePostStatus: jest.fn(),
  };
  const approvals = { requestApprovalFromApi: jest.fn() };
  const idempotency = { claim: jest.fn(), complete: jest.fn(), release: jest.fn() };
  const evaluation = {
    targetsFromDraftBody: jest.fn(),
    targetFromStoredPost: jest.fn(),
    evaluateTargets: jest.fn(),
    recordOutcome: jest.fn(),
  };
  const router = { route: jest.fn() };

  beforeAll(async () => {
    const gate = new PostPolicyGateService(evaluation as any, router as any);
    const tokens = new Map<any, any>([
      [PostsService, postsService],
      [PublicApiIdempotencyService, idempotency],
      [ApprovalService, approvals],
      [PostPolicyGateService, gate],
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
      runWithActor({ type: 'API_KEY', id: 'k1', apiKeyId: 'k1' } as any, () => next());
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    idempotency.claim.mockResolvedValue(null);
    postsService.mapTypeToPost.mockImplementation(async (b: any) => b);
    postsService.validatePosts.mockResolvedValue([]);
    postsService.createPost.mockResolvedValue([
      { postId: 'pa', integration: 'chA' },
      { postId: 'pb', integration: 'chB' },
    ]);
    postsService.changePostStatus.mockResolvedValue({ id: 'p1', state: 'QUEUE' });
    evaluation.recordOutcome.mockResolvedValue(undefined);
    evaluation.targetsFromDraftBody.mockImplementation(async (_o: string, b: any) =>
      b.posts.map((p: any) => ({
        integrationId: p.integration.id,
        action: b.type === 'draft' ? 'DRAFT' : 'SCHEDULE',
        actors: [{ type: 'API_KEY', userId: null, apiKeyId: 'k1', oauthClientId: null }],
      }))
    );
    router.route.mockResolvedValue({ requested: true, approvalId: 'ap1' });
  });

  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const createBody = (type: string, channels = ['chA', 'chB']) => ({
    type,
    date: '2030-01-01T00:00:00.000Z',
    shortLink: false,
    tags: [],
    posts: channels.map((id) => ({ integration: { id }, value: [{ content: 'hi', image: [] }], settings: {} })),
  });

  describe('POST /posts', () => {
    it('BLOCK on schedule: 422 body, nothing written, claim released', async () => {
      idempotency.claim.mockResolvedValue({ kind: 'new', id: 'claim-1' });
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('BLOCK', ['chA', 'chB']));
      const res = await send('POST', '/posts', createBody('schedule'), { 'idempotency-key': 'k-1' });
      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toBe('policy_blocked');
      expect(json.msg).toBe('This post was blocked by a policy: No links.');
      expect(json.policy.effect).toBe('BLOCK');
      expect(json.policy.channels).toEqual(['chA', 'chB']);
      expect(postsService.createPost).not.toHaveBeenCalled();
      expect(idempotency.complete).not.toHaveBeenCalled();
      expect(idempotency.release).toHaveBeenCalledWith('claim-1');
    });

    it('does not claim and does not evaluate when a replay returns the stored response', async () => {
      const stored = [{ postId: 'pa', integration: 'chA', policy: { effect: 'ALLOW', matched: [] }, approvalRequested: false }];
      idempotency.claim.mockResolvedValue({ kind: 'replay', response: stored });
      const res = await send('POST', '/posts', createBody('schedule'), { 'idempotency-key': 'k-1' });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual(stored);
      expect(evaluation.evaluateTargets).not.toHaveBeenCalled();
      expect(postsService.createPost).not.toHaveBeenCalled();
    });

    it('stores the decorated response for later replay', async () => {
      idempotency.claim.mockResolvedValue({ kind: 'new', id: 'claim-1' });
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('ALLOW', ['chA', 'chB']));
      const res = await send('POST', '/posts', createBody('schedule'), { 'idempotency-key': 'k-1' });
      const json = await res.json();
      expect(idempotency.complete).toHaveBeenCalledWith('claim-1', json);
      expect(json[0].policy).toEqual({ effect: 'ALLOW', matched: [] });
    });

    it('REQUIRE_APPROVAL: forces the channel to draft and routes it', async () => {
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'REQUIRE_APPROVAL',
        matched: [rule('REQUIRE_APPROVAL')],
        channels: [
          { integrationId: 'chA', effect: 'ALLOW', matched: [] },
          { integrationId: 'chB', effect: 'REQUIRE_APPROVAL', matched: [rule('REQUIRE_APPROVAL')] },
        ],
      });
      const res = await send('POST', '/posts', createBody('schedule'));
      expect(res.status).toBe(201);
      const options = postsService.createPost.mock.calls[0][3];
      expect([...options.forceDraftIntegrationIds]).toEqual(['chB']);
      expect(router.route).toHaveBeenCalledWith('org-1', 'pb', { terminateWorkflow: false });
      const json = await res.json();
      expect(json[0]).toMatchObject({ postId: 'pa', approvalRequested: false, policy: { effect: 'ALLOW', matched: [] } });
      expect(json[1]).toMatchObject({ postId: 'pb', approvalRequested: true });
      expect(json[1].policy.effect).toBe('REQUIRE_APPROVAL');
    });

    it('ALLOW: elements carry an ALLOW policy and createPost gets no force set', async () => {
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('ALLOW', ['chA', 'chB']));
      const res = await send('POST', '/posts', createBody('schedule'));
      const json = await res.json();
      expect(json.map((x: any) => x.policy)).toEqual([
        { effect: 'ALLOW', matched: [] },
        { effect: 'ALLOW', matched: [] },
      ]);
      expect(json.map((x: any) => x.approvalRequested)).toEqual([false, false]);
      expect(postsService.createPost.mock.calls[0][3].forceDraftIntegrationIds).toBeUndefined();
    });

    it('draft with BLOCK is created and reported', async () => {
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('BLOCK', ['chA', 'chB']));
      const res = await send('POST', '/posts', createBody('draft'));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json[0].policy.effect).toBe('BLOCK');
      expect(router.route).not.toHaveBeenCalled();
    });

    it('too large content: 400 policy_input_too_large, nothing written', async () => {
      evaluation.targetsFromDraftBody.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
      const res = await send('POST', '/posts', createBody('schedule'));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('policy_input_too_large');
      expect(postsService.createPost).not.toHaveBeenCalled();
    });
  });

  describe('PUT /posts/:id', () => {
    const stored = (state: string) =>
      postsService.buildPostUpdate.mockResolvedValue({
        state,
        dto: {
          type: state === 'DRAFT' ? 'draft' : 'update',
          date: '2030-01-01T00:00:00.000Z',
          posts: [{ integration: { id: 'chA' }, value: [{ content: 'x' }] }],
        },
      });

    it('QUEUE post that now needs approval: edits, then routes with terminateWorkflow true', async () => {
      stored('QUEUE');
      postsService.createPost.mockResolvedValue([{ postId: 'p1', integration: 'chA' }]);
      evaluation.targetFromStoredPost.mockResolvedValue({ actors: [] });
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('REQUIRE_APPROVAL', ['chA']));
      const res = await send('PUT', '/posts/p1', { content: 'see https://x.test' });
      expect(res.status).toBe(200);
      expect(postsService.createPost).toHaveBeenCalledTimes(1);
      expect(postsService.createPost.mock.calls[0][3].forceDraftIntegrationIds).toBeUndefined();
      expect(router.route).toHaveBeenCalledWith('org-1', 'p1', { terminateWorkflow: true });
      const json = await res.json();
      expect(json[0]).toMatchObject({ postId: 'p1', approvalRequested: true });
    });

    it('evaluates the edit as SCHEDULE and excludes the edited post from its own daily cap', async () => {
      stored('QUEUE');
      evaluation.targetFromStoredPost.mockResolvedValue({ actors: [] });
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('ALLOW', ['chA']));
      postsService.createPost.mockResolvedValue([{ postId: 'p1', integration: 'chA' }]);
      await send('PUT', '/posts/p1', { content: 'x' });
      const draftBodyArg = evaluation.targetsFromDraftBody.mock.calls[0][1];
      expect(draftBodyArg.type).toBe('schedule');
      const targets = evaluation.evaluateTargets.mock.calls[0][1];
      expect(targets.every((t: any) => t.excludePostId === 'p1')).toBe(true);
    });

    it('BLOCK on a queued post edit: 422 and nothing saved', async () => {
      stored('QUEUE');
      evaluation.targetFromStoredPost.mockResolvedValue({ actors: [] });
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('BLOCK', ['chA']));
      const res = await send('PUT', '/posts/p1', { content: 'x' });
      expect(res.status).toBe(422);
      expect(postsService.createPost).not.toHaveBeenCalled();
    });

    it('DRAFT post: report only, no routing even on BLOCK', async () => {
      stored('DRAFT');
      evaluation.targetFromStoredPost.mockResolvedValue({ actors: [] });
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('BLOCK', ['chA']));
      postsService.createPost.mockResolvedValue([{ postId: 'p1', integration: 'chA' }]);
      const res = await send('PUT', '/posts/p1', { content: 'x' });
      expect(res.status).toBe(200);
      expect(evaluation.targetsFromDraftBody.mock.calls[0][1].type).toBe('draft');
      expect(router.route).not.toHaveBeenCalled();
      expect((await res.json())[0].policy.effect).toBe('BLOCK');
    });
  });

  describe('PUT /posts/:id/status', () => {
    beforeEach(() => evaluation.targetFromStoredPost.mockResolvedValue({ integrationId: 'chA', actors: [] }));

    it('schedule with BLOCK: 422 and changePostStatus not called', async () => {
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('BLOCK', ['chA']));
      const res = await send('PUT', '/posts/p1/status', { status: 'schedule' });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('policy_blocked');
      expect(postsService.changePostStatus).not.toHaveBeenCalled();
    });

    it('schedule with REQUIRE_APPROVAL: routes, answers APPROVAL and does not schedule', async () => {
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('REQUIRE_APPROVAL', ['chA']));
      const res = await send('PUT', '/posts/p1/status', { status: 'schedule' });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({ id: 'p1', state: 'APPROVAL', approvalRequested: true });
      expect(json.policy.effect).toBe('REQUIRE_APPROVAL');
      expect(router.route).toHaveBeenCalledWith('org-1', 'p1', { terminateWorkflow: true });
      expect(postsService.changePostStatus).not.toHaveBeenCalled();
    });

    it('schedule with ALLOW proceeds and keeps the existing keys', async () => {
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('ALLOW', ['chA']));
      const res = await send('PUT', '/posts/p1/status', { status: 'schedule' });
      expect(await res.json()).toEqual({
        id: 'p1',
        state: 'QUEUE',
        policy: { effect: 'ALLOW', matched: [] },
        approvalRequested: false,
      });
      expect(postsService.changePostStatus).toHaveBeenCalledWith('org-1', 'p1', 'schedule');
    });

    it('draft is report only', async () => {
      evaluation.evaluateTargets.mockResolvedValue(outcomeFor('BLOCK', ['chA']));
      const res = await send('PUT', '/posts/p1/status', { status: 'draft' });
      expect(res.status).toBe(200);
      expect(postsService.changePostStatus).toHaveBeenCalledWith('org-1', 'p1', 'draft');
      expect(router.route).not.toHaveBeenCalled();
    });
  });

  describe('approval scheduling path', () => {
    it('ApprovalService is not wired to the gate (the approved post is scheduled without re-evaluation)', () => {
      const params: any[] = Reflect.getMetadata('design:paramtypes', ApprovalService) ?? [];
      expect(params).not.toContain(PostPolicyGateService);
      expect(params).not.toContain(PolicyEvaluationService);
      expect(params).not.toContain(PolicyApprovalRouter);
    });
  });
});
