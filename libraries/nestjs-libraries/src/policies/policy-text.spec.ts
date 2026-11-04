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

describe('htmlToPolicyText hardening', () => {
  it('removes inline tags without inserting a space', () => {
    expect(htmlToPolicyText('<p>fr<b>ee</b> money</p>')).toBe('free money');
    expect(containsAnyWord(htmlToPolicyText('fr<b>ee</b>'), ['free'])).toBe(true);
  });
  it('splits words at block tags and br', () => {
    expect(htmlToPolicyText('<p>free</p><p>money</p>')).toBe('free money');
    expect(htmlToPolicyText('free<br/>money')).toBe('free money');
    expect(htmlToPolicyText('<li>a</li><li>b</li>')).toBe('a b');
  });
  it('decodes numeric entities', () => {
    expect(containsLink(htmlToPolicyText('h&#116;tps://x.com'))).toBe(true);
    expect(containsLink(htmlToPolicyText('h&#x74;tps://x.com'))).toBe(true);
    expect(containsAnyWord(htmlToPolicyText('fr&#101;e'), ['free'])).toBe(true);
  });
  it('leaves invalid code points as-is', () => {
    expect(htmlToPolicyText('a&#0;b &#1114112; &#xD800;')).toBe('a&#0;b &#1114112; &#xD800;');
  });
  it('does not turn an entity into a tag that is then stripped', () => {
    expect(htmlToPolicyText('&lt;b&gt;x')).toBe('<b>x');
  });
});

describe('unicode normalization', () => {
  it('matches NFD text against NFC words and vice versa', () => {
    expect(containsAnyWord('caf\u0065\u0301 open', ['caf\u00e9'])).toBe(true);
    expect(containsAnyWord('caf\u00e9 open', ['caf\u0065\u0301'])).toBe(true);
  });
  it('does not match cafe inside cafe with accent', () => {
    expect(containsAnyWord('un caf\u00e9', ['cafe'])).toBe(false);
    expect(containsAnyWord('un caf\u0065\u0301', ['cafe'])).toBe(false);
  });
});
