import { CsrfMiddleware } from '@postsider/backend/services/auth/csrf.middleware';

function run(
  req: any,
  env: Record<string, string | undefined> = {}
): 'next' | 'blocked' {
  const prev = { ...process.env };
  // Hermetic: start from a clean slate for the vars this middleware reads.
  delete process.env.NOT_SECURED;
  delete process.env.MAIN_URL;
  Object.assign(process.env, { FRONTEND_URL: 'https://app.example.com' }, env);
  const mw = new CsrfMiddleware();
  let called = false;
  try {
    mw.use(req, {} as any, () => {
      called = true;
    });
    return called ? 'next' : 'blocked';
  } catch {
    return 'blocked';
  } finally {
    process.env = prev;
  }
}

describe('CsrfMiddleware', () => {
  it('allows safe methods regardless of origin', () => {
    expect(run({ method: 'GET', headers: {}, cookies: { auth: 'x' } })).toBe(
      'next'
    );
  });

  it('allows cookie POST from an allowed origin', () => {
    expect(
      run({
        method: 'POST',
        headers: { origin: 'https://app.example.com' },
        cookies: { auth: 'x' },
      })
    ).toBe('next');
  });

  it('blocks cookie POST from a foreign origin', () => {
    expect(
      run({
        method: 'POST',
        headers: { origin: 'https://evil.example.com' },
        cookies: { auth: 'x' },
      })
    ).toBe('blocked');
  });

  it('blocks cookie POST with no origin/referer', () => {
    expect(
      run({ method: 'POST', headers: {}, cookies: { auth: 'x' } })
    ).toBe('blocked');
  });

  it('allows header-token POST (not CSRF-able) even cross-origin', () => {
    expect(
      run({
        method: 'POST',
        headers: { origin: 'https://evil.example.com', auth: 'jwt' },
        cookies: {},
      })
    ).toBe('next');
  });

  it('allows bearer/agent-token POST cross-origin', () => {
    expect(
      run({
        method: 'POST',
        headers: { origin: 'https://evil.example.com', authorization: 'agt_x' },
        cookies: {},
      })
    ).toBe('next');
  });

  it('skips enforcement in NOT_SECURED mode', () => {
    expect(
      run(
        {
          method: 'POST',
          headers: { origin: 'https://evil.example.com' },
          cookies: { auth: 'x' },
        },
        { NOT_SECURED: 'true' }
      )
    ).toBe('next');
  });

  it('accepts a Referer when Origin is absent', () => {
    expect(
      run({
        method: 'POST',
        headers: { referer: 'https://app.example.com/calendar' },
        cookies: { auth: 'x' },
      })
    ).toBe('next');
  });

  it('passes through when there is no cookie auth to protect', () => {
    expect(run({ method: 'POST', headers: {}, cookies: {} })).toBe('next');
  });
});
