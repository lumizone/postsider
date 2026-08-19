import { Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { Context } from '@temporalio/activity';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';

/**
 * Backfills per-post engagement metrics into the PostAnalytics table for
 * recently published posts, so client reports carry real reach/likes instead
 * of delivery counts alone. `checkPostAnalytics` is a no-op for providers
 * without a `postAnalytics` capability and already persists + caches, so this
 * sweep is safe to run over every PUBLISHED post.
 */
@Injectable()
@Activity()
export class CollectAnalyticsActivity {
  private _logger = new Logger(CollectAnalyticsActivity.name);

  constructor(private _postsService: PostsService) {}

  @ActivityMethod()
  async collectForRecentPosts(daysBack = 14): Promise<{ collected: number }> {
    const since = new Date(Date.now() - Math.max(1, daysBack) * 86400000);
    const posts = await this._postsService.findRecentPublishedForAnalytics(since);
    let collected = 0;
    for (const post of posts) {
      // The workflow declares heartbeatTimeout: '10 minute'. Temporal fails an
      // activity that goes that long without a heartbeat, and this sweep makes
      // one throttled provider call per post — so an org with enough posts blew
      // past 10 minutes, burned all 3 retries the same way, and left every
      // client report showing zero engagement. Heartbeating also lets Temporal
      // spot a genuinely wedged sweep long before startToCloseTimeout (1h).
      // `heartbeat` is a no-op outside an activity context (e.g. unit tests).
      try {
        Context.current().heartbeat(post.id);
      } catch {
        // Not running inside a Temporal activity — nothing to report to.
      }
      try {
        const result = await this._postsService.checkPostAnalytics(
          post.organizationId,
          post.id,
          daysBack
        );
        if (Array.isArray(result) && result.length > 0) {
          collected += 1;
        }
      } catch (err) {
        // One post's failure (rate limit, token, provider) must not abort the
        // sweep; checkPostAnalytics already swallows most errors.
        this._logger.warn(
          `collect analytics failed for post ${post.id}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }
    return { collected };
  }
}
