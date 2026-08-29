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

  // Mirrors ioredis.set(key, value[, 'EX'|'PX', ttl][, 'NX']) for callers
  // that need atomic short-lived reservations in test/self-host mode.
  async set(key: string, value: any, ...options: Array<string | number>) {
    const normalized = options.map((option) =>
      typeof option === 'string' ? option.toUpperCase() : option
    );
    const nx = normalized.includes('NX');
    const expiryMode = normalized.find(
      (option): option is string => option === 'EX' || option === 'PX'
    );
    const expiryIndex = expiryMode ? normalized.indexOf(expiryMode) + 1 : -1;
    const ttl = expiryIndex >= 0 ? normalized[expiryIndex] : undefined;

    if (this.isExpired(key)) this.data.delete(key);
    if (nx && this.data.has(key)) return null;
    if (
      (expiryMode && (typeof ttl !== 'number' || ttl <= 0)) ||
      (!expiryMode && options.length > (nx ? 1 : 0))
    ) {
      throw new TypeError('MockRedis.set received unsupported options');
    }
    if (expiryMode && typeof ttl === 'number') {
      this.expiries.set(
        key,
        Date.now() + (expiryMode === 'EX' ? ttl * 1000 : ttl)
      );
    } else {
      this.expiries.delete(key);
    }
    this.data.set(key, value);
    return 'OK';
  }

  async eval(script: string, numKeys: number, ...args: string[]) {
    const keys = args.slice(0, numKeys);
    const values = args.slice(numKeys);

    if (script.includes("redis.call('SET', KEYS[2], ARGV[2], 'PX'")) {
      if ((await this.get(keys[0])) !== values[0]) return 0;
      await this.set(keys[1], values[1], 'PX', Number(values[2]));
      return 1;
    }
    if (script.includes('session.expiresAt = tonumber(ARGV[2])')) {
      // touchMultipartSession: extend a live multipart session's expiry and its
      // owner-slot TTL (slot extension guarded by the reservation marker).
      const raw = await this.get(keys[0]);
      if (!raw) return 0;
      const session = JSON.parse(raw);
      if (session.state !== 'active') return 0;
      if ((await this.get(keys[1])) === values[0]) {
        this.expiries.set(keys[1], Date.now() + Number(values[2]));
      }
      session.expiresAt = Number(values[1]);
      this.set(keys[0], JSON.stringify(session), 'PX', Number(values[2]));
      return 1;
    }
    if (script.includes('local session = cjson.decode(raw)')) {
      const raw = await this.get(keys[0]);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (
        session.organizationId !== values[0] ||
        session.ownerId !== values[1] ||
        session.state !== values[2] ||
        (values[5] !== '1' && session.expiresAt <= Number(values[3]))
      ) {
        return null;
      }
      session.state = values[4];
      this.data.set(keys[0], JSON.stringify(session));
      return JSON.stringify(session);
    }
    if (script.includes("redis.call('DEL', KEYS[2])")) {
      if ((await this.get(keys[0])) === values[0]) await this.del(keys[0]);
      await this.del(keys[1]);
      return 1;
    }
    if (script.includes("redis.call('DEL', KEYS[1])")) {
      if ((await this.get(keys[0])) === values[0]) return this.del(keys[0]);
      return 0;
    }
    throw new TypeError('MockRedis.eval received an unsupported script');
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
