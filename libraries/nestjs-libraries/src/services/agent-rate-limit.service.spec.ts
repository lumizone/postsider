import fc from 'fast-check';
import {
  AgentRateLimiter,
  RateLimitStore,
} from '@postsider/nestjs-libraries/services/agent-rate-limit.service';

/** In-memory fixed-window store with no expiry (single window per test run). */
class MemoryStore implements RateLimitStore {
  private counters = new Map<string, number>();

  async incr(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }
  async expire(): Promise<unknown> {
    return 1;
  }
  async ttl(): Promise<number> {
    return 42;
  }
}

describe('AgentRateLimiter', () => {
  it('Property 13: exactly min(N, limit) calls are allowed within a window', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: 50 }), // number of calls N
        fc.integer({ min: 1, max: 50 }), // per-minute limit
        async (calls, limit) => {
          const limiter = new AgentRateLimiter().withStore(new MemoryStore());
          let allowed = 0;
          for (let i = 0; i < calls; i++) {
            // Use a very high daily limit so only the minute window gates.
            const res = await limiter.consume('tok', limit, 1_000_000);
            if (res.allowed) allowed++;
          }
          expect(allowed).toBe(Math.min(calls, limit));
        }
      )
    );
  });

  it('returns minute exceeded with a retryAfter', async () => {
    const limiter = new AgentRateLimiter().withStore(new MemoryStore());
    await limiter.consume('t', 1, 100);
    const second = await limiter.consume('t', 1, 100);
    expect(second.allowed).toBe(false);
    expect(second.exceeded).toBe('minute');
    expect(second.retryAfter).toBeGreaterThan(0);
  });

  it('enforces per-connector daily quota independently', async () => {
    const limiter = new AgentRateLimiter().withStore(new MemoryStore());
    const first = await limiter.consumeConnectorQuota('t', 'x', 1);
    const second = await limiter.consumeConnectorQuota('t', 'x', 1);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(false);
    expect(second.exceeded).toBe('connector');
  });
});
