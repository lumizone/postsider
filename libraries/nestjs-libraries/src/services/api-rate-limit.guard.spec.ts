const incr = jest.fn();
jest.mock('@postsider/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { incr: (...a: any[]) => incr(...a), expire: jest.fn(), ttl: jest.fn() },
}));

import { ApiRateLimitGuard } from './api-rate-limit.guard';

const ctx = (url: string, org: any = { id: 'o1' }) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: url, url, org }),
      getResponse: () => ({ setHeader: jest.fn() }),
    }),
  }) as any;

describe('ApiRateLimitGuard', () => {
  beforeEach(() => incr.mockReset());

  it('does not count dashboard requests against the public API bucket', async () => {
    const guard = new ApiRateLimitGuard();
    await expect(guard.canActivate(ctx('/user/self'))).resolves.toBe(true);
    await expect(guard.canActivate(ctx('/notifications?x=1'))).resolves.toBe(true);
    expect(incr).not.toHaveBeenCalled();
  });

  it('counts /public/ requests and rejects over the limit', async () => {
    const guard = new ApiRateLimitGuard();
    incr.mockResolvedValue(1);
    await expect(guard.canActivate(ctx('/public/v1/posts'))).resolves.toBe(true);
    expect(incr).toHaveBeenCalledWith('rate:public:o1');
    incr.mockResolvedValue(10_000);
    await expect(guard.canActivate(ctx('/public/v1/posts'))).rejects.toMatchObject({ status: 429 });
  });
});
