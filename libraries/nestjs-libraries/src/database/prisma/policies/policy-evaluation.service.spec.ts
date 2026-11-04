jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PolicyEvaluationService, PolicyTarget } from './policy-evaluation.service';
import { dayBounds } from '@postsider/nestjs-libraries/policies/policy-window';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';

const rule = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  name: 'Rule one',
  enabled: true,
  priority: 100,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  appliesToActorTypes: [],
  appliesToApiKeyIds: [],
  appliesToIntegrationIds: [],
  appliesToProviders: [],
  condition: 'CONTAINS_WORDS',
  conditionParams: { words: ['x'] },
  effect: 'BLOCK',
  ...over,
});

const target = (over: Partial<PolicyTarget> = {}): PolicyTarget => ({
  integrationId: 'i1',
  provider: 'x',
  action: 'SCHEDULE',
  actors: [{ type: 'API_KEY', apiKeyId: 'k1' }],
  text: 'hello',
  mediaTypes: [],
  scheduledAt: new Date('2026-03-10T12:00:00Z'),
  approved: false,
  ...over,
});

const make = (rules: any[] = []) => {
  const rulesRepo = { listEnabled: jest.fn().mockResolvedValue(rules) };
  const rulesService = { toRuleInputs: jest.fn((rows: any[]) => rows) };
  const posts = {
    countAutomationPostsInRange: jest.fn().mockResolvedValue(0),
    getPost: jest.fn().mockResolvedValue(null),
  };
  const integrations = {
    getIntegrationById: jest.fn().mockResolvedValue({ id: 'i1', providerIdentifier: 'linkedin' }),
  };
  const audit = { logResourceEvent: jest.fn().mockResolvedValue(undefined) };
  const service = new PolicyEvaluationService(
    rulesRepo as any,
    rulesService as any,
    posts as any,
    integrations as any,
    audit as any
  );
  return { service, rulesRepo, posts, integrations, audit };
};

