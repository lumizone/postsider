import { redactUrl } from './redact-url';

const URL_ = 'https://hooks.slack.com/services/T000/B000/SECRETVALUE';

describe('redactUrl', () => {
  it('replaces the full url, host+path and path', () => {
    const text = `a ${URL_} b hooks.slack.com/services/T000/B000/SECRETVALUE c /services/T000/B000/SECRETVALUE d`;
    const out = redactUrl(text, URL_);
    expect(out).toBe('a [url] b [url] c [url] d');
    expect(out).not.toContain('SECRETVALUE');
  });

  it('replaces every occurrence', () => {
    expect(redactUrl(`${URL_} ${URL_}`, URL_)).toBe('[url] [url]');
  });

  it('leaves text without the url unchanged', () => {
    expect(redactUrl('HTTP 400', URL_)).toBe('HTTP 400');
  });

  it('handles an unparsable url and empty inputs', () => {
    expect(redactUrl('boom nope', 'nope')).toBe('boom [url]');
    expect(redactUrl('boom', '')).toBe('boom');
  });

  it('does not blank out text for a bare root path', () => {
    expect(redactUrl('a/b', 'https://example.com/')).toBe('a/b');
  });
});
