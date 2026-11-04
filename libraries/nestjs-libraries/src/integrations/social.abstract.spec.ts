jest.mock('@postsider/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));

import {
  assertRefreshedAccessToken,
  BadBody,
  RefreshToken,
  SocialAbstract,
} from './social.abstract';

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

class T extends SocialAbstract {
  identifier = 't';
}

class TCustom extends T {
  handleErrors() {
    return { type: 'bad-body' as const, value: 'nope' };
  }
}

const net = (code: string) => Object.assign(new Error(code), { code });
const kindOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(BadBody);
    return (err as BadBody).details?.[0]?.['kind'];
  }
  throw new Error('did not reject');
};
const respond = (status: number, body = '{}') =>
  jest.fn().mockResolvedValue({ status, text: async () => body });

describe('SocialAbstract failure kinds', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('tags exhausted 429 retries as rate_limited', async () => {
    const f = respond(429);
    global.fetch = f as any;
    expect(await kindOf(new T().fetch('http://x', {}, 't'))).toBe('rate_limited');
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('tags exhausted 500 retries as provider_unavailable', async () => {
    const f = respond(500);
    global.fetch = f as any;
    expect(await kindOf(new T().fetch('http://x', {}, 't'))).toBe(
      'provider_unavailable'
    );
    expect(f).toHaveBeenCalledTimes(4);
  });

  it('tags a 502 as provider_unavailable without retrying', async () => {
    const f = respond(502);
    global.fetch = f as any;
    expect(await kindOf(new T().fetch('http://x', {}, 't'))).toBe(
      'provider_unavailable'
    );
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('leaves a 400 untagged', async () => {
    global.fetch = respond(400, '{"error":"bad"}') as any;
    expect(await kindOf(new T().fetch('http://x', {}, 't'))).toBeUndefined();
  });

  it('tags a connection refusal as pre_connection', async () => {
    const p = new T().runInConcurrent(() => {
      throw net('ECONNREFUSED');
    });
    expect(await kindOf(p)).toBe('pre_connection');
  });

  it('tags an unrecognised throw as unknown_outcome', async () => {
    const p = new T().runInConcurrent(() => {
      throw new Error('boom');
    });
    expect(await kindOf(p)).toBe('unknown_outcome');
  });

  it('preserves the kind of an inner BadBody', async () => {
    const p = new T().runInConcurrent(() => {
      throw new BadBody('x', '{}', '', 'm', 'rate_limited');
    });
    expect(await kindOf(p)).toBe('rate_limited');
  });

  it('leaves a definite platform rejection untagged', async () => {
    const p = new TCustom().runInConcurrent(() => {
      throw { message: 'rejected' };
    });
    expect(await kindOf(p)).toBeUndefined();
  });
});
