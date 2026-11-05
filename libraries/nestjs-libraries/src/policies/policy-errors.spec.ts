import { HttpException } from '@nestjs/common';
import { PolicyBlockedException, policyInputTooLarge, sanitizePolicyName } from './policy-errors';

const outcome = (names: string[]) => ({
  effect: 'BLOCK' as const,
  matched: names.map((name, i) => ({
    ruleId: `r${i}`,
    name,
    effect: 'BLOCK' as const,
    condition: 'CONTAINS_LINK' as const,
  })),
  channels: [
    { integrationId: 'a', effect: 'BLOCK' as const, matched: [] },
    { integrationId: 'b', effect: 'ALLOW' as const, matched: [] },
  ],
});

describe('PolicyBlockedException', () => {
  it('names a rule whose name sanitizes to empty', () => {
    const err = new PolicyBlockedException(outcome(['\u2014\u2014', 'Real']));
    expect((err.getResponse() as any).msg).toBe(
      'This post was blocked by a policy: unnamed rule, Real.'
    );
  });

  it('is a plain 422 HttpException with the documented body', () => {
    const err = new PolicyBlockedException(outcome(['No links']));
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(422);
    expect(err.getResponse()).toEqual({
      error: 'policy_blocked',
      msg: 'This post was blocked by a policy: No links.',
      policy: {
        effect: 'BLOCK',
        matched: [{ ruleId: 'r0', name: 'No links', effect: 'BLOCK', condition: 'CONTAINS_LINK' }],
        channels: ['a'],
      },
    });
  });

  it('sanitizes names in the message: no dashes, no control characters, bounded', () => {
    const err = new PolicyBlockedException(outcome(['A\u2014B\u2013C\nD\u0000E', 'x'.repeat(500)]));
    const msg = (err.getResponse() as any).msg as string;
    expect(msg).not.toMatch(/[\u2014\u2013]/);
    expect(msg).not.toMatch(/[\u0000-\u001f]/);
    expect(msg.length).toBeLessThan(400);
  });

  it('sanitizes names inside policy.matched too', () => {
    const body: any = new PolicyBlockedException(outcome(['A\u2014B\u202e'])).getResponse();
    expect(body.policy.matched[0].name).toBe('A B');
  });

  it('lists at most five names', () => {
    const names = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'];
    const msg = (new PolicyBlockedException(outcome(names)).getResponse() as any).msg as string;
    expect(msg).toContain('n5');
    expect(msg).not.toContain('n6');
  });
});

describe('sanitizePolicyName', () => {
  it.each(['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212', '\ufe58', '\ufe63', '\uff0d'])(
    'removes dash %j',
    (d) => {
      expect(sanitizePolicyName(`a${d}b`)).toBe('a b');
    }
  );

  it.each(['\u0085', '\u009f', '\u202a', '\u202e', '\u2066', '\u2069', '\u200b', '\ufeff', '\u2028'])(
    'removes control or bidi character %j',
    (c) => {
      expect(sanitizePolicyName(`a${c}b`)).toBe('a b');
    }
  );

  it('replaces dashes and collapses whitespace', () => {
    expect(sanitizePolicyName('  a \u2014  b  ')).toBe('a b');
  });
});

describe('policyInputTooLarge', () => {
  it('is a 400 with the stable code', () => {
    const err = policyInputTooLarge();
    expect(err.getStatus()).toBe(400);
    expect((err.getResponse() as any).error).toBe('policy_input_too_large');
    expect((err.getResponse() as any).msg).not.toMatch(/[\u2014\u2013]/);
  });
});
