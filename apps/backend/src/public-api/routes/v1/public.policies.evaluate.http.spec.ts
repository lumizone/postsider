jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import 'reflect-metadata';
import { INestApplication, NotFoundException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AddressInfo } from 'net';
import { PublicPoliciesController } from './public.policies.controller';
import { PolicyRulesService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-rules.service';
import { PolicyEvaluationService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-evaluation.service';
import { PostPolicyGateService } from '@postsider/nestjs-libraries/database/prisma/policies/post-policy-gate.service';
import { PolicyApprovalRouter } from '@postsider/nestjs-libraries/database/prisma/policies/policy-approval-router';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';
import type { PostActor } from '@postsider/nestjs-libraries/actor/post-actor';
import type { KeyPermissions } from '@postsider/nestjs-libraries/policies/key-permissions';

const match = (effect: 'BLOCK' | 'REQUIRE_APPROVAL', name = 'No bad words') => ({
  ruleId: 'r1',
  name,
  effect,
  condition: 'CONTAINS_WORDS' as const,
});

describe('POST /policies/evaluate (dry run)', () => {
  let app: INestApplication;
  let base: string;
  let scopes: string[] = [];
  let actor: PostActor = { type: 'API_KEY', apiKeyId: 'k1' } as any;
  let keyPermissions: KeyPermissions | undefined;

  const evaluation = { targetsFromDraftBody: jest.fn(), evaluateTargets: jest.fn(), recordOutcome: jest.fn() };
  const gate = { preflightWrite: jest.fn(), finishCreate: jest.fn(), gateStatus: jest.fn(), gateRetry: jest.fn() };
  const router = { route: jest.fn() };
  const posts = { createPost: jest.fn(), changePostStatus: jest.fn() };
  const audit = { logSecurityEvent: jest.fn(), logResourceEvent: jest.fn() };
  const rules = { list: jest.fn() };

  beforeAll(async () => {
    const tokens = new Map<any, any>([
      [PolicyRulesService, rules],
      [AuditLogger, audit],
      [PolicyEvaluationService, evaluation],
      [PostPolicyGateService, gate],
      [PolicyApprovalRouter, router],
      [PostsService, posts],
    ]);
    const moduleRef = await Test.createTestingModule({ controllers: [PublicPoliciesController] })
      .useMocker((token) => tokens.get(token) ?? {})
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use((req: any, _res: any, next: any) => {
      req.org = { id: 'org-1', users: [{ role: 'SUPERADMIN' }] };
      req.publicApiScopes = scopes;
      runWithActor(actor, () => next(), keyPermissions ? { keyPermissions } : undefined);
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/public/v1`;
  });
  afterAll(async () => app.close());

  beforeEach(() => {
    jest.resetAllMocks();
    scopes = ['posts:read'];
    actor = { type: 'API_KEY', apiKeyId: 'k1' } as any;
    keyPermissions = undefined;
    evaluation.targetsFromDraftBody.mockImplementation(async (_o: string, b: any) =>
      b.posts.map((p: any) => ({ integrationId: p.integration.id, action: 'SCHEDULE', actors: [] }))
    );
    evaluation.evaluateTargets.mockResolvedValue({ effect: 'ALLOW', matched: [], channels: [] });
  });

  const send = (body: unknown) =>
    fetch(`${base}/policies/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const body = (over: Record<string, unknown> = {}) => ({
    type: 'schedule',
    date: '2030-01-01T00:00:00.000Z',
    posts: [{ integration: { id: 'chA' }, value: [{ content: 'hello' }] }],
    ...over,
  });
  const nothingWritten = () => {
    expect(gate.preflightWrite).not.toHaveBeenCalled();
    expect(gate.finishCreate).not.toHaveBeenCalled();
    expect(gate.gateStatus).not.toHaveBeenCalled();
    expect(router.route).not.toHaveBeenCalled();
    expect(posts.createPost).not.toHaveBeenCalled();
    expect(posts.changePostStatus).not.toHaveBeenCalled();
    expect(evaluation.recordOutcome).not.toHaveBeenCalled();
    expect(audit.logSecurityEvent).not.toHaveBeenCalled();
    expect(audit.logResourceEvent).not.toHaveBeenCalled();
  };

  it('needs posts:read and does not accept policies:read alone', async () => {
    scopes = ['policies:read', 'policies:write'];
    expect((await send(body())).status).toBe(403);
    expect(evaluation.evaluateTargets).not.toHaveBeenCalled();
  });

  it('returns a BLOCK with the rule name and writes nothing', async () => {
    evaluation.evaluateTargets.mockResolvedValue({
      effect: 'BLOCK',
      matched: [match('BLOCK', 'No\u2014bad words')],
      channels: [{ integrationId: 'chA', effect: 'BLOCK', matched: [match('BLOCK')] }],
    });
    const res = await send(body());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
      effect: 'BLOCK',
      matched: [{ ruleId: 'r1', name: 'No bad words', effect: 'BLOCK', condition: 'CONTAINS_WORDS' }],
      channels: [{ integrationId: 'chA', effect: 'BLOCK' }],
      key: { allowed: true },
    });
    expect(evaluation.evaluateTargets).toHaveBeenCalledWith('org-1', expect.any(Array), 'write');
    nothingWritten();
  });

  it('evaluates as the current actor (the API key behind the request)', async () => {
    await send(body());
    expect(evaluation.targetsFromDraftBody).toHaveBeenCalledWith('org-1', expect.any(Object), actor);
    actor = { type: 'API_KEY', apiKeyId: 'k2' } as any;
    await send(body());
    expect(evaluation.targetsFromDraftBody).toHaveBeenLastCalledWith('org-1', expect.any(Object), actor);
  });

  it('hands over only the fields rules can see, never unknown keys', async () => {
    const res = await send(
      body({
        organizationId: 'evil',
        shortLink: true,
        tags: [{ value: 'x' }],
        posts: [
          {
            integration: { id: 'chA', providerIdentifier: 'x' },
            value: [{ content: 'a', image: [{ path: 'https://x/y.mp4', id: 'i1' }], extra: 1 }],
            firstComment: 'fc',
            settings: { __type: 'x' },
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(evaluation.targetsFromDraftBody.mock.calls[0][1]).toEqual({
      type: 'schedule',
      date: '2030-01-01T00:00:00.000Z',
      posts: [
        {
          integration: { id: 'chA' },
          value: [{ content: 'a', image: [{ path: 'https://x/y.mp4' }] }],
          firstComment: 'fc',
        },
      ],
    });
  });

  it('reports a key action limit and still evaluates the rules', async () => {
    keyPermissions = { allowedActions: ['DRAFT'], allowedIntegrationIds: [] };
    evaluation.evaluateTargets.mockResolvedValue({
      effect: 'REQUIRE_APPROVAL',
      matched: [match('REQUIRE_APPROVAL')],
      channels: [{ integrationId: 'chA', effect: 'REQUIRE_APPROVAL', matched: [match('REQUIRE_APPROVAL')] }],
    });
    const json = await (await send(body())).json();
    expect(json.key).toEqual({ allowed: false, code: 'key_action_not_allowed' });
    expect(json.effect).toBe('REQUIRE_APPROVAL');
    expect(evaluation.evaluateTargets).toHaveBeenCalled();
    nothingWritten();
  });

  it('reports a key channel limit', async () => {
    keyPermissions = { allowedActions: [], allowedIntegrationIds: ['other'] };
    const json = await (await send(body())).json();
    expect(json.key).toEqual({ allowed: false, code: 'key_channel_not_allowed' });
  });

  it('allows when the key limit permits the action', async () => {
    keyPermissions = { allowedActions: ['SCHEDULE'], allowedIntegrationIds: ['chA'] };
    expect((await (await send(body())).json()).key).toEqual({ allowed: true });
    const draft = await (await send(body({ type: 'draft' }))).json();
    expect(draft.key).toEqual({ allowed: false, code: 'key_action_not_allowed' });
    const now = await (await send(body({ type: 'now' }))).json();
    expect(now.key).toEqual({ allowed: false, code: 'key_action_not_allowed' });
  });

  it('a channel of another organization is a 404', async () => {
    evaluation.targetsFromDraftBody.mockRejectedValue(new NotFoundException({ msg: 'Channel not found' }));
    expect((await send(body())).status).toBe(404);
    expect(evaluation.evaluateTargets).not.toHaveBeenCalled();
  });

  it('too large content is a 400 policy_input_too_large', async () => {
    evaluation.targetsFromDraftBody.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
    const res = await send(body());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('policy_input_too_large');
    nothingWritten();
  });

  it('rejects invalid bodies with 400 before evaluating', async () => {
    const many = Array.from({ length: 21 }, () => ({ integration: { id: 'chA' }, value: [{ content: 'a' }] }));
    for (const bad of [
      body({ posts: [] }),
      body({ posts: many }),
      body({ type: 'nope' }),
      body({ type: undefined }),
      body({ date: 'tomorrow' }),
      body({ posts: [{ integration: { id: 'chA' }, value: [] }] }),
    ]) {
      expect((await send(bad)).status).toBe(400);
    }
    expect(evaluation.targetsFromDraftBody).not.toHaveBeenCalled();
  });
});
