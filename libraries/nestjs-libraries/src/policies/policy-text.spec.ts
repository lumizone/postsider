import { htmlToPolicyText, containsLink, containsAnyWord } from './policy-text';

describe('htmlToPolicyText', () => {
  it('strips tags, decodes entities, collapses whitespace', () => {
    expect(htmlToPolicyText('<p>Hello&nbsp;<b>world</b> &amp; co</p>')).toBe('Hello world & co');
  });
  it('keeps anchor hrefs as text', () => {
    expect(htmlToPolicyText('<a href="https://x.com/a">click</a>')).toContain('https://x.com/a');
  });
});

describe('containsLink', () => {
  it.each(['see https://x.com', 'www.example.com/a', 'bit.ly/abc', 'go to example.co now', 'HTTP://UPPER.COM'])(
    'detects %s',
    (t) => expect(containsLink(t)).toBe(true)
  );
  it.each(['Node.js is fine', 'version v2.0 e.g. this', 'mail me at a@b.com', 'Hello. World.', ''])(
    'ignores %p',
    (t) => expect(containsLink(t)).toBe(false)
  );
});

describe('containsAnyWord', () => {
  it('matches whole words only', () => {
    expect(containsAnyWord('Great CLASSIC car', ['class'])).toBe(false);
    expect(containsAnyWord('a class act', ['Class'])).toBe(true);
    expect(containsAnyWord('x_free', ['free'])).toBe(false);
    expect(containsAnyWord('co-op', ['co'])).toBe(true);
  });
  it('handles unicode letters', () => {
    expect(containsAnyWord('Mamy ŁÓDŹ dzis', ['łódź'])).toBe(true);
  });
  it('matches multi-word entries across whitespace runs', () => {
    expect(containsAnyWord('free  money now', ['free money'])).toBe(true);
  });
  it('treats regex metacharacters literally', () => {
    expect(containsAnyWord('I like c++ a lot', ['c++'])).toBe(true);
    expect(containsAnyWord('see a.b here', ['a.b'])).toBe(true);
    expect(containsAnyWord('see aXb here', ['a.b'])).toBe(false);
  });
});
