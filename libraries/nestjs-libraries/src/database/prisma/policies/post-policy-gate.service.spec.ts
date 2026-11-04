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
    topLevelRowsOfGroup: jest.fn(),
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
    it('marks a draft report as not evaluated when the evaluation fails', async () => {
      evaluation.evaluateTargets.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
      const pre = await gate.preflightWrite('org', body('draft'), actor);
      expect(pre.evaluated).toBe(false);
      expect(pre.outcome.effect).toBe('ALLOW');
    });

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

    it('schedule fails closed with 400 when evaluation itself reports too large', async () => {
      evaluation.evaluateTargets.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
      const err: any = await gate.preflightWrite('org', body('schedule'), actor).catch((e) => e);
      expect(err.getStatus()).toBe(400);
    });

    it('draft fails open: an evaluation error skips the report', async () => {
      evaluation.evaluateTargets.mockRejectedValue(new Error('db down'));
      const pre = await gate.preflightWrite('org', body('draft'), actor);
      expect(pre.outcome.effect).toBe('ALLOW');
      expect(pre.approvalIntegrationIds.size).toBe(0);
    });

    it('draft edit fails open when the stored post is too large to evaluate', async () => {
      evaluation.targetFromStoredPost.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
      const pre = await gate.preflightWrite('org', body('draft'), actor, { editingPostId: 'p1' });
      expect(pre.outcome.effect).toBe('ALLOW');
    });

    it('scheduled edit fails closed when the stored post is too large', async () => {
      evaluation.targetFromStoredPost.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
      const err: any = await gate.preflightWrite('org', body('schedule'), actor, { editingPostId: 'p1' }).catch((e) => e);
      expect(err.getResponse().error).toBe('policy_input_too_large');
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

    it('sanitizes rule names in the decorated policy', async () => {
      const dirty = { ...match('REQUIRE_APPROVAL'), name: 'A\u2013B' };
      const out = await gate.finishCreate(
        'org',
        [{ postId: 'pb', integration: 'b' }],
        pre([{ integrationId: 'b', effect: 'REQUIRE_APPROVAL', matched: [dirty] }], []) as any
      );
      expect(out[0].policy.matched[0].name).toBe('A B');
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

    it('draft status fails open on any evaluation error and never routes', async () => {
      evaluation.targetFromStoredPost.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
      await expect(gate.gateStatus('org', 'p', 'draft')).resolves.toMatchObject({ proceed: true, approvalRequested: false });
      evaluation.targetFromStoredPost.mockResolvedValue(storedTarget);
      evaluation.evaluateTargets.mockRejectedValue(new Error('db down'));
      await expect(gate.gateStatus('org', 'p', 'draft')).resolves.toMatchObject({ proceed: true });
      expect(router.route).not.toHaveBeenCalled();
    });

    it('schedule status stays fail closed on evaluation errors', async () => {
      evaluation.evaluateTargets.mockRejectedValue(new Error('db down'));
      await expect(gate.gateStatus('org', 'p', 'schedule')).rejects.toThrow('db down');
    });

    it('exposes sanitized rule names but audits the stored ones', async () => {
      const dirty = match('REQUIRE_APPROVAL', 'Bad\u2014name\u202e');
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'REQUIRE_APPROVAL',
        matched: [dirty],
        channels: [{ integrationId: 'a', effect: 'REQUIRE_APPROVAL', matched: [dirty] }],
      });
      const out = await gate.gateStatus('org', 'p', 'schedule');
      expect(out.policy.matched[0].name).toBe('Bad name');
      expect(out.policy.channels[0].matched[0].name).toBe('Bad name');
      expect(evaluation.recordOutcome.mock.calls[0][1].matched[0].name).toBe('Bad\u2014name\u202e');
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

  describe('gateRetry', () => {
    const row = (id: string, integrationId: string, extra: Record<string, unknown> = {}) => ({
      id,
      integrationId,
      state: 'ERROR',
      errorCategory: null,
      releaseId: null,
      ...extra,
    });
    const retryOpts = { includeUnknownOutcome: false };

    beforeEach(() => {
      evaluation.targetFromStoredPost.mockImplementation(async (_o: string, id: string) =>
        target(id === 'A' ? 'a' : id === 'B' ? 'b' : 'c', { excludePostId: id })
      );
    });

    it('throws 422 when any ERROR row is blocked and evaluates only ERROR rows', async () => {
      evaluation.topLevelRowsOfGroup.mockResolvedValue([row('A', 'a'), row('B', 'b'), row('C', 'c', { state: 'PUBLISHED' })]);
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'BLOCK',
        matched: [match('BLOCK')],
        channels: [
          { integrationId: 'a', effect: 'ALLOW', matched: [] },
          { integrationId: 'b', effect: 'BLOCK', matched: [match('BLOCK')] },
        ],
      });
      const err: any = await gate.gateRetry('org', 'g', retryOpts).catch((e) => e);
      expect(err).toBeInstanceOf(PolicyBlockedException);
      expect(err.getStatus()).toBe(422);
      expect(evaluation.targetFromStoredPost.mock.calls.map((c) => c[1])).toEqual(['A', 'B']);
      expect(evaluation.targetFromStoredPost).toHaveBeenCalledWith('org', 'A', { action: 'SCHEDULE', approved: false });
      expect(evaluation.evaluateTargets).toHaveBeenCalledWith('org', expect.any(Array), 'write');
      expect(evaluation.recordOutcome).toHaveBeenCalledTimes(1);
      expect(router.route).not.toHaveBeenCalled();
    });

    it('collects REQUIRE_APPROVAL rows only', async () => {
      evaluation.topLevelRowsOfGroup.mockResolvedValue([row('A', 'a'), row('B', 'b')]);
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'REQUIRE_APPROVAL',
        matched: [match('REQUIRE_APPROVAL', 'Review\u2014me')],
        channels: [
          { integrationId: 'a', effect: 'ALLOW', matched: [] },
          { integrationId: 'b', effect: 'REQUIRE_APPROVAL', matched: [match('REQUIRE_APPROVAL', 'Review\u2014me')] },
        ],
      });
      const out = await gate.gateRetry('org', 'g', retryOpts);
      expect([...out.approvalPostIds]).toEqual(['B']);
      expect([...out.evaluatedPostIds]).toEqual(['A', 'B']);
      expect(out.policy.effect).toBe('REQUIRE_APPROVAL');
      expect(out.policy.matched[0].name).toBe('Review me');
      expect(router.route).not.toHaveBeenCalled();
    });

    it('does not evaluate rows the retry would skip', async () => {
      evaluation.topLevelRowsOfGroup.mockResolvedValue([
        row('A', 'a', { errorCategory: 'UNKNOWN_OUTCOME' }),
        row('B', 'b', { releaseId: 'rel1' }),
        row('C', 'c', { state: 'QUEUE' }),
      ]);
      const out = await gate.gateRetry('org', 'g', retryOpts);
      expect(out.policy.effect).toBe('ALLOW');
      expect(out.approvalPostIds.size).toBe(0);
      expect(evaluation.evaluateTargets).not.toHaveBeenCalled();
    });

    it('evaluates an unknown outcome row when confirmed', async () => {
      evaluation.topLevelRowsOfGroup.mockResolvedValue([row('A', 'a', { errorCategory: 'UNKNOWN_OUTCOME' })]);
      evaluation.evaluateTargets.mockResolvedValue(allow(['a']));
      await gate.gateRetry('org', 'g', { includeUnknownOutcome: true });
      expect(evaluation.targetFromStoredPost).toHaveBeenCalledTimes(1);
    });

    it('a POLICY_BLOCKED row retried while the rule still blocks is refused (no bypass)', async () => {
      evaluation.topLevelRowsOfGroup.mockResolvedValue([row('A', 'a', { errorCategory: 'POLICY_BLOCKED' })]);
      evaluation.evaluateTargets.mockResolvedValue({
        effect: 'BLOCK',
        matched: [match('BLOCK')],
        channels: [{ integrationId: 'a', effect: 'BLOCK', matched: [match('BLOCK')] }],
      });
      await expect(gate.gateRetry('org', 'g', retryOpts)).rejects.toBeInstanceOf(PolicyBlockedException);
    });

    it('a POLICY_BLOCKED row proceeds once the rule no longer matches', async () => {
      evaluation.topLevelRowsOfGroup.mockResolvedValue([row('A', 'a', { errorCategory: 'POLICY_BLOCKED' })]);
      evaluation.evaluateTargets.mockResolvedValue(allow(['a']));
      const out = await gate.gateRetry('org', 'g', retryOpts);
      expect(out.policy.effect).toBe('ALLOW');
      expect(out.approvalPostIds.size).toBe(0);
    });

    it('a row whose stored post is gone is not in evaluatedPostIds', async () => {
      evaluation.topLevelRowsOfGroup.mockResolvedValue([row('A', 'a'), row('B', 'b')]);
      evaluation.targetFromStoredPost.mockImplementation(async (_o: string, id: string) =>
        id === 'A' ? null : target('b')
      );
      evaluation.evaluateTargets.mockResolvedValue(allow(['b']));
      const out = await gate.gateRetry('org', 'g', retryOpts);
      expect([...out.evaluatedPostIds]).toEqual(['B']);
    });

    it('routeRetry only routes a row that is still in ERROR', async () => {
      await gate.routeRetry('org', 'A');
      expect(router.route).toHaveBeenCalledWith('org', 'A', { terminateWorkflow: false, onlyFromState: 'ERROR' });
    });

    it('skips a row whose stored post is gone', async () => {
      evaluation.topLevelRowsOfGroup.mockResolvedValue([row('A', 'a')]);
      evaluation.targetFromStoredPost.mockResolvedValue(null);
      const out = await gate.gateRetry('org', 'g', retryOpts);
      expect(out.policy.effect).toBe('ALLOW');
      expect(evaluation.evaluateTargets).not.toHaveBeenCalled();
    });

    it('fails closed with 400 policy_input_too_large', async () => {
      evaluation.topLevelRowsOfGroup.mockResolvedValue([row('A', 'a')]);
      evaluation.targetFromStoredPost.mockRejectedValue(new PolicyInputTooLargeError(1, 'big'));
      const err: any = await gate.gateRetry('org', 'g', retryOpts).catch((e) => e);
      expect(err.getStatus()).toBe(400);
      expect(err.getResponse().error).toBe('policy_input_too_large');
    });
  });
});
