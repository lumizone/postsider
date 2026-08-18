import { Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
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
