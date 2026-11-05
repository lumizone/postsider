import {
  POLICY_LIMITS,
  emptyForm,
  formFromRule,
  ruleSummary,
  toInput,
  validateForm,
  type PolicyFormState,
} from './policies-model';
import type { PolicyRule } from './policies-api';

const okZone = () => true;
const badZone = () => false;

function form(over: Partial<PolicyFormState> = {}): PolicyFormState {
  return { ...emptyForm(), name: 'Rule', ...over };
}

function windowForm(over: Partial<PolicyFormState> = {}): PolicyFormState {
  return form({
    condition: 'OUTSIDE_WINDOW',
    windowDays: [1, 2, 3],
    windowStart: '09:00',
    windowEnd: '17:00',
    timezone: 'Europe/Warsaw',
    ...over,
  });
}

function rule(over: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'r1',
    name: 'Raw name',
    displayName: 'Raw name',
    enabled: true,
    priority: 50,
    appliesToActorTypes: [],
    appliesToApiKeyIds: [],
    appliesToIntegrationIds: [],
    appliesToProviders: [],
    condition: 'CONTAINS_LINK',
    conditionParams: {},
    effect: 'REQUIRE_APPROVAL',
    ...over,
  };
}

describe('emptyForm', () => {
  it('has the documented defaults', () => {
    const f = emptyForm();
    expect(f.priority).toBe('100');
    expect(f.enabled).toBe(true);
    expect(f.effect).toBe('REQUIRE_APPROVAL');
    expect(f.condition).toBe('CONTAINS_LINK');
  });
});

describe('validateForm', () => {
  it('returns {} for a valid form', () => {
    expect(validateForm(form(), okZone)).toEqual({});
  });

  it('flags empty and too long names', () => {
    expect(validateForm(form({ name: '   ' }), okZone).name).toBe('nameRequired');
    expect(validateForm(form({ name: 'a'.repeat(120) }), okZone).name).toBeUndefined();
    expect(validateForm(form({ name: 'a'.repeat(121) }), okZone).name).toBe('nameTooLong');
  });

  it.each(['-1', '1001', '10.5', '', 'abc'])('flags priority %p', (p) => {
    expect(validateForm(form({ priority: p }), okZone).priority).toBe('priorityInvalid');
  });

  it.each(['0', '1000', '100'])('accepts priority %p', (p) => {
    expect(validateForm(form({ priority: p }), okZone).priority).toBeUndefined();
  });

  describe('CONTAINS_WORDS', () => {
    const w = (words: string) => validateForm(form({ condition: 'CONTAINS_WORDS', words }), okZone);

    it('needs at least one word', () => {
      expect(w('').words).toBe('wordsRequired');
      expect(w(' \n , ').words).toBe('wordsRequired');
    });
    it('caps the count at 100', () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join('\n');
      expect(w(many(100)).words).toBeUndefined();
      expect(w(many(101)).words).toBe('wordsTooMany');
    });
    it('caps a word at 100 characters', () => {
      expect(w('a'.repeat(100)).words).toBeUndefined();
      expect(w('a'.repeat(101)).words).toBe('wordTooLong');
    });
    it('flags case-insensitive duplicates', () => {
      expect(w('Foo\nfoo').words).toBe('wordsDuplicate');
    });
    it('accepts a valid list', () => {
      expect(w('alpha, beta\ngamma')).toEqual({});
    });
  });

  describe('OUTSIDE_WINDOW', () => {
    it('accepts a valid overnight window', () => {
      expect(validateForm(windowForm({ windowStart: '22:00', windowEnd: '06:00' }), okZone)).toEqual({});
    });
    it('needs at least one day', () => {
      expect(validateForm(windowForm({ windowDays: [] }), okZone).windowDays).toBe('daysRequired');
    });
    it('rejects start equal to end', () => {
      expect(validateForm(windowForm({ windowStart: '09:00', windowEnd: '09:00' }), okZone).windowEnd).toBe(
        'windowSame'
      );
    });
    it('rejects malformed times', () => {
      const e = validateForm(windowForm({ windowStart: '25:00', windowEnd: '9:5' }), okZone);
      expect(e.windowStart).toBe('timeInvalid');
      expect(e.windowEnd).toBe('timeInvalid');
    });
    it('rejects an invalid timezone through the injected validator', () => {
      expect(validateForm(windowForm(), badZone).timezone).toBe('timezoneInvalid');
      expect(validateForm(windowForm({ timezone: '  ' }), okZone).timezone).toBe('timezoneInvalid');
    });
    it('ignores window fields for other conditions', () => {
      expect(validateForm(form({ windowDays: [] }), badZone)).toEqual({});
    });
  });

  describe('DAILY_CAP_EXCEEDED', () => {
    const c = (capMax: string) => validateForm(form({ condition: 'DAILY_CAP_EXCEEDED', capMax }), okZone);
    it.each(['0', '10001', '', '1.5', 'x'])('flags %p', (v) => {
      expect(c(v).capMax).toBe('capInvalid');
    });
    it.each(['1', '10000', '25'])('accepts %p', (v) => {
      expect(c(v)).toEqual({});
    });
  });

  describe('filters', () => {
    it('flags more than 100 entries in any filter', () => {
      const ids = Array.from({ length: 101 }, (_, i) => `id${i}`);
      expect(validateForm(form({ appliesToApiKeyIds: ids }), okZone).filters).toBe('filtersTooMany');
      expect(validateForm(form({ appliesToIntegrationIds: ids }), okZone).filters).toBe('filtersTooMany');
      expect(validateForm(form({ appliesToProviders: ids.join(',') }), okZone).filters).toBe('filtersTooMany');
      expect(validateForm(form({ appliesToApiKeyIds: ids.slice(0, 100) }), okZone).filters).toBeUndefined();
    });
    it('flags an over long provider', () => {
      expect(validateForm(form({ appliesToProviders: 'a'.repeat(101) }), okZone).filters).toBe('filtersTooLong');
    });
  });

  it('exposes the server limits', () => {
    expect(POLICY_LIMITS).toEqual({
      nameMax: 120,
      priorityMin: 0,
      priorityMax: 1000,
      filterMax: 100,
      wordsMax: 100,
      wordMax: 100,
      capMin: 1,
      capMax: 10000,
    });
  });
});

