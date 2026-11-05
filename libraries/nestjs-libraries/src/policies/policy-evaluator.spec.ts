import { evaluatePolicies, ruleApplies, conditionHolds, AUTOMATION_ACTOR_TYPES } from './policy-evaluator';
import type { PolicyContext, PolicyRuleInput } from './policy-types';

let n = 0;
const rule = (p: Partial<PolicyRuleInput> = {}): PolicyRuleInput => ({
  id: `r${++n}`,
  name: 'rule',
  enabled: true,
  priority: 100,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  appliesToActorTypes: [],
  appliesToApiKeyIds: [],
  appliesToIntegrationIds: [],
  appliesToProviders: [],
  condition: 'ALWAYS',
  conditionParams: {},
  effect: 'REQUIRE_APPROVAL',
  ...p,
});
const ctx = (p: Partial<PolicyContext> = {}): PolicyContext => ({
  phase: 'write',
  action: 'SCHEDULE',
  actors: [{ type: 'API_KEY', apiKeyId: 'k1' }],
  integrationId: 'i1',
  provider: 'linkedin',
  text: '',
  mediaTypes: [],
  scheduledAt: new Date('2026-06-03T10:00:00Z'),
  approved: false,
  dailyCounts: {},
  ...p,
});
const WINDOW = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', timezone: 'Europe/Warsaw' };

describe('evaluatePolicies combination', () => {
  it('allows with no rules and ignores disabled rules', () => {
    expect(evaluatePolicies(ctx(), [])).toEqual({ effect: 'ALLOW', matched: [] });
    expect(evaluatePolicies(ctx(), [rule({ enabled: false, effect: 'BLOCK' })])).toEqual({
      effect: 'ALLOW',
      matched: [],
    });
  });
  it('require approval only', () => {
    expect(evaluatePolicies(ctx(), [rule()]).effect).toBe('REQUIRE_APPROVAL');
  });
  it('block beats approval and lists both', () => {
    const r = evaluatePolicies(ctx(), [rule(), rule({ effect: 'BLOCK' })]);
    expect(r.effect).toBe('BLOCK');
    expect(r.matched.map((m) => m.effect).sort()).toEqual(['BLOCK', 'REQUIRE_APPROVAL']);
  });
  it('orders by priority, then createdAt, then id', () => {
    const a = rule({ id: 'a', priority: 5 });
    const b = rule({ id: 'b', priority: 1 });
    expect(evaluatePolicies(ctx(), [a, b]).matched.map((m) => m.ruleId)).toEqual(['b', 'a']);
    const c = rule({ id: 'c', createdAt: new Date('2026-02-01T00:00:00Z') });
    const d = rule({ id: 'd' });
    const e = rule({ id: 'e' });
    expect(evaluatePolicies(ctx(), [c, e, d]).matched.map((m) => m.ruleId)).toEqual(['d', 'e', 'c']);
  });
  it('match carries ruleId, name, effect, condition', () => {
    const r = rule({ id: 'x', name: 'N', effect: 'BLOCK' });
    expect(evaluatePolicies(ctx(), [r]).matched).toEqual([
      { ruleId: 'x', name: 'N', effect: 'BLOCK', condition: 'ALWAYS' },
    ]);
  });
  it('exports automation actor types', () => {
    expect([...AUTOMATION_ACTOR_TYPES]).toEqual(['API_KEY', 'OAUTH_CLIENT']);
  });
});

describe('actor filter', () => {
  it('empty types applies to automation only', () => {
    expect(ruleApplies(rule(), ctx())).toBe(true);
    expect(ruleApplies(rule(), ctx({ actors: [{ type: 'OAUTH_CLIENT', oauthClientId: 'o' } as never] }))).toBe(true);
    expect(ruleApplies(rule(), ctx({ actors: [{ type: 'USER', userId: 'u' }] }))).toBe(false);
    expect(ruleApplies(rule(), ctx({ actors: [{ type: 'SYSTEM' }] }))).toBe(false);
  });
  it('explicit USER applies to a USER only', () => {
    const r = rule({ appliesToActorTypes: ['USER'] });
    expect(ruleApplies(r, ctx({ actors: [{ type: 'USER', userId: 'u' }] }))).toBe(true);
    expect(ruleApplies(r, ctx())).toBe(false);
  });
  it('either actor of a publish-time pair may match', () => {
    const actors = [{ type: 'USER' as const, userId: 'u' }, { type: 'API_KEY' as const, apiKeyId: 'k1' }];
    expect(ruleApplies(rule(), ctx({ actors }))).toBe(true);
  });
  it('api key id filter', () => {
    const r = rule({ appliesToApiKeyIds: ['k2'] });
    expect(ruleApplies(r, ctx())).toBe(false);
    expect(ruleApplies(r, ctx({ actors: [{ type: 'API_KEY' }] }))).toBe(false);
    expect(ruleApplies(r, ctx({ actors: [{ type: 'OAUTH_CLIENT', oauthClientId: 'o' } as never] }))).toBe(false);
    expect(ruleApplies(r, ctx({ actors: [{ type: 'API_KEY', apiKeyId: 'k2' }] }))).toBe(true);
  });
  it('no actors never applies', () => {
    expect(ruleApplies(rule(), ctx({ actors: [] }))).toBe(false);
  });
});

