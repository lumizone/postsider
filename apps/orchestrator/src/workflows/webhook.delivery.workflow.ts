import { continueAsNew, log, proxyActivities, sleep } from '@temporalio/workflow';
import { WebhookDeliveryActivity } from '@postsider/orchestrator/activities/webhook.delivery.activity';

const { processDueWebhookDeliveries } =
  proxyActivities<WebhookDeliveryActivity>({
    startToCloseTimeout: '5 minute',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '30 seconds',
    },
  });

/**
 * Drains the public webhook delivery outbox once a minute. A full batch (50)
 * means more may be due, so keep draining before sleeping. A failed run is
 * logged and retried on the next tick instead of killing the loop, and
 * continueAsNew keeps the event history bounded.
 */
const ITERATIONS_PER_RUN = 120;
const BATCH_SIZE = 50;

export async function webhookDeliveryWorkflow() {
  for (let i = 0; i < ITERATIONS_PER_RUN; i++) {
    try {
      let result = await processDueWebhookDeliveries();
      while (result.claimed >= BATCH_SIZE) {
        result = await processDueWebhookDeliveries();
      }
    } catch (err) {
      log.error(`webhookDeliveryWorkflow run failed (retrying in 1 minute): ${err}`);
    }
    await sleep('1 minute');
  }
  await continueAsNew<typeof webhookDeliveryWorkflow>();
}
