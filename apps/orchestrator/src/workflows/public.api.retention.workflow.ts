import { continueAsNew, log, proxyActivities, sleep } from '@temporalio/workflow';
import { WebhookDeliveryActivity } from '@postsider/orchestrator/activities/webhook.delivery.activity';

const { purgeExpiredPublicApiRecords } =
  proxyActivities<WebhookDeliveryActivity>({
    startToCloseTimeout: '10 minute',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '5 minutes',
    },
  });

/**
 * Daily purge of old finished webhook deliveries and idempotency keys. A failed
 * run is logged and retried the next day instead of killing the loop, and
 * continueAsNew keeps the event history bounded.
 */
const ITERATIONS_PER_RUN = 60;

export async function publicApiRetentionWorkflow() {
  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    try {
      await purgeExpiredPublicApiRecords();
    } catch (err) {
      log.error(`publicApiRetentionWorkflow run failed (retrying tomorrow): ${err}`);
    }
    await sleep('24 hours');
  }
  await continueAsNew<typeof publicApiRetentionWorkflow>();
}