describe('toInput', () => {
  it.each(['ALWAYS', 'CONTAINS_LINK', 'PUBLISH_NOW', 'HAS_VIDEO'] as const)('%s has empty params', (c) => {
    const f = form({ condition: c, words: 'leftover', capMax: '5', windowDays: [1] });
    expect(toInput(f).conditionParams).toEqual({});
  });

  it('trims, splits and dedupes words', () => {
    expect(toInput(form({ condition: 'CONTAINS_WORDS', words: ' a ,A\nb' })).conditionParams).toEqual({
      words: ['a', 'b'],
    });
  });

  it('builds window params with sorted unique days', () => {
    const input = toInput(windowForm({ windowDays: [3, 1, 3], timezone: ' Europe/Warsaw ' }));
    expect(input.conditionParams).toEqual({
      days: [1, 3],
      start: '09:00',
      end: '17:00',
      timezone: 'Europe/Warsaw',
    });
  });

  it('builds cap params', () => {
    expect(
      toInput(form({ condition: 'DAILY_CAP_EXCEEDED', capMax: ' 25 ', capScope: 'channel' })).conditionParams
    ).toEqual({ max: 25, scope: 'channel' });
  });

  it('splits providers on commas and lowercases', () => {
    expect(toInput(form({ appliesToProviders: 'X, LinkedIn,, x' })).appliesToProviders).toEqual([
      'x',
      'linkedin',
    ]);
  });

  it('trims the name and parses the priority', () => {
    const input = toInput(form({ name: '  Hello  ', priority: ' 7 ', enabled: false, effect: 'BLOCK' }));
    expect(input).toMatchObject({ name: 'Hello', priority: 7, enabled: false, effect: 'BLOCK' });
  });

  it('copies filter arrays', () => {
    const f = form({
      appliesToActorTypes: ['API_KEY'],
      appliesToApiKeyIds: ['k1'],
      appliesToIntegrationIds: ['i1'],
    });
    const input = toInput(f);
    expect(input.appliesToActorTypes).toEqual(['API_KEY']);
    expect(input.appliesToApiKeyIds).toEqual(['k1']);
    expect(input.appliesToIntegrationIds).toEqual(['i1']);
    expect(input.appliesToApiKeyIds).not.toBe(f.appliesToApiKeyIds);
  });
});

