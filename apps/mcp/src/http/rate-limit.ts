/**
 * Fixed-window rate limiter keyed by token subject.
 *
 * The remote server is stateless per request, but this container is the one
 * place that sees every call for a subject, so the window lives here. Limits
 * stay generous (a normal agent conversation is tens of calls per minute);
 * this exists to stop a runaway loop or a hostile token from hammering the
 * product API, not to meter normal use.
 */
export class SubjectRateLimiter {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();

  constructor(
    private readonly limitPerMinute: number,
    private readonly now: () => number = Date.now
  ) {}

  hit(
    subject: string
  ): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
    const nowMs = this.now();
    const window = this.windows.get(subject);

    if (!window || nowMs - window.start >= 60_000) {
      this.windows.set(subject, { start: nowMs, count: 1 });
      this.pruneIfLarge(nowMs);
      return { allowed: true };
    }

    window.count += 1;
    if (window.count > this.limitPerMinute) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((window.start + 60_000 - nowMs) / 1000)
        ),
      };
    }
    return { allowed: true };
  }

  /** Drop expired windows once the map grows past any plausible subject count. */
  private pruneIfLarge(nowMs: number): void {
    if (this.windows.size <= 10_000) return;
    for (const [key, window] of this.windows) {
      if (nowMs - window.start >= 60_000) {
        this.windows.delete(key);
      }
    }
  }
}
