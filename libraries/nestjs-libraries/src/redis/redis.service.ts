import { Redis } from 'ioredis';

// Create a mock Redis implementation for testing environments.
// Must cover the methods the rest of the codebase actually calls at runtime
// when REDIS_URL is unset (self-host without Redis): get/set/del/incr/expire/ttl.
class MockRedis {
  private data: Map<string, any> = new Map();
  private expiries: Map<string, number> = new Map();

  async get(key: string) {
    if (this.isExpired(key)) {
      this.data.delete(key);
      return undefined;
    }
    return this.data.get(key);
  }

  // Mirrors ioredis.set(key, value[, 'EX', seconds]) enough for our callers.
  async set(key: string, value: any, mode?: string, seconds?: number) {
    if (mode === 'EX' && typeof seconds === 'number') {
      this.expiries.set(key, Date.now() + seconds * 1000);
    } else if (mode !== undefined) {
      throw new TypeError(`MockRedis.set does not support mode "${mode}"`);
    }
    this.data.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]) {
    let count = 0;
    for (const key of keys) {
      this.data.delete(key);
      this.expiries.delete(key);
      count++;
    }
    return count;
  }

  async incr(key: string) {
    const current = (parseInt(this.data.get(key), 10) || 0) + 1;
    this.data.set(key, String(current));
    return current;
  }

  async expire(key: string, seconds: number) {
    if (!this.data.has(key)) return 0;
    this.expiries.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  async ttl(key: string) {
    if (!this.data.has(key)) return -2;
    const exp = this.expiries.get(key);
    if (!exp) return -1;
    return Math.max(0, Math.round((exp - Date.now()) / 1000));
  }

  private isExpired(key: string): boolean {
    const exp = this.expiries.get(key);
    if (!exp) return false;
    if (Date.now() >= exp) {
      this.expiries.delete(key);
      return true;
    }
    return false;
  }
}

// Use real Redis if REDIS_URL is defined, otherwise use MockRedis
export const ioRedis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      connectTimeout: 10000,
    })
  : (new MockRedis() as unknown as Redis); // Type cast to Redis to maintain interface compatibility
