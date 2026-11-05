jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { PublishPolicyGuard } from './publish-policy.guard';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';

const match = (effect: 'BLOCK' | 'REQUIRE_APPROVAL', name: string) => ({
  ruleId: `r-${name}`,
  name,
  effect,
  condition: 'CONTAINS_LINK' as const,
});

const outcomeOf = (effect: 'ALLOW' | 'BLOCK' | 'REQUIRE_APPROVAL', names: string[] = []) => {
  const matched = names.map((n) => match(effect as any, n));
  return { effect, matched, channels: [{ integrationId: 'int1', effect, matched }] };
};

const storedTarget = (extra: Record<string, unknown> = {}) => ({
  integrationId: 'int1',
  provider: 'x',
  action: 'SCHEDULE',
  actors: [
    { type: 'API_KEY', userId: null, apiKeyId: 'k1', oauthClientId: null },
    { type: 'USER', userId: 'u1', apiKeyId: null, oauthClientId: null },
  ],
  text: 'hello',
  mediaTypes: [],
  scheduledAt: new Date('2030-01-01T10:00:00Z'),
  approved: false,
  excludePostId: 'p1',
  ...extra,
});

describe('PublishPolicyGuard', () => {
  const evaluation = {
    hasEnabledRules: jest.fn(),
    targetFromStoredPost: jest.fn(),
    evaluateTargets: jest.fn(),
    recordOutcome: jest.fn(),
  };
  const router = { route: jest.fn() };
  const approvals = { getForPost: jest.fn() };
  const posts = { getPostById: jest.fn() };
  const guard = new PublishPolicyGuard(evaluation as any, router as any, approvals as any, posts as any);

  beforeEach(() => {
    jest.resetAllMocks();
    evaluation.recordOutcome.mockResolvedValue(undefined);
    evaluation.targetFromStoredPost.mockImplementation(async (_o: string, _p: string, opts: any) =>
      storedTarget({ approved: opts.approved })
    );
    router.route.mockResolvedValue({ requested: true, approvalId: 'ap1' });
    approvals.getForPost.mockResolvedValue(null);
    evaluation.hasEnabledRules.mockResolvedValue(true);
    posts.getPostById.mockResolvedValue({ id: 'p1', state: 'QUEUE' });
  });

  it('an organization without enabled rules is allowed without loading the post', async () => {
    evaluation.hasEnabledRules.mockResolvedValue(false);
    await expect(guard.checkBeforePublish('org', 'p1')).resolves.toEqual({ kind: 'allow' });
    expect(evaluation.targetFromStoredPost).not.toHaveBeenCalled();
    expect(evaluation.evaluateTargets).not.toHaveBeenCalled();
  });

  it('REQUIRE_APPROVAL on an already PUBLISHED post (repeat child) is withheld with no state change', async () => {
    posts.getPostById.mockResolvedValue({ id: 'p1', state: 'PUBLISHED' });
    const out = outcomeOf('REQUIRE_APPROVAL', ['Needs review']);
    evaluation.evaluateTargets.mockResolvedValue(out);
    await expect(guard.checkBeforePublish('org', 'p1')).resolves.toEqual({ kind: 'approval_requested' });
    expect(router.route).not.toHaveBeenCalled();
    expect(evaluation.recordOutcome).toHaveBeenCalledWith('org', out, 'publish', { postId: 'p1' });
  });

  it('BLOCK on an already PUBLISHED post stays blocked', async () => {
    posts.getPostById.mockResolvedValue({ id: 'p1', state: 'PUBLISHED' });
    evaluation.evaluateTargets.mockResolvedValue(outcomeOf('BLOCK', ['No links']));
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('blocked');
  });

  it('allows when no rule matches and does not look up an approval', async () => {
    evaluation.evaluateTargets.mockResolvedValue(outcomeOf('ALLOW'));
    await expect(guard.checkBeforePublish('org', 'p1')).resolves.toEqual({ kind: 'allow' });
    expect(approvals.getForPost).not.toHaveBeenCalled();
    expect(router.route).not.toHaveBeenCalled();
    expect(evaluation.targetFromStoredPost).toHaveBeenCalledWith('org', 'p1', {
      action: 'SCHEDULE',
      approved: false,
    });
    expect(evaluation.evaluateTargets.mock.calls[0][2]).toBe('publish');
  });

  it('a BLOCK rule yields a non retryable POLICY_BLOCKED failure and records the outcome', async () => {
    const out = outcomeOf('BLOCK', ['No links', 'No\u2014promo']);
    evaluation.evaluateTargets.mockResolvedValue(out);
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('blocked');
    expect(decision.failure.category).toBe('POLICY_BLOCKED');
    expect(decision.failure.retryable).toBe(false);
    expect(decision.failure.autoRetry).toBe('none');
    expect(decision.failure.message).toBe('Blocked by policy: No links, No promo.');
    expect(decision.failure.message.length).toBeLessThanOrEqual(500);
    expect(decision.failure.message).not.toMatch(/[\u2010-\u2015-]/);
    expect(evaluation.recordOutcome).toHaveBeenCalledWith('org', out, 'publish', { postId: 'p1' });
    expect(approvals.getForPost).not.toHaveBeenCalled();
  });

  it('keeps the failure message within 500 characters and without dashes for many long names', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `${'n\u2013'.repeat(40)}${i}`);
    evaluation.evaluateTargets.mockResolvedValue(outcomeOf('BLOCK', names));
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('blocked');
    expect(decision.failure.message.length).toBeLessThanOrEqual(500);
    expect(decision.failure.message).not.toMatch(/[\u2010-\u2015-]/);
  });

  it('REQUIRE_APPROVAL without an approval routes with terminateWorkflow false', async () => {
    const out = outcomeOf('REQUIRE_APPROVAL', ['Needs review']);
    evaluation.evaluateTargets.mockResolvedValue(out);
    await expect(guard.checkBeforePublish('org', 'p1')).resolves.toEqual({
      kind: 'approval_requested',
    });
    expect(router.route).toHaveBeenCalledWith('org', 'p1', { terminateWorkflow: false, ruleIds: ['r-Needs review'] });
    expect(evaluation.recordOutcome).toHaveBeenCalledWith('org', out, 'publish', { postId: 'p1' });
  });

  it('routes with only the REQUIRE_APPROVAL rule ids in match order, never a BLOCK id', async () => {
    const matched = [match('REQUIRE_APPROVAL', 'B rule'), match('BLOCK', 'Hard'), match('REQUIRE_APPROVAL', 'A rule')];
    evaluation.evaluateTargets.mockResolvedValue({
      effect: 'REQUIRE_APPROVAL',
      matched,
      channels: [{ integrationId: 'int1', effect: 'REQUIRE_APPROVAL', matched }],
    });
    await guard.checkBeforePublish('org', 'p1');
    expect(router.route).toHaveBeenCalledWith('org', 'p1', {
      terminateWorkflow: false,
      ruleIds: ['r-B rule', 'r-A rule'],
    });
  });

  it('REQUIRE_APPROVAL with an APPROVED approval is evaluated as approved and allowed', async () => {
    approvals.getForPost.mockResolvedValue({ id: 'ap1', status: 'APPROVED' });
    evaluation.evaluateTargets
      .mockResolvedValueOnce(outcomeOf('REQUIRE_APPROVAL', ['Needs review']))
      .mockResolvedValueOnce(outcomeOf('ALLOW'));
    await expect(guard.checkBeforePublish('org', 'p1')).resolves.toEqual({ kind: 'allow' });
    expect(approvals.getForPost).toHaveBeenCalledWith('org', 'p1');
    expect(evaluation.targetFromStoredPost).toHaveBeenLastCalledWith('org', 'p1', {
      action: 'SCHEDULE',
      approved: true,
    });
    expect(router.route).not.toHaveBeenCalled();
  });

  it.each(['PENDING', 'REJECTED'])('REQUIRE_APPROVAL with a %s approval is routed, not allowed', async (status) => {
    approvals.getForPost.mockResolvedValue({ id: 'ap1', status });
    evaluation.evaluateTargets.mockResolvedValue(outcomeOf('REQUIRE_APPROVAL', ['Needs review']));
    await expect(guard.checkBeforePublish('org', 'p1')).resolves.toEqual({
      kind: 'approval_requested',
    });
    expect(router.route).toHaveBeenCalledWith('org', 'p1', { terminateWorkflow: false, ruleIds: ['r-Needs review'] });
    expect(evaluation.evaluateTargets).toHaveBeenCalledTimes(1);
  });

  it('a BLOCK rule stays blocked even with an APPROVED approval', async () => {
    approvals.getForPost.mockResolvedValue({ id: 'ap1', status: 'APPROVED' });
    evaluation.evaluateTargets.mockResolvedValue(outcomeOf('BLOCK', ['No links']));
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('blocked');
  });

  it('an APPROVED approval does not hide a BLOCK that remains on the approved evaluation', async () => {
    approvals.getForPost.mockResolvedValue({ id: 'ap1', status: 'APPROVED' });
    evaluation.evaluateTargets
      .mockResolvedValueOnce(outcomeOf('REQUIRE_APPROVAL', ['Needs review']))
      .mockResolvedValueOnce(outcomeOf('BLOCK', ['Daily cap']));
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('blocked');
    expect(decision.failure.message).toBe('Blocked by policy: Daily cap.');
  });

  it('passes the stored target (API_KEY creator, USER editor actors) through to the evaluation', async () => {
    evaluation.evaluateTargets.mockImplementation(async (_o: string, targets: any[]) => {
      const automation = targets[0].actors.some((a: any) => a.type === 'API_KEY');
      return automation ? outcomeOf('BLOCK', ['Automation only']) : outcomeOf('ALLOW');
    });
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('blocked');
    expect(evaluation.evaluateTargets.mock.calls[0][1][0].actors).toHaveLength(2);
  });

  it('uses the SCHEDULE action so a PUBLISH_NOW rule never matches at publish time', async () => {
    evaluation.evaluateTargets.mockResolvedValue(outcomeOf('ALLOW'));
    await guard.checkBeforePublish('org', 'p1');
    const target = evaluation.evaluateTargets.mock.calls[0][1][0];
    expect(target.action).toBe('SCHEDULE');
  });

  it('fails closed with a retryable UNKNOWN error when loading the rules throws', async () => {
    evaluation.evaluateTargets.mockRejectedValue(new Error('db down'));
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('error');
    expect(decision.failure.category).toBe('UNKNOWN');
    expect(decision.failure.retryable).toBe(true);
    expect(decision.failure.autoRetry).toBe('none');
    expect(decision.failure.message.length).toBeLessThanOrEqual(500);
  });

  it('fails closed with an error decision when the approval lookup throws', async () => {
    approvals.getForPost.mockRejectedValue(new Error('db down'));
    evaluation.evaluateTargets.mockResolvedValue(outcomeOf('REQUIRE_APPROVAL', ['Needs review']));
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('error');
    expect(router.route).not.toHaveBeenCalled();
  });

  it('a router failure is an error decision, never an allow', async () => {
    evaluation.evaluateTargets.mockResolvedValue(outcomeOf('REQUIRE_APPROVAL', ['Needs review']));
    router.route.mockRejectedValue(new Error('cannot route'));
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('error');
    expect(decision.failure.category).toBe('UNKNOWN');
    expect(decision.failure.retryable).toBe(true);
  });

  it('a missing stored post is an error decision (nothing to verify)', async () => {
    evaluation.targetFromStoredPost.mockResolvedValue(null);
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('error');
    expect(evaluation.evaluateTargets).not.toHaveBeenCalled();
  });

  it('content too large to evaluate is a blocked decision (fail closed, non retryable)', async () => {
    evaluation.evaluateTargets.mockRejectedValue(new PolicyInputTooLargeError(300000, 'too big'));
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('blocked');
    expect(decision.failure.category).toBe('POLICY_BLOCKED');
    expect(decision.failure.retryable).toBe(false);
    expect(decision.failure.message).toMatch(/too large/);
    expect(evaluation.recordOutcome).toHaveBeenCalledWith(
      'org',
      expect.objectContaining({ effect: 'BLOCK' }),
      'publish',
      { postId: 'p1' }
    );
  });

  it('a failing audit write never changes the decision', async () => {
    evaluation.evaluateTargets.mockResolvedValue(outcomeOf('BLOCK', ['No links']));
    evaluation.recordOutcome.mockRejectedValue(new Error('audit down'));
    const decision: any = await guard.checkBeforePublish('org', 'p1');
    expect(decision.kind).toBe('blocked');
  });
});
