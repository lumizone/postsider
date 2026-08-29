import {
  continueAsNew,
  log,
  proxyActivities,
  sleep,
} from '@temporalio/workflow';
import { R2MultipartCleanupActivity } from '@postsider/orchestrator/activities/r2.multipart.cleanup.activity';

const { cleanupIncompleteR2MultipartUploads } =
  proxyActivities<R2MultipartCleanupActivity>({
    startToCloseTimeout: '30 minute',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 2,
      initialInterval: '5 minutes',
    },
  });

const ITERATIONS_PER_HISTORY = 60;

/**
 * Independently removes R2 multipart uploads that outlive their grace period.
 * This V1 workflow is intentionally separate from mediaCleanupWorkflow so its
 * replay history and scheduling can evolve without changing the active media
 * retention workflow.
 */
export async function r2MultipartCleanupWorkflowV1() {
  for (let i = 0; i < ITERATIONS_PER_HISTORY; i++) {
    try {
      await cleanupIncompleteR2MultipartUploads();
    } catch (error) {
      log.error(
        `r2MultipartCleanupWorkflowV1 run failed (retrying tomorrow): ${error}`
      );
    }
    await sleep('1 day');
  }
  await continueAsNew<typeof r2MultipartCleanupWorkflowV1>();
}
