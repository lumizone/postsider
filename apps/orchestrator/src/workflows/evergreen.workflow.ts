import { continueAsNew, log, proxyActivities, sleep } from '@temporalio/workflow';
import { EvergreenActivity } from '@postsider/orchestrator/activities/evergreen.activity';

const { recycleEvergreenForAllOrgs } = proxyActivities<EvergreenActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

/**
 * Daily evergreen recycling. A failed run is logged and retried the next day
 * instead of killing the loop forever, and continueAsNew keeps the event
 * history bounded (see missing.post.workflow.ts for the rationale).
 */
const ITERATIONS_PER_RUN = 60;

export async function evergreenWorkflow() {
  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    try {
      await recycleEvergreenForAllOrgs();
    } catch (err) {
      log.error(`evergreenWorkflow run failed (retrying tomorrow): ${err}`);
    }
    await sleep('1 day');
  }
  await continueAsNew<typeof evergreenWorkflow>();
}
