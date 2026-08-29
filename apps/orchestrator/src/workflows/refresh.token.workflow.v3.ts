/**
 * Token-refresh workflow v3 — lifecycle revision-aware refresh.
 *
 * V1/V2 remain exported for deterministic replay. V3 carries only the safe
 * integration revision into its refresh activity, so reconnect/disable/delete
 * changes that race with a timer cannot refresh or overwrite a newer channel.
 */
import { continueAsNew, proxyActivities, sleep } from '@temporalio/workflow';
import { IntegrationsActivity } from '@postsider/orchestrator/activities/integrations.activity';
import { PostActivity } from '@postsider/orchestrator/activities/post.activity';

const activityOptions = {
  startToCloseTimeout: '10 minute',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 1,
    initialInterval: '2 minutes',
  },
} as const;

const { getIntegrationsSafeById } =
  proxyActivities<IntegrationsActivity>(activityOptions);
const { refreshTokenById } = proxyActivities<PostActivity>(activityOptions);

export async function refreshTokenWorkflowV3({
  organizationId,
  integrationId,
}: {
  integrationId: string;
  organizationId: string;
}) {
  const REFRESH_BUFFER_MS = 5 * 60 * 1000;
  const MIN_RETRY_MS = 60 * 1000;

  while (true) {
    let integration = await getIntegrationsSafeById(
      integrationId,
      organizationId
    );
    if (
      !integration ||
      integration.disabled ||
      integration.deletedAt ||
      integration.inBetweenSteps ||
      integration.refreshNeeded
    ) {
      return false;
    }

    if (!integration.tokenExpiration) {
      await sleep(24 * 60 * 60 * 1000);
      return await continueAsNew<typeof refreshTokenWorkflowV3>({
        organizationId,
        integrationId,
      });
    }

    const waitMs =
      new Date(integration.tokenExpiration).getTime() -
      Date.now() -
      REFRESH_BUFFER_MS;

    if (waitMs > 0) {
      await sleep(waitMs as number);
    }

    integration = await getIntegrationsSafeById(integrationId, organizationId);
    if (
      !integration ||
      integration.disabled ||
      integration.deletedAt ||
      integration.inBetweenSteps ||
      integration.refreshNeeded
    ) {
      return false;
    }

    // The activity verifies this same revision before the provider call, then
    // the service uses it again for the final credential compare-and-swap.
    if (
      !(await refreshTokenById(
        organizationId,
        integrationId,
        integration.revision
      ))
    ) {
      // A reconnect can replace this channel after its re-arm observes the old
      // workflow as running. Continue with the new revision instead of letting
      // that old execution exit and leave the reconnected channel unarmed.
      const current = await getIntegrationsSafeById(integrationId, organizationId);
      if (
        current &&
        !current.disabled &&
        !current.deletedAt &&
        !current.inBetweenSteps &&
        !current.refreshNeeded &&
        current.revision !== integration.revision
      ) {
        return await continueAsNew<typeof refreshTokenWorkflowV3>({
          organizationId,
          integrationId,
        });
      }
      return false;
    }

    await sleep(MIN_RETRY_MS);
    return await continueAsNew<typeof refreshTokenWorkflowV3>({
      organizationId,
      integrationId,
    });
  }
}
