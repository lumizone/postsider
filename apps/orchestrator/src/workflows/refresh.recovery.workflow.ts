import { continueAsNew, log, proxyActivities, sleep } from '@temporalio/workflow';
import { IntegrationsActivity } from '@postsider/orchestrator/activities/integrations.activity';

const { recoverStuckRefreshes } = proxyActivities<IntegrationsActivity>({
  startToCloseTimeout: '30 minutes',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '5 minutes',
  },
});

/**
 * Daily self-healing sweep for channels flagged `refreshNeeded`. Those flags
 * used to be terminal (manual reconnect only); a transient outage that has
 * since healed now clears itself. A failed run is logged and retried the next
 * day, and continueAsNew keeps the event history bounded.
 */
const ITERATIONS_PER_RUN = 60;

export async function refreshRecoveryWorkflow() {
  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    try {
      const result = await recoverStuckRefreshes(200);
      if (result.recovered > 0) {
        log.info(
          `refresh recovery: healed ${result.recovered}/${result.attempted} flagged channel(s)`
        );
      }
    } catch (err) {
      log.error(`refreshRecoveryWorkflow run failed (retrying tomorrow): ${err}`);
    }
    await sleep('1 day');
  }
  await continueAsNew<typeof refreshRecoveryWorkflow>();
}
