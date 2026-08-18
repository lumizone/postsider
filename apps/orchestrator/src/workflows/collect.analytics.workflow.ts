import { continueAsNew, log, proxyActivities, sleep } from '@temporalio/workflow';
import { CollectAnalyticsActivity } from '@postsider/orchestrator/activities/collect.analytics.activity';

const { collectForRecentPosts } = proxyActivities<CollectAnalyticsActivity>({
  startToCloseTimeout: '1 hour',
  heartbeatTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

/**
 * Daily backfill of per-post engagement metrics into PostAnalytics, so client
 * reports have real reach/likes to show. A failed run is logged and retried
 * the next day, and continueAsNew keeps the event history bounded.
 */
const ITERATIONS_PER_RUN = 60;

export async function collectAnalyticsWorkflow() {
  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    try {
      await collectForRecentPosts(14);
    } catch (err) {
      log.error(`collectAnalyticsWorkflow run failed (retrying tomorrow): ${err}`);
    }
    await sleep('1 day');
  }
  await continueAsNew<typeof collectAnalyticsWorkflow>();
}
