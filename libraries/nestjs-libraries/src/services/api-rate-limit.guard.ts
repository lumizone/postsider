import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { Request } from 'express';

/**
 * Per-organization rate limiter for the Public API.
 * Uses a sliding window counter stored in Redis.
 *
 * Default: 60 requests per minute (configurable via API_RATE_LIMIT env var).
 * OSS has no rate limiting at all — this is a PostSider-exclusive improvement.
 */
@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  private readonly limit = parseInt(process.env.API_LIMIT || '60', 10);
  private readonly windowSec = 60;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    // @ts-ignore
    const orgId = req.org?.id;
    if (!orgId) return true; // No org resolved yet — let auth middleware handle it

    const key = `rate:public:${orgId}`;
    const current = await ioRedis.incr(key);
    if (current === 1) {
      await ioRedis.expire(key, this.windowSec);
    }

    const res = context.switchToHttp().getResponse();
    res.setHeader('X-RateLimit-Limit', String(this.limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, this.limit - current)));

    if (current > this.limit) {
      const ttl = await ioRedis.ttl(key);
      res.setHeader('Retry-After', String(ttl > 0 ? ttl : this.windowSec));
      throw new HttpException(
        { msg: 'Rate limit exceeded. Try again later.', retryAfter: ttl },
        429,
      );
    }

    return true;
  }
}
