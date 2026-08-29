/**
 * Unit suites must run against the in-memory MockRedis from
 * `libraries/nestjs-libraries/src/redis/redis.service.ts`, which selects its
 * backend at import time: a real ioredis client when REDIS_URL is set, the mock
 * otherwise.
 *
 * Several specs (notably upload/r2.uploader.spec.ts) combine jest fake timers
 * with TTL assertions. Fake timers cannot advance a real Redis server's clock,
 * so those assertions only hold against the mock. CI defines REDIS_URL for the
 * whole job, which silently switched the unit run onto a real Redis and made two
 * multipart-session tests fail with a 403 while they passed on any machine
 * without Redis running.
 *
 * Dropping the variable here keeps the unit run hermetic and identical
 * everywhere. Anything that genuinely needs a live Redis belongs in an
 * integration suite with its own config and real time.
 */
delete process.env.REDIS_URL;