describe('formFromRule and round trip', () => {
  const rules: PolicyRule[] = [
    rule({ condition: 'ALWAYS', effect: 'BLOCK' }),
    rule({ condition: 'CONTAINS_LINK', appliesToActorTypes: ['API_KEY', 'OAUTH_CLIENT'] }),
    rule({ condition: 'CONTAINS_WORDS', conditionParams: { words: ['banned', 'spam'] }, effect: 'BLOCK' }),
    rule({
      condition: 'OUTSIDE_WINDOW',
      conditionParams: { days: [1, 2, 3, 4, 5], start: '22:00', end: '06:00', timezone: 'Europe/Warsaw' },
      appliesToIntegrationIds: ['i1', 'i2'],
    }),
    rule({
      condition: 'DAILY_CAP_EXCEEDED',
      conditionParams: { max: 10, scope: 'channel' },
      appliesToApiKeyIds: ['k1'],
      appliesToProviders: ['x', 'linkedin'],
    }),
    rule({ condition: 'PUBLISH_NOW', enabled: false, priority: 0 }),
    rule({ condition: 'HAS_VIDEO' }),
  ];

  it.each(rules.map((r) => [r.condition, r] as const))('round trips %s', (_c, r) => {
    expect(toInput(formFromRule(r))).toEqual({
      name: r.name,
      enabled: r.enabled,
      priority: r.priority,
      effect: r.effect,
      condition: r.condition,
      conditionParams: r.conditionParams,
      appliesToActorTypes: r.appliesToActorTypes,
      appliesToApiKeyIds: r.appliesToApiKeyIds,
      appliesToIntegrationIds: r.appliesToIntegrationIds,
      appliesToProviders: r.appliesToProviders,
    });
  });

  it('uses the raw name, not the display name', () => {
    expect(formFromRule(rule({ name: 'raw\u200B', displayName: 'raw' })).name).toBe('raw\u200B');
  });

  it('keeps a non UTC cap timezone instead of silently resetting it', () => {
    const r = rule({
      condition: 'DAILY_CAP_EXCEEDED',
      conditionParams: { max: 3, scope: 'organization', timezone: 'Europe/Warsaw' },
    });
    expect(toInput(formFromRule(r)).conditionParams).toEqual({
      max: 3,
      scope: 'organization',
      timezone: 'Europe/Warsaw',
    });
  });

  it('survives malformed stored params', () => {
    const f = formFromRule(rule({ condition: 'CONTAINS_WORDS', conditionParams: null }));
    expect(f.words).toBe('');
    const g = formFromRule(rule({ condition: 'OUTSIDE_WINDOW', conditionParams: { days: 'x' } }));
    expect(g.windowDays).toEqual([]);
  });
});

describe('ruleSummary', () => {
  it('returns keys only', () => {
    expect(ruleSummary(rule())).toEqual({ effect: 'REQUIRE_APPROVAL', condition: 'CONTAINS_LINK', filters: [] });
    expect(
      ruleSummary(
        rule({
          effect: 'BLOCK',
          condition: 'HAS_VIDEO',
          appliesToActorTypes: ['API_KEY'],
          appliesToApiKeyIds: ['k'],
          appliesToIntegrationIds: ['i'],
          appliesToProviders: ['x'],
        })
      )
    ).toEqual({
      effect: 'BLOCK',
      condition: 'HAS_VIDEO',
      filters: ['actorTypes', 'apiKeys', 'channels', 'providers'],
    });
  });
});

describe('approvalFlowId', () => {
  it('is left out when no flow is chosen (the default flow)', () => {
    expect('approvalFlowId' in toInput(form())).toBe(false);
  });

  it('is sent for a REQUIRE_APPROVAL rule that picks a flow', () => {
    expect(toInput(form({ approvalFlowId: 'f1' })).approvalFlowId).toBe('f1');
  });

  it('round trips a stored flow', () => {
    const r = rule({ approvalFlowId: 'f9' });
    expect(formFromRule(r).approvalFlowId).toBe('f9');
    expect(toInput(formFromRule(r)).approvalFlowId).toBe('f9');
  });

  it('sends null when the stored flow is cleared back to the default', () => {
    const f = { ...formFromRule(rule({ approvalFlowId: 'f9' })), approvalFlowId: '' };
    expect(toInput(f).approvalFlowId).toBeNull();
  });

  it('never sends a flow for a BLOCK rule', () => {
    expect('approvalFlowId' in toInput(form({ effect: 'BLOCK', approvalFlowId: 'f1' }))).toBe(false);
    const stored = { ...formFromRule(rule({ approvalFlowId: 'f9' })), effect: 'BLOCK' as const };
    expect('approvalFlowId' in toInput(stored)).toBe(false);
  });

  it('treats a null stored flow as none', () => {
    expect(formFromRule(rule({ approvalFlowId: null })).approvalFlowId).toBe('');
  });
});