describe('PolicyEvaluationService.evaluateTargets', () => {
  it('returns per channel outcomes and a de-duplicated union', async () => {
    const { service } = make([rule()]);
    const out = await service.evaluateTargets(
      'org',
      [target({ text: 'has x here' }), target({ integrationId: 'i2', text: 'clean' })],
      'write'
    );
    expect(out.effect).toBe('BLOCK');
    expect(out.channels.map((c) => c.effect)).toEqual(['BLOCK', 'ALLOW']);
    expect(out.matched).toHaveLength(1);
    expect(out.matched[0].ruleId).toBe('r1');
  });

  it('allows with a single rule load when there are no rules', async () => {
    const { service, rulesRepo, posts } = make([]);
    const out = await service.evaluateTargets('org', [target(), target()], 'publish');
    expect(out.effect).toBe('ALLOW');
    expect(rulesRepo.listEnabled).toHaveBeenCalledTimes(1);
    expect(rulesRepo.listEnabled).toHaveBeenCalledWith('org');
    expect(posts.countAutomationPostsInRange).not.toHaveBeenCalled();
  });

  it('orders the union by priority, createdAt and id', async () => {
    const { service } = make([
      rule({ id: 'b', name: 'B', priority: 200, effect: 'REQUIRE_APPROVAL' }),
      rule({ id: 'a', name: 'A', priority: 10 }),
    ]);
    const out = await service.evaluateTargets('org', [target({ text: 'x' })], 'write');
    expect(out.matched.map((m) => m.ruleId)).toEqual(['a', 'b']);
    expect(out.effect).toBe('BLOCK');
  });

  describe('daily cap', () => {
    const cap = (params: Record<string, unknown> = { max: 2, scope: 'organization' }) =>
      rule({ id: 'cap', condition: 'DAILY_CAP_EXCEEDED', conditionParams: params });

    it('matches at the limit and not below it', async () => {
      const a = make([cap()]);
      a.posts.countAutomationPostsInRange.mockResolvedValue(2);
      expect((await a.service.evaluateTargets('org', [target()], 'write')).effect).toBe('BLOCK');
      const b = make([cap()]);
      b.posts.countAutomationPostsInRange.mockResolvedValue(1);
      expect((await b.service.evaluateTargets('org', [target()], 'write')).effect).toBe('ALLOW');
    });

    it('uses the channel for channel scope, the rule timezone and excludePostId', async () => {
      const { service, posts } = make([
        cap({ max: 5, scope: 'channel', timezone: 'Europe/Warsaw' }),
      ]);
      const t = target({ excludePostId: 'p9' });
      await service.evaluateTargets('org', [t], 'publish');
      expect(posts.countAutomationPostsInRange).toHaveBeenCalledWith(
        'org',
        dayBounds(t.scheduledAt, 'Europe/Warsaw'),
        { integrationId: 'i1', excludePostId: 'p9' }
      );
    });

    it('does not pass an integration for organization scope', async () => {
      const { service, posts } = make([cap()]);
      await service.evaluateTargets('org', [target()], 'write');
      const opts = posts.countAutomationPostsInRange.mock.calls[0][2];
      expect(opts.integrationId).toBeUndefined();
    });

    it('adds earlier targets of the same request', async () => {
      const { service, posts } = make([cap()]);
      posts.countAutomationPostsInRange.mockResolvedValue(1);
      const out = await service.evaluateTargets('org', [target(), target()], 'write');
      expect(out.channels.map((c) => c.effect)).toEqual(['ALLOW', 'BLOCK']);
    });

    it('does not count earlier targets on other days or other channels for channel scope', async () => {
      const { service, posts } = make([cap({ max: 2, scope: 'channel' })]);
      posts.countAutomationPostsInRange.mockResolvedValue(1);
      const out = await service.evaluateTargets(
        'org',
        [
          target(),
          target({ integrationId: 'i2' }),
          target({ scheduledAt: new Date('2026-03-12T12:00:00Z') }),
        ],
        'write'
      );
      expect(out.effect).toBe('ALLOW');
    });

    it('ignores earlier DRAFT and USER targets of the request', async () => {
      const { service, posts } = make([cap()]);
      posts.countAutomationPostsInRange.mockResolvedValue(1);
      const out = await service.evaluateTargets(
        'org',
        [
          target({ action: 'DRAFT' }),
          target({ actors: [{ type: 'USER', userId: 'u1' }] }),
          target(),
        ],
        'write'
      );
      expect(out.channels[2].effect).toBe('ALLOW');
    });

    it('skips counting for a cap rule that does not apply to the target', async () => {
      const { service, posts } = make([
        { ...cap(), appliesToIntegrationIds: ['other'] },
      ]);
      await service.evaluateTargets('org', [target()], 'write');
      expect(posts.countAutomationPostsInRange).not.toHaveBeenCalled();
    });
  });
});

