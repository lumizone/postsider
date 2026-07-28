import { appendUtmParams, UtmPresetInput } from './utm-utils';

const preset: UtmPresetInput = {
  utmSource: 'newsletter',
  utmMedium: 'social',
  utmCampaign: 'launch 2026',
};

describe('appendUtmParams', () => {
  it('appends params with ? when the URL has no query string', () => {
    const out = appendUtmParams('see https://postsider.com here', preset);
    expect(out).toContain(
      'https://postsider.com?utm_source=newsletter&utm_medium=social&utm_campaign=launch%202026'
    );
  });

  it('appends params with & when the URL already has a query string', () => {
    const out = appendUtmParams('https://x.com/page?ref=a', preset);
    expect(out).toContain('?ref=a&utm_source=newsletter');
  });

  it('leaves a URL that already has utm_source untouched', () => {
    const body = 'https://postsider.com?utm_source=existing';
    expect(appendUtmParams(body, preset)).toBe(body);
  });

  it('tags every URL in the body', () => {
    const out = appendUtmParams('a https://one.com b https://two.com', preset);
    expect(out).toContain('https://one.com?utm_source=newsletter');
    expect(out).toContain('https://two.com?utm_source=newsletter');
  });

  it('leaves text without URLs unchanged', () => {
    const body = 'no links here at all';
    expect(appendUtmParams(body, preset)).toBe(body);
  });

  it('returns empty body unchanged', () => {
    expect(appendUtmParams('', preset)).toBe('');
  });

  it('includes optional content/term only when present', () => {
    const out = appendUtmParams('https://postsider.com', {
      ...preset,
      utmContent: 'cta',
      utmTerm: 'kw',
    });
    expect(out).toContain('utm_content=cta');
    expect(out).toContain('utm_term=kw');
  });

  it('keeps trailing sentence punctuation outside the params', () => {
    const out = appendUtmParams('go to https://postsider.com.', preset);
    expect(out.endsWith('launch%202026.')).toBe(true);
    expect(out).not.toContain('com.?');
  });

  it('keeps a balanced trailing ) that is part of the URL path', () => {
    const out = appendUtmParams(
      'see https://en.wikipedia.org/wiki/Foo_(bar) here',
      preset
    );
    expect(out).toContain(
      'https://en.wikipedia.org/wiki/Foo_(bar)?utm_source=newsletter'
    );
  });

  it('treats an unbalanced trailing ) as sentence punctuation', () => {
    const out = appendUtmParams('(see https://x.com)', preset);
    expect(out).toContain('https://x.com?utm_source=newsletter');
    expect(out).not.toContain('com)?');
    expect(out.endsWith(')')).toBe(true);
  });
});
