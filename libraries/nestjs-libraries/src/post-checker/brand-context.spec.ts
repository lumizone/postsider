import { formatBrandContext } from './brand-context';

describe('formatBrandContext', () => {
  it('formats configured brand guidance', () => {
    expect(formatBrandContext({
      voice: 'Clear and practical',
      audience: 'Developers',
      rules: 'Use examples',
      forbiddenWords: 'guaranteed',
    })).toContain('Brand voice: Clear and practical');
  });

  it('omits an empty context', () => {
    expect(formatBrandContext({})).toBe('');
  });
});
