const counters = new Map<string, number>();
const incr = jest.fn(async (k: string) => {
  counters.set(k, (counters.get(k) ?? 0) + 1);
  return counters.get(k)!;
});
const expire = jest.fn(async () => 1);
jest.mock('@postsider/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { incr: (k: string) => incr(k), expire: () => expire() },
}));

import { assertOAuthRate, oauthLimits } from './oauth.rate-limit';
import { OAuthController } from './oauth.controller';

describe('assertOAuthRate', () => {
  beforeEach(() => {
    counters.clear();
    jest.clearAllMocks();
    delete process.env.MCP_OAUTH_AUTHORIZE_RPM;
  });

  it('allows up to the limit then answers 429, per client and bucket', async () => {
    for (let i = 0; i < 3; i++) await assertOAuthRate('authorize', 'c1', 3);
    await expect(assertOAuthRate('authorize', 'c1', 3)).rejects.toMatchObject({ status: 429 });
    // A different client and a different bucket are unaffected.
    await expect(assertOAuthRate('authorize', 'c2', 3)).resolves.toBeUndefined();
    await expect(assertOAuthRate('token', 'c1', 3)).resolves.toBeUndefined();
  });

  it('starts the one-minute window on the first hit only', async () => {
    await assertOAuthRate('token', 'c1', 5);
    await assertOAuthRate('token', 'c1', 5);
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it('fails open when Redis is down', async () => {
    incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(assertOAuthRate('token', 'c1', 1)).resolves.toBeUndefined();
  });

  it('takes the limits from the environment', () => {
    process.env.MCP_OAUTH_AUTHORIZE_RPM = '7';
    expect(oauthLimits().authorize).toBe(7);
    process.env.MCP_OAUTH_AUTHORIZE_RPM = 'junk';
    expect(oauthLimits().authorize).toBe(300);
  });
});

describe('OAuth endpoints use the limiter', () => {
  beforeEach(() => {
    counters.clear();
    process.env.MCP_OAUTH_TOKEN_RPM = '2';
  });
  afterAll(() => {
    delete process.env.MCP_OAUTH_TOKEN_RPM;
  });

  const controller = (client: unknown) => {
    const mcp = {
      getClient: jest.fn().mockResolvedValue(client),
      refresh: jest.fn().mockResolvedValue({ access_token: 'x' }),
    };
    return { c: new OAuthController({} as any, mcp as any), mcp };
  };

  it('throttles /oauth/token for a registered client but not for unknown ones', async () => {
    const { c, mcp } = controller({ id: 'row-1' });
    const body = { grant_type: 'refresh_token', client_id: 'pmc_1', refresh_token: 'r' } as any;
    await c.token(body);
    await c.token(body);
    await expect(c.token(body)).rejects.toMatchObject({ status: 429 });
    expect(mcp.refresh).toHaveBeenCalledTimes(2);

    const unknown = controller(null);
    // No registered client: nothing to key a counter on, so no Redis key is created.
    await expect(unknown.c.token({ grant_type: 'nope', client_id: 'x' } as any)).rejects.toMatchObject({ status: 400 });
    expect(incr).not.toHaveBeenCalledWith(expect.stringContaining(':x'));
  });
});
