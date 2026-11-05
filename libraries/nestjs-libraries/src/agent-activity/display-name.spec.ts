import { cleanDisplayName } from './display-name';

describe('cleanDisplayName', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(cleanDisplayName('  Claude\u0000\n Desktop ')).toBe('Claude Desktop');
  });
  it('cuts to the max', () => {
    expect(cleanDisplayName('a'.repeat(120))).toHaveLength(80);
    expect(cleanDisplayName('abcdef', 3)).toBe('abc');
  });
  it('returns null when nothing is left', () => {
    expect(cleanDisplayName('\u0007\u0008')).toBeNull();
    expect(cleanDisplayName('   ')).toBeNull();
    expect(cleanDisplayName('')).toBeNull();
  });
  it('returns null for non strings', () => {
    expect(cleanDisplayName(5)).toBeNull();
    expect(cleanDisplayName(null)).toBeNull();
    expect(cleanDisplayName({})).toBeNull();
  });
  it('strips C1 controls', () => {
    expect(cleanDisplayName('a\u0085b\u009fc')).toBe('abc');
  });
  it('strips bidi and zero-width characters', () => {
    expect(cleanDisplayName('a\u202Eb\u202Ac\u2066d\u2069e')).toBe('abcde');
    expect(cleanDisplayName('x\u200B\u200C\u200D\u200E\u200Fy')).toBe('xy');
    expect(cleanDisplayName('p\u2060\u2061\u2064q\uFEFFr')).toBe('pqr');
    expect(cleanDisplayName('\u202E\u200B')).toBeNull();
  });
  it('cuts by code points and never splits an emoji', () => {
    const emoji = '\uD83D\uDE00';
    const out = cleanDisplayName(emoji.repeat(100)) as string;
    expect(Array.from(out)).toHaveLength(80);
    expect(out).toBe(emoji.repeat(80));
    expect(cleanDisplayName('ab' + emoji + 'cd', 3)).toBe('ab' + emoji);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
  });
});
