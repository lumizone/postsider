import { assertRefreshedAccessToken, RefreshToken } from './social.abstract';

describe('assertRefreshedAccessToken', () => {
  it('returns a present access token', () => {
    expect(assertRefreshedAccessToken('x', { access_token: 'abc' }, 200)).toBe(
      'abc'
    );
  });

  it('throws a permanent RefreshToken on invalid_grant', () => {
    expect(() =>
      assertRefreshedAccessToken(
        'linkedin',
        { error: 'invalid_grant', error_description: 'expired' },
        400
      )
    ).toThrow(RefreshToken);
  });

  it('throws a transient error (not RefreshToken) when there is no error code', () => {
    let thrown: unknown;
    try {
      assertRefreshedAccessToken('whop', {}, 503);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(RefreshToken);
    expect((thrown as Error).message).toContain('whop');
  });

  it('treats an empty access token as a failure', () => {
    expect(() =>
      assertRefreshedAccessToken('pinterest', { access_token: '' }, 200)
    ).toThrow(Error);
  });
});
