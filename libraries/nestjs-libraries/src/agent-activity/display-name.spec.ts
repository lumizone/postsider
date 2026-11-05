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
});
