import { supportsComment, COMMENT_PROVIDERS } from './comment.capability';
describe('supportsComment', () => {
  it('true for a known capable provider', () => { expect(supportsComment('linkedin')).toBe(true); });
  it('false for unknown', () => { expect(supportsComment('does-not-exist')).toBe(false); });
  it('case-insensitive', () => { expect(supportsComment('LinkedIn')).toBe(true); });
  it('includes wrapcast (farcaster) and linkedin-page', () => {
    expect(COMMENT_PROVIDERS).toContain('wrapcast');
    expect(COMMENT_PROVIDERS).toContain('linkedin-page');
  });
});