describe('PolicyEvaluationService.targetsFromDraftBody', () => {
  const actor = { type: 'API_KEY', apiKeyId: 'k1' } as const;
  const body = (over: Record<string, unknown> = {}) =>
    ({
      type: 'schedule',
      date: '2026-03-10T12:00:00.000Z',
      posts: [
        {
          integration: { id: 'i1' },
          value: [{ content: '<p>See <a href="https://a.com">a</a></p>' }],
        },
      ],
      ...over,
    }) as any;

  it('converts html to text with link targets, provider and actor', async () => {
    const { service, integrations } = make();
    const [t] = await service.targetsFromDraftBody('org', body(), actor);
    expect(t.text).toContain('https://a.com');
    expect(t.provider).toBe('linkedin');
    expect(t.integrationId).toBe('i1');
    expect(t.action).toBe('SCHEDULE');
    expect(t.scheduledAt.toISOString()).toBe('2026-03-10T12:00:00.000Z');
    expect(t.approved).toBe(false);
    expect(t.actors).toEqual([{ type: 'API_KEY', apiKeyId: 'k1' }]);
    expect(integrations.getIntegrationById).toHaveBeenCalledWith('org', 'i1');
  });

  it('includes the first comment and joins thread values', async () => {
    const { service } = make();
    const [t] = await service.targetsFromDraftBody(
      'org',
      body({
        posts: [
          {
            integration: { id: 'i1' },
            value: [{ content: '<p>one</p>' }, { content: '<p>two</p>' }],
            firstComment: 'comment text',
          },
        ],
      }),
      actor
    );
    expect(t.text).toContain('one');
    expect(t.text).toContain('two');
    expect(t.text).toContain('comment text');
  });

  it('derives media types from path extensions', async () => {
    const { service } = make();
    const [t] = await service.targetsFromDraftBody(
      'org',
      body({
        posts: [
          {
            integration: { id: 'i1' },
            value: [
              { content: 'a', image: [{ path: 'https://c/x.mp4' }, { path: '/up/y.png' }] },
            ],
          },
          { integration: { id: 'i1' }, value: [{ content: 'b' }] },
        ],
      }),
      actor
    );
    expect(t.mediaTypes.sort()).toEqual(['image', 'video']);
    const all = await service.targetsFromDraftBody(
      'org',
      body({ posts: [{ integration: { id: 'i1' }, value: [{ content: 'b' }] }] }),
      actor
    );
    expect(all[0].mediaTypes).toEqual([]);
  });

  it('maps the request type to an action', async () => {
    const { service } = make();
    const before = Date.now();
    const [now] = await service.targetsFromDraftBody('org', body({ type: 'now', date: undefined }), actor);
    expect(now.action).toBe('PUBLISH_NOW');
    expect(Math.abs(now.scheduledAt.getTime() - before)).toBeLessThan(5000);
    const [draft] = await service.targetsFromDraftBody('org', body({ type: 'draft' }), actor);
    expect(draft.action).toBe('DRAFT');
  });

  it('rejects an unknown channel with 404', async () => {
    const { service, integrations } = make();
    integrations.getIntegrationById.mockResolvedValue(null);
    await expect(service.targetsFromDraftBody('org', body(), actor)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('rejects a soft-deleted channel with 404', async () => {
    const { service, integrations } = make();
    integrations.getIntegrationById.mockResolvedValue({ id: 'i1', providerIdentifier: 'x', deletedAt: new Date() });
    await expect(service.targetsFromDraftBody('org', body(), actor)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('uses an explicit draft date', async () => {
    const { service } = make();
    const [t] = await service.targetsFromDraftBody('org', body({ type: 'draft' }), actor);
    expect(t.scheduledAt.toISOString()).toBe('2026-03-10T12:00:00.000Z');
  });

  it('rejects an invalid date with 400', async () => {
    const { service } = make();
    await expect(
      service.targetsFromDraftBody('org', body({ date: 'not-a-date' }), actor)
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.targetsFromDraftBody('org', body({ date: undefined }), actor)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets PolicyInputTooLargeError propagate', async () => {
    const { service } = make();
    await expect(
      service.targetsFromDraftBody(
        'org',
        body({ posts: [{ integration: { id: 'i1' }, value: [{ content: 'x'.repeat(300_000) }] }] }),
        actor
      )
    ).rejects.toBeInstanceOf(PolicyInputTooLargeError);
  });
});

describe('PolicyEvaluationService.targetFromStoredPost', () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    id: 'p1',
    integrationId: 'i1',
    integration: { id: 'i1', providerIdentifier: 'linkedin' },
    content: '<p>stored body</p>',
    firstComment: null,
    image: JSON.stringify([{ id: 'm', path: 'https://c/v.mov' }]),
    publishDate: new Date('2026-03-10T12:00:00Z'),
    childrenPost: [],
    createdByType: 'API_KEY',
    createdByApiKeyId: 'k1',
    createdByUserId: null,
    createdByOAuthClientId: null,
    lastModifiedByType: 'USER',
    lastModifiedByUserId: 'u1',
    lastModifiedByApiKeyId: null,
    lastModifiedByOAuthClientId: null,
    ...over,
  });

  it('builds two actor views for two different actors', async () => {
    const { service, posts } = make();
    posts.getPost.mockImplementation(async (id: string) =>
      id === 'p1'
        ? stored({ childrenPost: [{ id: 'c1', deletedAt: null }] })
        : { id: 'c1', content: '<p>child</p>', image: null, childrenPost: [] }
    );
    const t = await service.targetFromStoredPost('org', 'p1', { action: 'PUBLISH_NOW', approved: true });
    expect(posts.getPost).toHaveBeenCalledWith('p1', true, 'org');
    expect(t!.actors).toEqual([
      { type: 'API_KEY', apiKeyId: 'k1' },
      { type: 'USER', userId: 'u1' },
    ]);
    expect(t!.action).toBe('PUBLISH_NOW');
    expect(t!.approved).toBe(true);
    expect(t!.provider).toBe('linkedin');
    expect(t!.scheduledAt).toEqual(new Date('2026-03-10T12:00:00Z'));
    expect(t!.excludePostId).toBe('p1');
    expect(t!.text).toContain('stored body');
    expect(t!.text).toContain('child');
    expect(t!.mediaTypes).toEqual(['video']);
  });

  it('deduplicates identical actors', async () => {
    const { service, posts } = make();
    posts.getPost.mockResolvedValue(
      stored({
        lastModifiedByType: 'API_KEY',
        lastModifiedByApiKeyId: 'k1',
        lastModifiedByUserId: null,
      })
    );
    const t = await service.targetFromStoredPost('org', 'p1', { action: 'SCHEDULE', approved: false });
    expect(t!.actors).toEqual([{ type: 'API_KEY', apiKeyId: 'k1' }]);
  });

  it('walks a chained thread to the last value', async () => {
    const { service, posts } = make();
    const root = stored({ childrenPost: [{ id: 'c2', deletedAt: null }] });
    const c2 = { id: 'c2', content: '<p>two</p>', image: null, childrenPost: [{ id: 'c3', deletedAt: null }] };
    const c3 = {
      id: 'c3',
      content: '<p>badword https://l.com</p>',
      image: JSON.stringify([{ path: 'x.mp4' }]),
      childrenPost: [],
    };
    posts.getPost.mockImplementation(async (id: string) => ({ p1: root, c2, c3 })[id] ?? null);
    const t = await service.targetFromStoredPost('org', 'p1', { action: 'SCHEDULE', approved: false });
    expect(t!.text).toContain('two');
    expect(t!.text).toContain('badword');
    expect(t!.text).toContain('https://l.com');
    expect(t!.mediaTypes.sort()).toEqual(['video']);
    expect(posts.getPost).toHaveBeenCalledWith('c3', false, 'org');
  });

  it('ignores deleted children and stops when a child cannot be loaded', async () => {
    const { service, posts } = make();
    posts.getPost.mockImplementation(async (id: string) =>
      id === 'p1'
        ? stored({
            childrenPost: [
              { id: 'gone', deletedAt: new Date() },
              { id: 'c2', deletedAt: null },
            ],
          })
        : id === 'c2'
          ? { id: 'c2', content: 'live child', image: null, childrenPost: [{ id: 'c3', deletedAt: null }] }
          : null
    );
    const t = await service.targetFromStoredPost('org', 'p1', { action: 'SCHEDULE', approved: false });
    expect(t!.text).toContain('live child');
    expect(posts.getPost).not.toHaveBeenCalledWith('gone', false, 'org');
  });

  it('fails closed on an endless or oversized chain', async () => {
    const { service, posts } = make();
    posts.getPost.mockImplementation(async (id: string) =>
      id === 'p1'
        ? stored({ childrenPost: [{ id: 'n', deletedAt: null }] })
        : { id: 'n', content: 'a', image: null, childrenPost: [{ id: 'n', deletedAt: null }] }
    );
    await expect(
      service.targetFromStoredPost('org', 'p1', { action: 'SCHEDULE', approved: false })
    ).rejects.toBeInstanceOf(PolicyInputTooLargeError);
  });

  it('returns null when the integration is missing', async () => {
    const { service, posts } = make();
    posts.getPost.mockResolvedValue(stored({ integration: null }));
    expect(
      await service.targetFromStoredPost('org', 'p1', { action: 'SCHEDULE', approved: false })
    ).toBeNull();
  });

  it('returns null for a missing post', async () => {
    const { service } = make();
    expect(
      await service.targetFromStoredPost('org', 'nope', { action: 'SCHEDULE', approved: false })
    ).toBeNull();
  });
});

describe('PolicyEvaluationService.recordOutcome', () => {
  const outcome = (n = 1, effect: any = 'BLOCK') => ({
    effect,
    matched: Array.from({ length: n }, (_, i) => ({
      ruleId: `r${i + 1}`,
      name: i === 0 ? 'Rule one' : `Rule ${i + 1}`,
      effect: 'BLOCK' as const,
      condition: 'ALWAYS' as const,
    })),
    channels: [],
  });

  it('writes nothing for ALLOW', async () => {
    const { service, audit } = make();
    await service.recordOutcome('org', { effect: 'ALLOW', matched: [], channels: [] }, 'write', { postId: 'p1' });
    expect(audit.logResourceEvent).not.toHaveBeenCalled();
  });

  it('writes post.policy_evaluated for a post', async () => {
    const { service, audit } = make();
    await service.recordOutcome('org', outcome(), 'write', { postId: 'p1' });
    expect(audit.logResourceEvent).toHaveBeenCalledWith({
      organizationId: 'org',
      event: 'post.policy_evaluated',
      targetType: 'post',
      targetId: 'p1',
      metadata: {
        effect: 'BLOCK',
        phase: 'write',
        matchedCount: 1,
        ruleIds: 'r1',
        ruleNames: 'Rule one',
      },
    });
  });

  it('targets the organization without a post id', async () => {
    const { service, audit } = make();
    await service.recordOutcome('org', outcome(1, 'REQUIRE_APPROVAL'), 'publish', {});
    const entry = audit.logResourceEvent.mock.calls[0][0];
    expect(entry.targetType).toBe('organization');
    expect(entry.targetId).toBe('org');
    expect(entry.metadata.phase).toBe('publish');
  });

  it('lists at most five rules but counts all', async () => {
    const { service, audit } = make();
    await service.recordOutcome('org', outcome(7), 'write', { postId: 'p1' });
    const md = audit.logResourceEvent.mock.calls[0][0].metadata;
    expect(md.matchedCount).toBe(7);
    expect(md.ruleIds.split(',')).toEqual(['r1', 'r2', 'r3', 'r4', 'r5']);
  });

  it('keeps whole rule names within the metadata limit', async () => {
    const { service, audit } = make();
    const o = outcome(5);
    o.matched.forEach((m) => (m.name = 'N'.repeat(120)));
    await service.recordOutcome('org', o, 'write', { postId: 'p1' });
    const names: string = audit.logResourceEvent.mock.calls[0][0].metadata.ruleNames;
    expect(names.length).toBeLessThanOrEqual(200);
    expect(names).toBe(`${'N'.repeat(120)} | ...`);
  });

  it('never throws when the audit write fails', async () => {
    const { service, audit } = make();
    audit.logResourceEvent.mockRejectedValue(new Error('db down'));
    await expect(
      service.recordOutcome('org', outcome(), 'write', { postId: 'p1' })
    ).resolves.toBeUndefined();
  });
});
