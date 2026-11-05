import { parseCalendarDeepLink, stripCalendarDeepLink } from './calendar-deep-link';

describe('parseCalendarDeepLink', () => {
  it('reads post and date', () => {
    expect(parseCalendarDeepLink('?post=abc_12&date=2026-11-04')).toEqual({
      postId: 'abc_12',
      date: '2026-11-04',
    });
  });

  it('works without a leading question mark', () => {
    expect(parseCalendarDeepLink('post=abc-1')).toEqual({ postId: 'abc-1' });
  });

  it('omits a post id with path characters', () => {
    expect(parseCalendarDeepLink('?post=../x')).toEqual({});
  });

  it('omits an impossible calendar date', () => {
    expect(parseCalendarDeepLink('?date=2026-02-30')).toEqual({});
  });

  it('omits a date that is not zero padded', () => {
    expect(parseCalendarDeepLink('?date=2026-11-4')).toEqual({});
  });

  it('omits a post id longer than 64 characters', () => {
    expect(parseCalendarDeepLink('?post=' + 'a'.repeat(65))).toEqual({});
    expect(parseCalendarDeepLink('?post=' + 'a'.repeat(64))).toEqual({ postId: 'a'.repeat(64) });
  });

  it('accepts a leap day only in a leap year', () => {
    expect(parseCalendarDeepLink('?date=2028-02-29')).toEqual({ date: '2028-02-29' });
    expect(parseCalendarDeepLink('?date=2027-02-29')).toEqual({});
  });

  it('returns nothing for an empty query', () => {
    expect(parseCalendarDeepLink('')).toEqual({});
    expect(parseCalendarDeepLink('?')).toEqual({});
  });
});

describe('stripCalendarDeepLink', () => {
  it('removes post and date and keeps the rest', () => {
    expect(stripCalendarDeepLink('connect=1&post=abc&date=2026-11-04')).toBe('connect=1');
  });

  it('accepts a leading question mark and returns no leading question mark', () => {
    expect(stripCalendarDeepLink('?post=abc&x=1')).toBe('x=1');
  });

  it('returns an empty string for an empty or fully stripped query', () => {
    expect(stripCalendarDeepLink('')).toBe('');
    expect(stripCalendarDeepLink('post=a&date=2026-11-04')).toBe('');
  });
});
