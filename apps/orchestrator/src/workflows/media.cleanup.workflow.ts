import { proxyActivities, sleep } from '@temporalio/workflow';
import { MediaCleanupActivity } from '@postsider/orchestrator/activities/media.cleanup.activity';

const { cleanupExpiredMedia } = proxyActivities<MediaCleanupActivity>({
  startToCloseTimeout: '30 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: '5 minutes',
  },
});

/**
 * Runs once every 24 hours. Finds media older than 90 days and deletes
 * both the file from storage and soft-deletes the DB row.
 *
 * Skips media that is still attached to a QUEUE (scheduled) post.
 * Skips user profile pictures.
 */
export async function mediaCleanupWorkflow() {
  while (true) {
    // Process all expired media in batches until nothing left
    let result = await cleanupExpiredMedia();
    while (result.deleted >= 400) {
      // If we deleted close to the batch limit, there may be more
      result = await cleanupExpiredMedia();
    }
    // Run once every 24 hours
    await sleep('24 hours');
  }
}
