import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';

const logger = new Logger('OAuthRateLimit');

const intFromEnv = (name: string, fallback: number): number => {
  const parsed = parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Requests per minute, per registered client. Generous: one popular client serves many users. */
export const oauthLimits = () => ({
  authorize: intFromEnv('MCP_OAUTH_AUTHORIZE_RPM', 300),
  token: intFromEnv('MCP_OAUTH_TOKEN_RPM', 1200),
});

/**
 * Fixed-window counter keyed by a registered client's row id (never by anything
 * the caller can invent: unknown client ids are refused before this runs, so the
 * key space cannot be inflated). `/oauth/authorize` writes a pending-consent row
 * for every call, so without a cap one client can fill the table.
 *
 * Fails open: Redis being down must not take sign-in down with it.
 */
export async function assertOAuthRate(
  bucket: 'authorize' | 'token',
  clientRowId: string,
  limit: number = oauthLimits()[bucket]
): Promise<void> {
  let count: number;
  try {
    const key = `rate:mcp-oauth:${bucket}:${clientRowId}`;
    count = await ioRedis.incr(key);
    if (count === 1) {
      await ioRedis.expire(key, 60);
    }
  } catch (err) {
    logger.warn(`rate limiter unavailable, allowing the request: ${err}`);
    return;
  }
  if (count > limit) {
    throw new HttpException(
      {
        error: 'temporarily_unavailable',
        error_description: 'Too many requests from this client; retry shortly.',
      },
      HttpStatus.TOO_MANY_REQUESTS
    );
  }
}
