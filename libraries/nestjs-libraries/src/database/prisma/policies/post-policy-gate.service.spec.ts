jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { HttpException } from '@nestjs/common';
import { PostPolicyGateService } from './post-policy-gate.service';
import { PolicyBlockedException } from '@postsider/nestjs-libraries/policies/policy-errors';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';

const match = (effect: 'BLOCK' | 'REQUIRE_APPROVAL', name = 'Rule one') => ({
  ruleId: `r-${name}`,
  name,
  effect,
  condition: 'CONTAINS_LINK' as const,
});

const target = (integrationId: string, extra: Record<string, unknown> = {}) => ({
  integrationId,
  provider: 'x',
  action: 'SCHEDULE',
  actors: [{ type: 'API_KEY', userId: null, apiKeyId: 'k1', oauthClientId: null }],
  text: 'hello',
  mediaTypes: [],
  scheduledAt: new Date('2030-01-01T10:00:00Z'),
  approved: false,
  ...extra,
});

const allow = (ids: string[]) => ({
  effect: 'ALLOW' as const,
  matched: [],
  channels: ids.map((integrationId) => ({ integrationId, effect: 'ALLOW' as const, matched: [] })),
});

describe('PostPolicyGateService', () => {
  const evaluation = {
    targetsFromDraftBody: jest.fn(),
    targetFromStoredPost: jest.fn(),
    evaluateTargets: jest.fn(),
    recordOutcome: jest.fn(),
  };
  const router = { route: jest.fn() };
  const gate = new PostPolicyGateService(evaluation as any, router as any);
  const actor = { type: 'API_KEY', apiKeyId: 'k1' } as any;
  const body = (type: 'draft' | 'schedule' | 'now', ids = ['a']) =>
    ({
      type,
      date: '2030-01-01T10:00:00Z',
      posts: ids.map((id) => ({ integration: { id }, value: [{ content: 'hi' }] })),
    }) as any;

  beforeEach(() => {
    jest.resetAllMocks();
    evaluation.recordOutcome.mockResolvedValue(undefined);
    router.route.mockResolvedValue({ requested: true, approvalId: 'ap' });
    evaluation.targetsFromDraftBody.mockImplementation(async (_o: string, b: any) =>
      b.posts.map((p: any) => target(p.integration.id, { action: b.type === 'draft' ? 'DRAFT' : 'SCHEDULE' }))
    );
  });

  describe('preflightWrite', () => {
    it('reports a BLOCK for a draft without throwing or routing', async () => {
      const blocked = {
        effect: 'BLOCK' as const,
        matched: [match('BLOCK')],
        channels: [{ integrationId: 'a', effect: 'BLOCK' as const, matched: [match('BLOCK')] }],
      };
      evaluation.evaluateTargets.mockResolvedValue(blocked);
      const pre = await gate.preflightWrite('org', body('draft'), actor);
      expect(pre.outcome.effect).toBe('BLOCK');
      expect(pre.approvalIntegrationIds.size).toBe(0);
      expect(evaluation.recordOutcome).toHaveBeenCalledTimes(1);
    });

    it.each(['schedule', 'now'] as const)('throws PolicyBlockedException for a %s BLOCK after recording once without a post id', async (type) => {
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'BLOCK',
        matched: [match('BLOCK', 'No links')],
        channels: [{ integrationId: 'a', effect: 'BLOCK', matched: [match('BLOCK', 'No links')] }],
      });
      const err: any = await gate.preflightWrite('org', body(type), actor).catch((e) => e);
      expect(err).toBeInstanceOf(PolicyBlockedException);
      expect(err.getStatus()).toBe(422);
      expect(err.getResponse().error).toBe('policy_blocked');
      expect(err.getResponse().msg).toContain('No links');
      expect(evaluation.recordOutcome).toHaveBeenCalledTimes(1);
      expect(evaluation.recordOutcome.mock.calls[0][3]).toEqual({});
      expect(evaluation.evaluateTargets.mock.calls[0][2]).toBe('write');
    });

    it('collects the REQUIRE_APPROVAL channels of a schedule', async () => {
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'REQUIRE_APPROVAL',
        matched: [match('REQUIRE_APPROVAL')],
        channels: [
          { integrationId: 'a', effect: 'ALLOW', matched: [] },
          { integrationId: 'b', effect: 'REQUIRE_APPROVAL', matched: [match('REQUIRE_APPROVAL')] },
        ],
      });
      const pre = await gate.preflightWrite('org', body('schedule', ['a', 'b']), actor);
      expect([...pre.approvalIntegrationIds]).toEqual(['b']);
      expect(evaluation.recordOutcome).not.toHaveBeenCalled();
    });

    it('does not collect approval channels for a draft', async () => {
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'REQUIRE_APPROVAL',
        matched: [match('REQUIRE_APPROVAL')],
        channels: [{ integrationId: 'a', effect: 'REQUIRE_APPROVAL', matched: [match('REQUIRE_APPROVAL')] }],
      });
      const pre = await gate.preflightWrite('org', body('draft'), actor);
      expect(pre.approvalIntegrationIds.size).toBe(0);
    });

    it('fails closed with 400 policy_input_too_large', async () => {
      evaluation.targetsFromDraftBody.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
      const err: any = await gate.preflightWrite('org', body('schedule'), actor).catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse().error).toBe('policy_input_too_large');
    });

    it('fails closed with 400 when evaluation itself reports too large', async () => {
      evaluation.evaluateTargets.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
      const err: any = await gate.preflightWrite('org', body('draft'), actor).catch((e) => e);
      expect(err.getStatus()).toBe(400);
    });

    it('other evaluation errors bubble (never ALLOW)', async () => {
      evaluation.evaluateTargets.mockRejectedValue(new Error('db down'));
      await expect(gate.preflightWrite('org', body('schedule'), actor)).rejects.toThrow('db down');
    });

    it('edit path: sets excludePostId on every target and keeps the stored actors', async () => {
      const stored = target('a', {
        actors: [{ type: 'AGENT', userId: null, apiKeyId: 'k9', oauthClientId: null }],
        excludePostId: 'p1',
      });
      evaluation.targetFromStoredPost.mockResolvedValue(stored);
      evaluation.evaluateTargets.mockResolvedValue(allow(['a']));
      await gate.preflightWrite('org', body('schedule'), actor, { editingPostId: 'p1' });
      const targets = evaluation.evaluateTargets.mock.calls[0][1];
      expect(targets[0].excludePostId).toBe('p1');
      expect(targets[0].actors.map((a: any) => a.type).sort()).toEqual(['AGENT', 'API_KEY']);
    });

    it('create path leaves excludePostId unset', async () => {
      evaluation.evaluateTargets.mockResolvedValue(allow(['a']));
      await gate.preflightWrite('org', body('schedule'), actor);
      expect(evaluation.evaluateTargets.mock.calls[0][1][0].excludePostId).toBeUndefined();
      expect(evaluation.targetFromStoredPost).not.toHaveBeenCalled();
    });
  });

  describe('finishCreate', () => {
    const pre = (channels: any[], approvals: string[]) => ({
      outcome: {
        effect: approvals.length ? ('REQUIRE_APPROVAL' as const) : ('ALLOW' as const),
        matched: [],
        channels,
      },
      approvalIntegrationIds: new Set(approvals),
    });
    const channels = [
      { integrationId: 'a', effect: 'ALLOW', matched: [] },
      { integrationId: 'b', effect: 'REQUIRE_APPROVAL', matched: [match('REQUIRE_APPROVAL')] },
    ];

    it('routes only the approval channel with terminateWorkflow false and decorates', async () => {
      const out = await gate.finishCreate(
        'org',
        [
          { postId: 'pa', integration: 'a' },
          { postId: 'pb', integration: 'b' },
        ],
        pre(channels, ['b']) as any
      );
      expect(router.route).toHaveBeenCalledTimes(1);
      expect(router.route).toHaveBeenCalledWith('org', 'pb', { terminateWorkflow: false });
      expect(out[0]).toEqual({
        postId: 'pa',
        integration: 'a',
        policy: { effect: 'ALLOW', matched: [] },
        approvalRequested: false,
      });
      expect(out[1].approvalRequested).toBe(true);
      expect(out[1].policy.effect).toBe('REQUIRE_APPROVAL');
      expect(out[1].policy.matched).toHaveLength(1);
      expect(evaluation.recordOutcome).toHaveBeenCalledTimes(1);
      expect(evaluation.recordOutcome.mock.calls[0][3]).toEqual({ postId: 'pb' });
    });

    it('passes terminateWorkflow through for the edit path', async () => {
      await gate.finishCreate('org', [{ postId: 'pb', integration: 'b' }], pre(channels, ['b']) as any, {
        terminateWorkflow: true,
      });
      expect(router.route).toHaveBeenCalledWith('org', 'pb', { terminateWorkflow: true });
    });

    it('reports requested false from an idempotent router as approvalRequested false', async () => {
      router.route.mockResolvedValue({ requested: false, approvalId: 'ap' });
      const out = await gate.finishCreate('org', [{ postId: 'pb', integration: 'b' }], pre(channels, ['b']) as any);
      expect(out[0].approvalRequested).toBe(false);
    });

    it('a router failure rejects (no swallow)', async () => {
      router.route.mockRejectedValue(new Error('boom'));
      await expect(
        gate.finishCreate('org', [{ postId: 'pb', integration: 'b' }], pre(channels, ['b']) as any)
      ).rejects.toThrow('boom');
    });

    it('draft report: reports REQUIRE_APPROVAL effect without routing', async () => {
      const out = await gate.finishCreate('org', [{ postId: 'pb', integration: 'b' }], pre(channels, []) as any);
      expect(router.route).not.toHaveBeenCalled();
      expect(out[0].policy.effect).toBe('REQUIRE_APPROVAL');
      expect(out[0].approvalRequested).toBe(false);
    });
  });

  describe('gateStatus', () => {
    const storedTarget = target('a');
    beforeEach(() => evaluation.targetFromStoredPost.mockResolvedValue(storedTarget));

    it('draft is reported only and never routes', async () => {
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'REQUIRE_APPROVAL',
        matched: [match('REQUIRE_APPROVAL')],
        channels: [{ integrationId: 'a', effect: 'REQUIRE_APPROVAL', matched: [match('REQUIRE_APPROVAL')] }],
      });
      const out = await gate.gateStatus('org', 'p', 'draft');
      expect(out.proceed).toBe(true);
      expect(out.approvalRequested).toBe(false);
      expect(router.route).not.toHaveBeenCalled();
      expect(evaluation.targetFromStoredPost.mock.calls[0][2]).toEqual({ action: 'DRAFT', approved: false });
    });

    it('draft with BLOCK does not throw', async () => {
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'BLOCK',
        matched: [match('BLOCK')],
        channels: [{ integrationId: 'a', effect: 'BLOCK', matched: [match('BLOCK')] }],
      });
      await expect(gate.gateStatus('org', 'p', 'draft')).resolves.toMatchObject({ proceed: true });
    });

    it('schedule with BLOCK throws and records once with the post id', async () => {
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'BLOCK',
        matched: [match('BLOCK')],
        channels: [{ integrationId: 'a', effect: 'BLOCK', matched: [match('BLOCK')] }],
      });
      await expect(gate.gateStatus('org', 'p', 'schedule')).rejects.toBeInstanceOf(PolicyBlockedException);
      expect(evaluation.recordOutcome).toHaveBeenCalledTimes(1);
      expect(evaluation.recordOutcome.mock.calls[0][3]).toEqual({ postId: 'p' });
    });

    it('schedule with REQUIRE_APPROVAL routes with terminateWorkflow true and does not proceed', async () => {
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'REQUIRE_APPROVAL',
        matched: [match('REQUIRE_APPROVAL')],
        channels: [{ integrationId: 'a', effect: 'REQUIRE_APPROVAL', matched: [match('REQUIRE_APPROVAL')] }],
      });
      const out = await gate.gateStatus('org', 'p', 'schedule');
      expect(router.route).toHaveBeenCalledTimes(1);
      expect(router.route).toHaveBeenCalledWith('org', 'p', { terminateWorkflow: true });
      expect(out).toMatchObject({ proceed: false, approvalRequested: true });
      expect(evaluation.recordOutcome.mock.calls[0][3]).toEqual({ postId: 'p' });
    });

    it('a post already in approval is routed once and requested false passes through', async () => {
      router.route.mockResolvedValue({ requested: false, approvalId: 'ap' });
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'REQUIRE_APPROVAL',
        matched: [match('REQUIRE_APPROVAL')],
        channels: [{ integrationId: 'a', effect: 'REQUIRE_APPROVAL', matched: [match('REQUIRE_APPROVAL')] }],
      });
      const out = await gate.gateStatus('org', 'p', 'schedule');
      expect(router.route).toHaveBeenCalledTimes(1);
      expect(out).toMatchObject({ proceed: false, approvalRequested: false });
    });

    it('ALLOW proceeds', async () => {
      evaluation.evaluateTargets.mockResolvedValue(allow(['a']));
      const out = await gate.gateStatus('org', 'p', 'schedule');
      expect(out.proceed).toBe(true);
      expect(router.route).not.toHaveBeenCalled();
    });

    it('missing post: proceeds so the service reports not found', async () => {
      evaluation.targetFromStoredPost.mockResolvedValue(null);
      const out = await gate.gateStatus('org', 'p', 'schedule');
      expect(out.proceed).toBe(true);
      expect(evaluation.evaluateTargets).not.toHaveBeenCalled();
    });

    it('fails closed with 400 policy_input_too_large', async () => {
      evaluation.targetFromStoredPost.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
      const err: any = await gate.gateStatus('org', 'p', 'schedule').catch((e) => e);
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse().error).toBe('policy_input_too_large');
    });
  });
});
