import { validateConditionParams, isValidTimezone } from './policy-params';

const win = { days: [1, 2], start: '09:00', end: '17:00', timezone: 'Europe/Warsaw' };
const failField = (c: any, p: any) => {
  const r = validateConditionParams(c, p);
  return r.ok ? null : r.field;
};

describe('validateConditionParams', () => {
  it('accepts empty params for parameterless conditions and rejects unknown keys', () => {
    expect(validateConditionParams('ALWAYS', {}).ok).toBe(true);
    expect(validateConditionParams('ALWAYS', { x: 1 })).toMatchObject({ ok: false, field: 'x' });
    expect(failField('HAS_VIDEO', { y: 1 })).toBe('y');
  });

  it('validates CONTAINS_WORDS', () => {
    expect(failField('CONTAINS_WORDS', { words: [] })).toBe('words');
    expect(failField('CONTAINS_WORDS', { words: Array.from({ length: 101 }, (_, i) => `w${i}`) })).toBe('words');
    expect(failField('CONTAINS_WORDS', { words: ['a'.repeat(101)] })).toBe('words');
    expect(failField('CONTAINS_WORDS', { words: [' Foo ', 'foo'] })).toBe('words');
    expect(failField('CONTAINS_WORDS', { words: ['  '] })).toBe('words');
    expect(failField('CONTAINS_WORDS', { words: ['a'], extra: 1 })).toBe('extra');
    const r = validateConditionParams('CONTAINS_WORDS', { words: [' Foo '] });
    expect(r).toEqual({ ok: true, value: { words: ['Foo'] } });
  });

  it('validates OUTSIDE_WINDOW', () => {
    expect(validateConditionParams('OUTSIDE_WINDOW', win).ok).toBe(true);
    expect(failField('OUTSIDE_WINDOW', { ...win, days: [7] })).toBe('days');
    expect(failField('OUTSIDE_WINDOW', { ...win, days: [] })).toBe('days');
    expect(failField('OUTSIDE_WINDOW', { ...win, days: [1, 1] })).toBe('days');
    expect(failField('OUTSIDE_WINDOW', { ...win, start: '9:00' })).toBe('start');
    expect(failField('OUTSIDE_WINDOW', { ...win, start: '24:00' })).toBe('start');
    expect(failField('OUTSIDE_WINDOW', { ...win, end: '09:00' })).toBe('end');
    expect(failField('OUTSIDE_WINDOW', { ...win, timezone: 'Mars/Base' })).toBe('timezone');
  });

  it('validates DAILY_CAP_EXCEEDED and defaults the timezone to UTC', () => {
    expect(validateConditionParams('DAILY_CAP_EXCEEDED', { max: 5, scope: 'organization' })).toEqual({
      ok: true,
      value: { max: 5, scope: 'organization', timezone: 'UTC' },
    });
    expect(failField('DAILY_CAP_EXCEEDED', { max: 0, scope: 'channel' })).toBe('max');
    expect(failField('DAILY_CAP_EXCEEDED', { max: 10001, scope: 'channel' })).toBe('max');
    expect(failField('DAILY_CAP_EXCEEDED', { max: 1.5, scope: 'channel' })).toBe('max');
    expect(failField('DAILY_CAP_EXCEEDED', { max: 5, scope: 'team' })).toBe('scope');
    expect(failField('DAILY_CAP_EXCEEDED', { max: 5, scope: 'channel', timezone: 'nope' })).toBe('timezone');
  });

  it('isValidTimezone', () => {
    expect(isValidTimezone('Europe/Warsaw')).toBe(true);
    expect(isValidTimezone('nope')).toBe(false);
  });
});
