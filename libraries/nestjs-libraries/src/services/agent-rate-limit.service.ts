import { Injectable } from '@nestjs/common';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';

export interface RateLimitResult {
  allowed: boolean;
  /** Which window was exceeded, if any. */
  exceeded?: 'minute' | 'day' | 'connector';
  /** Seconds until the exceeded window resets. */
  retryAfter?: number;
}

/** Minimal subset of the Redis client this limiter needs (injectable for tests). */
export interface RateLimitStore {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}

const MINUTE_SECONDS = 60;
const DAY_SECONDS = 86400;

/**
 * Per-`AgentToken` rate limiter using fixed-window counters in Redis
 * (Requirement 16). Enforces a per-minute and per-day request limit, plus an
 * optional per-connector daily publication quota.
 *
 * Determinism (Correctness Property 13): for a sequence of N calls in a single
 * window with limit L, exactly `min(N, L)` calls are allowed.
 */
@Injectable()
export class AgentRateLimiter {
  private store: RateLimitStore;

  constructor() {
    this.store = ioRedis as unknown as RateLimitStore;
  }

  /** Test-only: override the backing store. */
  withStore(store: RateLimitStore): this {
    this.store = store;
    return this;
  }

  private async hitWindow(
    key: string,
    windowSeconds: number,
    limit: number
  ): Promise<{ allowed: boolean; retryAfter: number }> {
    const current = await this.store.incr(key);
    if (current === 1) {
      await this.store.expire(key, windowSeconds);
    }
    if (current > limit) {
      const ttl = await this.store.ttl(key);
      return { allowed: false, retryAfter: ttl > 0 ? ttl : windowSeconds };
    }
    return { allowed: true, retryAfter: 0 };
  }

  /**
   * Consume one request slot for the token. Checks the per-minute then per-day
   * windows. Returns the first exceeded window if any.
   */
  async consume(
    tokenId: string,
    perMinute: number,
    perDay: number
  ): Promise<RateLimitResult> {
    const minute = await this.hitWindow(
      `rate:agent:${tokenId}:min`,
      MINUTE_SECONDS,
      perMinute
    );
    if (!minute.allowed) {
      return { allowed: false, exceeded: 'minute', retryAfter: minute.retryAfter };
    }

    const day = await this.hitWindow(
      `rate:agent:${tokenId}:day`,
      DAY_SECONDS,
      perDay
    );
    if (!day.allowed) {
      return { allowed: false, exceeded: 'day', retryAfter: day.retryAfter };
    }

    return { allowed: true };
  }

  /** Consume one slot of a per-connector daily publication quota. */
  async consumeConnectorQuota(
    tokenId: string,
    connectorId: string,
    perDay: number
  ): Promise<RateLimitResult> {
    const result = await this.hitWindow(
      `quota:agent:${tokenId}:${connectorId}:day`,
      DAY_SECONDS,
      perDay
    );
    return result.allowed
      ? { allowed: true }
      : { allowed: false, exceeded: 'connector', retryAfter: result.retryAfter };
  }
}
