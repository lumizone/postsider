import { proxyActivities, sleep } from '@temporalio/workflow';
import { EvergreenActivity } from '@postsider/orchestrator/activities/evergreen.activity';

const { recycleEvergreenForAllOrgs } = proxyActivities<EvergreenActivity>({
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
});

export async function evergreenWorkflow() {
  await recycleEvergreenForAllOrgs();
  while (true) {
    await sleep('1 day');
    await recycleEvergreenForAllOrgs();
  }
}
