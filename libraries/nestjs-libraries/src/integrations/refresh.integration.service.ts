import {
  forwardRef,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class RefreshIntegrationService implements OnApplicationBootstrap {
  constructor(
    private _integrationManager: IntegrationManager,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService,
    private _temporalService: TemporalService
  ) {}
  async refresh(integration: Integration, cause = ''): Promise<false | AuthTokenDetails> {
    const socialProvider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const refresh = await this.refreshProcess(integration, socialProvider, cause);

    if (!refresh) {
      return false as const;
    }

    await this._integrationService.createOrUpdateIntegration(
      undefined,
      !!socialProvider.oneTimeToken,
      integration.organizationId,
      integration.name,
      integration.picture!,
      'social',
      integration.internalId,
      integration.providerIdentifier,
      refresh.accessToken,
      refresh.refreshToken,
      refresh.expiresIn
    );

    return refresh;
  }

  public async setBetweenSteps(integration: Integration, cause = '') {
    await this._integrationService.setBetweenRefreshSteps(integration.id);
    await this._integrationService.informAboutRefreshError(
      integration.organizationId,
      integration,
      cause
    );
  }

  public async startRefreshWorkflow(orgId: string, id: string, hasRefreshToken: boolean) {
    // Gate on whether the channel actually stores a refresh token — the old
    // `integration.refreshCron` flag is unset on most providers that still
    // expose a working refreshToken(), so gating on it silently skipped arming
    // and let those tokens lapse until the next redeploy.
    if (!hasRefreshToken) {
      return false;
    }

    return this._temporalService.client
      .getRawClient()
      ?.workflow.start(`refreshTokenWorkflowV2`, {
        workflowId: `refresh_${id}`,
        args: [{integrationId: id, organizationId: orgId}],
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
      });
  }

  // On boot, (re-)arm the per-integration token-refresh workflow for every live
  // channel. Revives any that previously exited (e.g. a token expired while the
  // orchestrator was down) and makes auto-refresh survive redeploys. USE_EXISTING
  // leaves already-running workflows untouched and is safe even if both the
  // backend and orchestrator run this hook.
  async onApplicationBootstrap(): Promise<void> {
    // Fire-and-forget so a slow Temporal connection never blocks app startup.
    this.reArmAllRefreshWorkflows().catch((err) =>
      console.error('[refresh re-arm] crashed', err)
    );
  }

  async reArmAllRefreshWorkflows(): Promise<void> {
    // Retry for ~10 minutes, not 30 seconds. Giving up after 30s meant that a
    // Temporal still starting (or an app client that took a while to connect)
    // left EVERY channel un-armed until the next redeploy — idle channels then
    // quietly let their tokens lapse. Failures per integration are retried in
    // the next round too, instead of being skipped once and forgotten.
    const maxRounds = 20;
    const roundDelayMs = 30_000;
    let pending: Awaited<
      ReturnType<typeof this._integrationService.getAllForRefreshArming>
    > | null = null;

    for (let round = 1; round <= maxRounds; round++) {
      const raw = this._temporalService.client?.getRawClient();
      if (!raw) {
        if (round === maxRounds) {
          console.error(
            `[refresh re-arm] Temporal client still unavailable after ${maxRounds} rounds — token refresh workflows are NOT armed; restart the backend once Temporal is reachable`
          );
          return;
        }
        console.warn(
          `[refresh re-arm] Temporal client unavailable (round ${round}/${maxRounds}) — retrying in ${
            roundDelayMs / 1000
          }s`
        );
        await new Promise((resolve) => setTimeout(resolve, roundDelayMs));
        continue;
      }

      // Arm any channel that actually has a refresh token. (We intentionally do
      // NOT gate on the provider's `refreshCron` flag — most providers leave it
      // false yet still expose a working refreshToken(), so gating on it left
      // their tokens to silently expire when idle.)
      if (!pending) {
        pending = (
          await this._integrationService.getAllForRefreshArming()
        ).filter((integration) => integration.refreshToken);
      }

      const failed: Awaited<
        ReturnType<typeof this._integrationService.getAllForRefreshArming>
      > = [];
      let armed = 0;
      for (const integration of pending) {
        try {
          await raw.workflow.start('refreshTokenWorkflowV2', {
            workflowId: `refresh_${integration.id}`,
            args: [
              {
                integrationId: integration.id,
                organizationId: integration.organizationId,
              },
            ],
            taskQueue: 'main',
            // Leave a running refresh untouched; allow restarting a closed one.
            workflowIdConflictPolicy: 'USE_EXISTING',
            workflowIdReusePolicy: 'ALLOW_DUPLICATE',
          });
          armed++;
        } catch (err) {
          failed.push(integration);
        }
      }

      if (failed.length === 0) {
        console.log(
          `[refresh re-arm] armed ${armed} integration refresh workflow(s)`
        );
        return;
      }

      pending = failed;
      if (round === maxRounds) {
        console.error(
          `[refresh re-arm] ${failed.length} integration(s) could NOT be armed after ${maxRounds} rounds (ids: ${failed
            .map((f) => f.id)
            .join(', ')}) — their tokens will not auto-refresh`
        );
        return;
      }
      console.warn(
        `[refresh re-arm] armed ${armed}, ${failed.length} failed (round ${round}/${maxRounds}) — retrying those in ${
          roundDelayMs / 1000
        }s`
      );
      await new Promise((resolve) => setTimeout(resolve, roundDelayMs));
    }
  }

  private async refreshProcess(
    integration: Integration,
    socialProvider: SocialProvider,
    cause = ''
  ): Promise<AuthTokenDetails | false> {
    const refresh: false | AuthTokenDetails = await socialProvider
      .refreshToken(integration.refreshToken!, integration)
      .catch((err) => {
        // Log the underlying failure instead of swallowing it — a transient
        // network/5xx otherwise looks identical to a genuinely revoked token.
        console.error(
          `[refresh] provider refresh failed for ${integration.providerIdentifier} (${integration.id})`,
          err
        );
        return false;
      });

    if (!refresh || !refresh.accessToken) {
      await this._integrationService.refreshNeeded(
        integration.organizationId,
        integration.id
      );

      await this._integrationService.informAboutRefreshError(
        integration.organizationId,
        integration,
        cause
      );

      await this._integrationService.disconnectChannel(
        integration.organizationId,
        integration
      );

      return false;
    }

    if (
      !socialProvider.reConnect ||
      integration.rootInternalId === integration.internalId
    ) {
      return refresh;
    }

    const reConnect = await socialProvider.reConnect(
      integration.rootInternalId!,
      integration.internalId,
      refresh.accessToken
    );

    return {
      ...refresh,
      ...reConnect,
    };
  }
}
