import {
  isPolicyInputTooLarge,
  parsePolicyBlocked,
  summarizeCreateResult,
  summarizeDateResult,
} from './policy-errors';

const blocked = (names: unknown[]) => ({
  error: 'policy_blocked',
  msg: 'x',
  policy: { effect: 'BLOCK', matched: names.map((name) => ({ name })) },
});

describe('parsePolicyBlocked', () => {
  it('reads the rule names from the Phase 3 body', () => {
    expect(parsePolicyBlocked(blocked(['No banned words', 'Quiet hours']))).toEqual({
      ruleNames: ['No banned words', 'Quiet hours'],
    });
  });

  it('dedupes names', () => {
    expect(parsePolicyBlocked(blocked(['A', 'A', 'B', 'A']))).toEqual({ ruleNames: ['A', 'B'] });
  });

  it('keeps at most 5 names', () => {
    const r = parsePolicyBlocked(blocked(['1', '2', '3', '4', '5', '6', '7']));
    expect(r?.ruleNames).toEqual(['1', '2', '3', '4', '5']);
  });

  it('cuts a long name to 80 characters', () => {
    const r = parsePolicyBlocked(blocked(['x'.repeat(200)]));
    expect(r?.ruleNames[0]).toHaveLength(80);
  });

  it('does not split an emoji when cutting', () => {
    const r = parsePolicyBlocked(blocked(['\u{1F600}'.repeat(100)]));
    expect(Array.from(r?.ruleNames[0] ?? '')).toHaveLength(80);
    expect(r?.ruleNames[0]).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it('skips blank and non-string names but still reports a block', () => {
    expect(parsePolicyBlocked(blocked(['  ', 7, null, 'Ok']))).toEqual({ ruleNames: ['Ok'] });
    expect(parsePolicyBlocked({ error: 'policy_blocked' })).toEqual({ ruleNames: [] });
  });

  it('returns null for anything else', () => {
    expect(parsePolicyBlocked({ error: 'other' })).toBeNull();
    expect(parsePolicyBlocked(null)).toBeNull();
    expect(parsePolicyBlocked(undefined)).toBeNull();
    expect(parsePolicyBlocked('policy_blocked')).toBeNull();
    expect(parsePolicyBlocked([])).toBeNull();
  });
});

describe('isPolicyInputTooLarge', () => {
  it('matches only the 400 error code', () => {
    expect(isPolicyInputTooLarge({ error: 'policy_input_too_large' })).toBe(true);
    expect(isPolicyInputTooLarge({ error: 'policy_blocked' })).toBe(false);
    expect(isPolicyInputTooLarge(null)).toBe(false);
    expect(isPolicyInputTooLarge('policy_input_too_large')).toBe(false);
  });
});

describe('summarizeCreateResult', () => {
  it('is true when any element asked for approval', () => {
    expect(summarizeCreateResult([{ postId: 'p', approvalRequested: true }])).toEqual({
      approvalRequested: true,
      blocked: false,
    });
    expect(
      summarizeCreateResult([{ postId: 'a' }, { postId: 'b', approvalRequested: true }]).approvalRequested,
    ).toBe(true);
  });

  it('is false for empty, plain, truthy-but-not-true and non-array values', () => {
    expect(summarizeCreateResult([]).approvalRequested).toBe(false);
    expect(summarizeCreateResult([{ postId: 'a' }, null, 4]).approvalRequested).toBe(false);
    expect(summarizeCreateResult([{ approvalRequested: 'true' }]).approvalRequested).toBe(false);
    expect(summarizeCreateResult({ approvalRequested: true }).approvalRequested).toBe(false);
    expect(summarizeCreateResult(undefined).approvalRequested).toBe(false);
  });
});

describe('summarizeDateResult', () => {
  it('reads approvalRequested', () => {
    expect(summarizeDateResult({ approvalRequested: true })).toEqual({ approvalRequested: true });
    expect(summarizeDateResult(undefined)).toEqual({ approvalRequested: false });
    expect(summarizeDateResult({})).toEqual({ approvalRequested: false });
    expect(summarizeDateResult('x')).toEqual({ approvalRequested: false });
  });

  it('treats a REQUIRE_APPROVAL policy outcome as not applied even when approvalRequested is false', () => {
    const res = { approvalRequested: false, policy: { effect: 'REQUIRE_APPROVAL' } };
    expect(summarizeDateResult(res)).toEqual({ approvalRequested: true });
    expect(summarizeDateResult({ policy: { effect: 'ALLOW' } })).toEqual({ approvalRequested: false });
    expect(summarizeDateResult({ policy: 'REQUIRE_APPROVAL' })).toEqual({ approvalRequested: false });
  });
});
