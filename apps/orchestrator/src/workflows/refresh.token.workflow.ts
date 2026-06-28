import { proxyActivities, sleep } from '@temporalio/workflow';
import { IntegrationsActivity } from '@postsider/orchestrator/activities/integrations.activity';

const { getIntegrationsById, refreshToken } =
  proxyActivities<IntegrationsActivity>({
    startToCloseTimeout: '10 minute',
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 1,
      initialInterval: '2 minutes',
    },
  });

export async function refreshTokenWorkflow({
  organizationId,
  integrationId,
}: {
  integrationId: string;
  organizationId: string;
}) {
  // Refresh slightly BEFORE expiry so the access token never actually lapses.
  const REFRESH_BUFFER_MS = 5 * 60 * 1000;
  // Floor between iterations so a persistently-failing refresh cannot hot-loop.
  const MIN_RETRY_MS = 60 * 1000;

  while (true) {
    let integration = await getIntegrationsById(integrationId, organizationId);
    if (
      !integration ||
      integration.deletedAt ||
      integration.inBetweenSteps ||
      integration.refreshNeeded
    ) {
      return false;
    }

    const waitMs =
      new Date(integration.tokenExpiration!).getTime() -
      Date.now() -
      REFRESH_BUFFER_MS;

    // Only sleep while the token is still good. If it has ALREADY expired (the
    // orchestrator was down past expiry, or a short-lived token missed a cycle)
    // fall straight through and refresh NOW instead of giving up. The previous
    // `if (!minMax) return false` left such integrations permanently
    // un-refreshed until a manual reconnect — the root cause of "dead" channels.
    if (waitMs > 0) {
      await sleep(waitMs as number);
    }

    // The integration might have changed while we slept.
    integration = await getIntegrationsById(integrationId, organizationId);
    if (
      !integration ||
      integration.deletedAt ||
      integration.inBetweenSteps ||
      integration.refreshNeeded
    ) {
      return false;
    }

    await refreshToken(integration);

    // Guard against a tight loop if a refresh somehow does not advance
    // tokenExpiration (a healthy refresh pushes it far into the future).
    await sleep(MIN_RETRY_MS);
  }
}
