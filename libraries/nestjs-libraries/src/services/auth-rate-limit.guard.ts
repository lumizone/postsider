import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { Request } from 'express';

/**
 * Rate limiter for auth endpoints (login, register, forgot password).
 * Prevents brute-force attacks by limiting attempts per IP AND per email.
 *
 * Default: 10 attempts per 15 minutes per IP, 5 attempts per 15 minutes per email.
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly maxAttemptsPerIp = 50;
  private readonly maxAttemptsPerEmail = 20;
  private readonly windowSec = 300; // 5 minutes

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const email = (req.body?.email || '').toLowerCase().trim();

    // Check IP-based rate limit
    const ipKey = `rate:auth:ip:${ip}`;
    const ipCurrent = await ioRedis.incr(ipKey);
    if (ipCurrent === 1) {
      await ioRedis.expire(ipKey, this.windowSec);
    }

    if (ipCurrent > this.maxAttemptsPerIp) {
      const ttl = await ioRedis.ttl(ipKey);
      throw new HttpException(
        { msg: 'Too many attempts. Please try again later.', retryAfter: ttl },
        429,
      );
    }

    // Check email-based rate limit (if email is provided)
    if (email) {
      const emailKey = `rate:auth:email:${email}`;
      const emailCurrent = await ioRedis.incr(emailKey);
      if (emailCurrent === 1) {
        await ioRedis.expire(emailKey, this.windowSec);
      }

      if (emailCurrent > this.maxAttemptsPerEmail) {
        const ttl = await ioRedis.ttl(emailKey);
        throw new HttpException(
          { msg: 'Too many attempts for this account. Please try again later.', retryAfter: ttl },
          429,
        );
      }
    }

    return true;
  }
}