describe('channel filters', () => {
  it('integration and provider', () => {
    expect(ruleApplies(rule({ appliesToIntegrationIds: ['i2'] }), ctx())).toBe(false);
    expect(ruleApplies(rule({ appliesToIntegrationIds: ['i1'] }), ctx())).toBe(true);
    expect(ruleApplies(rule({ appliesToProviders: ['x'] }), ctx())).toBe(false);
    expect(ruleApplies(rule({ appliesToProviders: ['linkedin'] }), ctx())).toBe(true);
  });
  it('disabled rule does not apply', () => {
    expect(ruleApplies(rule({ enabled: false }), ctx())).toBe(false);
  });
});

describe('conditions', () => {
  const holds = (c: PolicyRuleInput['condition'], params: unknown, x: Partial<PolicyContext> = {}) =>
    conditionHolds(rule({ condition: c, conditionParams: params }), ctx(x));
  it('CONTAINS_LINK', () => {
    expect(holds('CONTAINS_LINK', {}, { text: 'visit https://a.com' })).toBe(true);
    expect(holds('CONTAINS_LINK', {}, { text: 'hello' })).toBe(false);
  });
  it('CONTAINS_WORDS', () => {
    expect(holds('CONTAINS_WORDS', { words: ['guarantee'] }, { text: 'We GUARANTEE it' })).toBe(true);
    expect(holds('CONTAINS_WORDS', { words: ['guarantee'] }, { text: 'fine' })).toBe(false);
  });
  it('OUTSIDE_WINDOW', () => {
    expect(holds('OUTSIDE_WINDOW', WINDOW, { scheduledAt: new Date('2026-06-06T10:00:00Z') })).toBe(true);
    expect(holds('OUTSIDE_WINDOW', WINDOW, { scheduledAt: new Date('2026-06-08T08:00:00Z') })).toBe(false);
  });
  it('PUBLISH_NOW', () => {
    expect(holds('PUBLISH_NOW', {}, { action: 'PUBLISH_NOW' })).toBe(true);
    expect(holds('PUBLISH_NOW', {}, { action: 'SCHEDULE' })).toBe(false);
  });
  it('HAS_VIDEO', () => {
    expect(holds('HAS_VIDEO', {}, { mediaTypes: ['image', 'video'] })).toBe(true);
    expect(holds('HAS_VIDEO', {}, { mediaTypes: ['image'] })).toBe(false);
  });
  it('DAILY_CAP_EXCEEDED', () => {
    const r = rule({ condition: 'DAILY_CAP_EXCEEDED', conditionParams: { max: 3, scope: 'organization' } });
    const c = (organization: number, channel = 0) => ctx({ dailyCounts: { [r.id]: { organization, channel } } });
    expect(conditionHolds(r, c(2))).toBe(false);
    expect(conditionHolds(r, c(3))).toBe(true);
    expect(conditionHolds(r, ctx())).toBe(false);
    const ch = rule({ condition: 'DAILY_CAP_EXCEEDED', conditionParams: { max: 3, scope: 'channel' } });
    expect(conditionHolds(ch, ctx({ dailyCounts: { [ch.id]: { organization: 0, channel: 3 } } }))).toBe(true);
    expect(conditionHolds(ch, ctx({ dailyCounts: { [ch.id]: { organization: 9, channel: 2 } } }))).toBe(false);
  });
  it('invalid params never hold and do not throw', () => {
    const r = rule({ condition: 'CONTAINS_WORDS', conditionParams: { words: 'guarantee' } });
    expect(() => evaluatePolicies(ctx({ text: 'guarantee' }), [r])).not.toThrow();
    expect(evaluatePolicies(ctx({ text: 'guarantee' }), [r]).effect).toBe('ALLOW');
  });
});

describe('approved', () => {
  it('removes approval matches but keeps blocks', () => {
    expect(evaluatePolicies(ctx({ approved: true }), [rule()])).toEqual({ effect: 'ALLOW', matched: [] });
    const r = evaluatePolicies(ctx({ approved: true }), [rule(), rule({ effect: 'BLOCK' })]);
    expect(r.effect).toBe('BLOCK');
    expect(r.matched.map((m) => m.effect)).toEqual(['BLOCK']);
  });
});

describe('purity', () => {
  it('is deterministic and does not mutate inputs', () => {
    const rules = Object.freeze([rule({ priority: 2 }), rule({ priority: 1, effect: 'BLOCK' })]) as PolicyRuleInput[];
    const c = Object.freeze(ctx({ actors: Object.freeze([{ type: 'API_KEY', apiKeyId: 'k1' }]) as never })) as PolicyContext;
    const a = evaluatePolicies(c, rules);
    const b = evaluatePolicies(c, rules);
    expect(a).toEqual(b);
    expect(rules[0].priority).toBe(2);
  });
});
