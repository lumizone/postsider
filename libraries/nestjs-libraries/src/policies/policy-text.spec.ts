import {
  htmlToPolicyText,
  containsLink,
  containsAnyWord,
  POLICY_MAX_INPUT_CHARS,
  PolicyInputTooLargeError,
} from './policy-text';

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
  it('turns invalid code points into U+FFFD like a browser', () => {
    expect(htmlToPolicyText('a&#0;b &#1114112; &#xD800;')).toBe('a\uFFFDb \uFFFD \uFFFD');
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

describe('parser-based html handling', () => {
  const has = (html: string, w: string) => containsAnyWord(htmlToPolicyText(html), [w]);
  it('is not fooled by > inside attributes or comments', () => {
    expect(has('fr<span title=">">ee</span>', 'free')).toBe(true);
    expect(has('fr<!-- a > b -->ee', 'free')).toBe(true);
  });
  it('separates words at void and other block elements', () => {
    expect(has('free<hr>money', 'free')).toBe(true);
    expect(has('free<hr>money', 'money')).toBe(true);
    expect(has('free<hr>money', 'freemoney')).toBe(false);
    expect(has('free<dd>money</dd>', 'free')).toBe(true);
    expect(has('free<dd>money</dd>', 'money')).toBe(true);
  });
  it('treats custom elements as separators', () => {
    expect(has('fr<p-x>ee</p-x>', 'free')).toBe(false);
    expect(has('fr<p-x>ee</p-x>', 'fr')).toBe(true);
  });
  it('detects links in unquoted attributes and src', () => {
    expect(containsLink(htmlToPolicyText('<a href=https://evil.zz>click</a>'))).toBe(true);
    expect(containsLink(htmlToPolicyText('<img src="https://evil.zz/a.png">'))).toBe(true);
  });
  it('decodes legacy and named entities like a browser', () => {
    expect(containsLink(htmlToPolicyText('h&#116tps://evil.zz'))).toBe(true);
    expect(containsLink(htmlToPolicyText('https&colon;//evil.zz'))).toBe(true);
    expect(containsLink(htmlToPolicyText('example&period;com'))).toBe(true);
  });
  it('a leading combining mark does not block a match', () => {
    expect(containsAnyWord('ok ́free stuff', ['free'])).toBe(true);
  });
  it('still distinguishes cafe from cafe with accent', () => {
    expect(containsAnyWord('un café', ['cafe'])).toBe(false);
  });
});

describe('robustness', () => {
  it('survives very deep nesting', () => {
    expect(containsAnyWord(htmlToPolicyText('<b>'.repeat(10000) + 'free'), ['free'])).toBe(true);
    expect(containsAnyWord(htmlToPolicyText('<div>'.repeat(10000) + 'free'), ['free'])).toBe(true);
  });
  it('keeps document order and spacing with the iterative walk', () => {
    expect(htmlToPolicyText('<p>a<b>b</b></p><p>c</p>d')).toBe('ab c d');
  });
  it('accepts input exactly at the cap and rejects cap + 1', () => {
    expect(() => htmlToPolicyText('a'.repeat(POLICY_MAX_INPUT_CHARS))).not.toThrow();
    let err: unknown;
    try {
      htmlToPolicyText('a'.repeat(POLICY_MAX_INPUT_CHARS + 1));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PolicyInputTooLargeError);
    expect((err as PolicyInputTooLargeError).code).toBe('policy_input_too_large');
  });
  it('handles a 1 MB realistic input quickly', () => {
    const html = '<p>Hello <b>world</b> <a href="https://x.com/a">link</a></p>'.repeat(
      Math.floor(POLICY_MAX_INPUT_CHARS / 60)
    );
    const t0 = Date.now();
    htmlToPolicyText(html);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
