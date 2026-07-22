import { continueAsNew, log, proxyActivities, sleep } from '@temporalio/workflow';
import { PostActivity } from '@postsider/orchestrator/activities/post.activity';

const { searchForMissingThreeHoursPosts } = proxyActivities<PostActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

/**
 * Hourly safety net that re-queues posts which missed their publish window.
 *
 * Hardened after the 2026-07-22 audit:
 * - a failed sweep (e.g. the DB briefly down at the wrong minute used to
 *   exhaust the 3 activity retries and kill the loop FOREVER — the safety net
 *   itself died silently) is now logged and retried next hour;
 * - continueAsNew keeps the event history bounded (an unbounded `while (true)`
 *   accumulates ~120 events/day and would hit Temporal's 51.2k-event kill
 *   switch after roughly 1.5 years).
 */
const ITERATIONS_PER_RUN = 100;

export async function missingPostWorkflow() {
  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    try {
      await searchForMissingThreeHoursPosts();
    } catch (err) {
      log.error(`missingPostWorkflow sweep failed (retrying next hour): ${err}`);
    }
    await sleep('1 hour');
  }
  await continueAsNew<typeof missingPostWorkflow>();
}
