/**
 * Token-refresh workflow v2 — no OAuth secrets in Temporal history.
 *
 * v1 loaded the whole integration each loop and passed it into `refreshToken`,
 * so a channel's access and refresh tokens were written into Temporal's event
 * history on every iteration — and these workflows run for the life of the
 * channel. v2 reads a secret-free row for its scheduling decisions and refreshes
 * by id, receiving only a boolean back.
 *
 * v1 is kept intact: running instances replay against the code they started
 * with. The one-time cutover terminates them so the boot re-arm restarts every
 * channel on v2.
 */
import { proxyActivities, sleep } from '@temporalio/workflow';
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
// Activities resolve by NAME at runtime; `refreshToken` has always been
// PostActivity's (IntegrationsActivity's copy was never decorated/registered —
// removed in the 2026-07-22 audit). Type it accordingly so the code says what
// the runtime does.
const { refreshTokenById } = proxyActivities<PostActivity>(activityOptions);

export async function refreshTokenWorkflowV2({
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
    let integration = await getIntegrationsSafeById(
      integrationId,
      organizationId
    );
    if (
      !integration ||
      integration.deletedAt ||
      integration.inBetweenSteps ||
      integration.refreshNeeded
    ) {
      return false;
    }

    // A null tokenExpiration means a non-expiring token — nothing to refresh on
    // a schedule. Re-check daily instead of hot-looping: without this guard
    // `new Date(null)` is epoch 0, so waitMs is hugely negative, the sleep is
    // skipped, and the provider's token endpoint gets hammered every MIN_RETRY.
    if (!integration.tokenExpiration) {
      await sleep(24 * 60 * 60 * 1000);
      continue;
    }

    const waitMs =
      new Date(integration.tokenExpiration).getTime() -
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
    integration = await getIntegrationsSafeById(
      integrationId,
      organizationId
    );
    if (
      !integration ||
      integration.deletedAt ||
      integration.inBetweenSteps ||
      integration.refreshNeeded
    ) {
      return false;
    }

    await refreshTokenById(organizationId, integrationId);

    // Guard against a tight loop if a refresh somehow does not advance
    // tokenExpiration (a healthy refresh pushes it far into the future).
    await sleep(MIN_RETRY_MS);
  }
}
