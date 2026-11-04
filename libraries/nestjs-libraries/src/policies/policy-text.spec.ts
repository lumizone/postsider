import {
  htmlToPolicyText,
  containsLink,
  containsAnyWord,
  POLICY_MAX_INPUT_CHARS,
  POLICY_MAX_TAGS,
  PolicyInputTooLargeError,
  deriveMediaTypeFromPath,
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
  it('survives deep nesting up to the tag limit', () => {
    expect(containsAnyWord(htmlToPolicyText('<b>'.repeat(5000) + 'free'), ['free'])).toBe(true);
    const t0 = Date.now();
    expect(containsAnyWord(htmlToPolicyText('<div>'.repeat(5000) + 'free'), ['free'])).toBe(true);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
  it('keeps document order and spacing with the iterative walk', () => {
    expect(htmlToPolicyText('<p>a<b>b</b></p><p>c</p>d')).toBe('ab c d');
  });
  it('accepts input exactly at the character cap and rejects cap + 1', () => {
    expect(() => htmlToPolicyText('a'.repeat(POLICY_MAX_INPUT_CHARS))).not.toThrow();
    let err: unknown;
    try {
      htmlToPolicyText('a'.repeat(POLICY_MAX_INPUT_CHARS + 1));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PolicyInputTooLargeError);
    expect((err as PolicyInputTooLargeError).code).toBe('policy_input_too_large');
    expect((err as PolicyInputTooLargeError).length).toBe(POLICY_MAX_INPUT_CHARS + 1);
    expect((err as Error).message).toContain('characters');
  });
  it('accepts exactly POLICY_MAX_TAGS "<" characters and rejects one more', () => {
    expect(() => htmlToPolicyText('<b>'.repeat(POLICY_MAX_TAGS))).not.toThrow();
    expect(() => htmlToPolicyText('<b>'.repeat(POLICY_MAX_TAGS + 1))).toThrow(PolicyInputTooLargeError);
    expect(() => htmlToPolicyText('<'.repeat(POLICY_MAX_TAGS + 1))).toThrow(/tags/);
  });
  it('handles a realistic input near the cap quickly', () => {
    const unit = '<p>' + 'Hello world, this is a normal paragraph of post text. '.repeat(3) + '</p>';
    const html = unit.repeat(Math.floor(POLICY_MAX_INPUT_CHARS / unit.length));
    const t0 = Date.now();
    htmlToPolicyText(html);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('parser stack exhaustion fails closed', () => {
  it('4999 nested <template> (within both caps) returns text or throws PolicyInputTooLargeError, never RangeError', () => {
    const html = '<template>'.repeat(POLICY_MAX_TAGS - 1) + 'free';
    let err: unknown;
    try {
      htmlToPolicyText(html);
    } catch (e) {
      err = e;
    }
    if (err !== undefined) {
      expect(err).toBeInstanceOf(PolicyInputTooLargeError);
      expect((err as PolicyInputTooLargeError).code).toBe('policy_input_too_large');
      expect((err as PolicyInputTooLargeError).length).toBe(html.length);
    }
  });
  it('converts a RangeError from the parser into PolicyInputTooLargeError and rethrows other errors', () => {
    jest.isolateModules(() => {
      jest.doMock('parse5', () => ({
        parseFragment: () => {
          throw new RangeError('Maximum call stack size exceeded');
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./policy-text') as typeof import('./policy-text');
      let err: unknown;
      try {
        mod.htmlToPolicyText('<template>x');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(mod.PolicyInputTooLargeError);
      expect((err as PolicyInputTooLargeError).code).toBe('policy_input_too_large');
      expect((err as PolicyInputTooLargeError).length).toBe('<template>x'.length);
      expect((err as Error).message).toContain(String(mod.POLICY_MAX_TAGS));
    });
    jest.isolateModules(() => {
      jest.doMock('parse5', () => ({
        parseFragment: () => {
          throw new TypeError('boom');
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./policy-text') as typeof import('./policy-text');
      expect(() => mod.htmlToPolicyText('x')).toThrow(TypeError);
    });
    jest.dontMock('parse5');
  });
});

describe('matching is linear on adversarial input at the size cap', () => {
  const N = POLICY_MAX_INPUT_CHARS;
  // 50 entries that occur everywhere in the inputs below but fail the word boundary
  // check, so every candidate position is visited, plus long near-miss literals.
  const words: string[] = [];
  for (const c of ['a', 'ą', 'á', '1', '-', '.']) for (const k of [1, 2, 3, 8, 40, 99]) words.push(c.repeat(k) + (k === 99 ? 'z' : ''));
  words.push('a a', 'ą ą', 'free money', 'casino', 'a.b', 'c++', 'bit.ly', 'x_', 'q́', 'ą-ą', 'a.com', 'www', 'http', 'łódź');
  const cases: Array<[string, string]> = [
    ['ą', 'ą'.repeat(N)],
    ['á (NFD input)', 'á'.repeat(N / 2)],
    ['á', 'á'.repeat(N)],
    ['a', 'a'.repeat(N)],
    ['.', '.'.repeat(N)],
    ['a.', 'a.'.repeat(N / 2)],
    ['-', '-'.repeat(N)],
    ['mixed punctuation', '.,;:!?()[]{}-_/@#'.repeat(Math.floor(N / 17))],
    ['combining marks', '́'.repeat(N)],
    ['ą-', 'ą-'.repeat(N / 2)],
    ['ą@', 'ą@'.repeat(N / 2)],
    ['_ą', '_ą'.repeat(N / 2)],
  ];
  it('uses exactly 50 words', () => expect(words).toHaveLength(50));
  it.each(cases)('%s: containsLink + containsAnyWord(50 words) < 1 s', (_name, text) => {
    const t0 = Date.now();
    expect(containsLink(text)).toBe(false);
    containsAnyWord(text, words);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('word and link semantics after the linear rewrite', () => {
  it('a mark after a word character still blocks a word start, a mark after a space does not', () => {
    expect(containsAnyWord('x́free', ['free'])).toBe(false);
    expect(containsAnyWord(' ́free', ['free'])).toBe(true);
  });
  it('finds a valid match after earlier candidates fail the boundary check', () => {
    expect(containsAnyWord('freedom free', ['free'])).toBe(true);
    expect(containsAnyWord('++c++', ['c++'])).toBe(true);
    expect(containsAnyWord('ąąą ą', ['ą'])).toBe(true);
    expect(containsAnyWord('😀free', ['free'])).toBe(true);
  });
  it('matches multi-word entries across any whitespace', () => {
    expect(containsAnyWord('free\n\t money', ['free   money'])).toBe(true);
    expect(containsAnyWord('freemoney', ['free money'])).toBe(false);
  });
  it('detects bare domains after non-ASCII text and punctuation but not inside words or emails', () => {
    expect(containsLink('zobacz ąexample.com')).toBe(true);
    expect(containsLink('(example.com)')).toBe(true);
    expect(containsLink('ą example.pl')).toBe(true);
    expect(containsLink('kontakt ą@example.com')).toBe(false);
    expect(containsLink('ąąą'.repeat(1000) + ' bit.ly/x')).toBe(true);
  });
});

describe('deriveMediaTypeFromPath', () => {
  it('maps extensions to media types and defaults to image', () => {
    expect(deriveMediaTypeFromPath('a/b.MP4')).toBe('video');
    expect(deriveMediaTypeFromPath('https://c/x.mov?sig=1')).toBe('video');
    expect(deriveMediaTypeFromPath('s.mp3')).toBe('audio');
    expect(deriveMediaTypeFromPath('p.png')).toBe('image');
    expect(deriveMediaTypeFromPath('noext')).toBe('image');
    expect(deriveMediaTypeFromPath('')).toBe('image');
  });
});
