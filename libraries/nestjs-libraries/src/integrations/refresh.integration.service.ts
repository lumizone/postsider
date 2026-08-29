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

export type RefreshLifecycleResult =
  | { status: 'refreshed'; refresh: AuthTokenDetails }
  | { status: 'stale' }
  | { status: 'failed' };

@Injectable()
export class RefreshIntegrationService implements OnApplicationBootstrap {
  constructor(
    private _integrationManager: IntegrationManager,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService,
    private _temporalService: TemporalService
  ) {}
  async refresh(integration: Integration, cause = ''): Promise<false | AuthTokenDetails> {
    const result = await this.refreshWithLifecycle(integration, cause);
    return result.status === 'refreshed' ? result.refresh : false;
  }

  async refreshWithLifecycle(
    integration: Integration,
    cause = ''
  ): Promise<RefreshLifecycleResult> {
    const socialProvider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    const siblings = socialProvider.oneTimeToken
      ? await this._integrationService.getLinkedTokenSiblingsForRefresh(
          integration.organizationId,
          integration.id,
          integration.rootInternalId,
          integration.refreshToken
        )
      : [];

    let refresh: false | AuthTokenDetails;
    try {
      refresh = await this.refreshProcess(integration, socialProvider);
    } catch (err) {
      console.error(
        `[refresh] provider refresh failed for ${integration.providerIdentifier} (${integration.id})`,
        err
      );
      refresh = false;
    }

    if (!refresh) {
      // A newer disconnect, disable, or reconnect owns the lifecycle now. Do
      // not mark it broken or notify its owner for this stale refresh attempt.
      const markedFailed = await this._integrationService.refreshFailedIfCurrent(
        integration.organizationId,
        integration.id,
        integration.revision
      );
      if (!markedFailed) {
        return { status: 'stale' };
      }
      await this._integrationService.informAboutRefreshError(
        integration.organizationId,
        integration,
        cause
      );
      return { status: 'failed' };
    }

    const persisted = await this._integrationService.refreshSucceededIfCurrent(
      integration.organizationId,
      integration.id,
      integration.revision,
      refresh
    );

    if (persisted && socialProvider.oneTimeToken) {
      await this._integrationService.refreshLinkedTokensIfCurrent(
        integration.organizationId,
        integration.id,
        integration.rootInternalId,
        integration.refreshToken,
        siblings,
        refresh
      );
    }

    return persisted
      ? { status: 'refreshed', refresh }
      : { status: 'stale' };
  }

  public async setBetweenSteps(integration: Integration, cause = '') {
    const marked =
      await this._integrationService.setBetweenRefreshStepsIfCurrent(
        integration.organizationId,
        integration.id,
        integration.revision
      );
    if (!marked) return false;
    await this._integrationService.informAboutRefreshError(
      integration.organizationId,
      integration,
      cause
    );
    return true;
  }

  public async startRefreshWorkflow(orgId: string, id: string, hasRefreshToken: boolean) {
    // Gate on whether the channel actually stores a refresh token — the old
    // `integration.refreshCron` flag is unset on most providers that still
    // expose a working refreshToken(), so gating on it silently skipped arming
    // and let those tokens lapse until the next redeploy.
    if (!hasRefreshToken) {
      return false;
    }

    const raw = this._temporalService.client.getRawClient();
    if (!raw) return false;

    // Legacy executions are transitioned only by the explicit, run-pinned
    // cutover script. A reconnect must not silently terminate an active V1/V2.
    await this.reArmRefreshWorkflow(raw, { id, organizationId: orgId });
    return true;
  }

  // On boot, (re-)arm the per-integration token-refresh workflow for every live
  // channel. Revives closed workflows without interrupting any running lifecycle.
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
          await this.reArmRefreshWorkflow(raw, integration);
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

  /**
   * Bootstrap may re-arm closed workflows, but it never replaces a running
   * execution. V1/V2 -> V3 requires the explicit, runId-pinned cutover script.
   */
  private async reArmRefreshWorkflow(
    raw: NonNullable<
      ReturnType<TemporalService['client']['getRawClient']>
    >,
    integration: { id: string; organizationId: string }
  ) {
    const workflowId = `refresh_${integration.id}`;
    const start = () =>
      raw.workflow.start('refreshTokenWorkflowV3', {
        workflowId,
        args: [
          {
            integrationId: integration.id,
            organizationId: integration.organizationId,
          },
        ],
        taskQueue: 'main',
        workflowIdConflictPolicy: 'USE_EXISTING',
        workflowIdReusePolicy: 'ALLOW_DUPLICATE',
      });

    const handle = raw.workflow.getHandle(workflowId);
    let execution: Awaited<ReturnType<typeof handle.describe>>;
    try {
      execution = await handle.describe();
    } catch {
      // No execution for this id is expected for a closed/new workflow. Start
      // with USE_EXISTING so a concurrent reconnect never gets interrupted.
      await start();
      return;
    }

    if (execution.status.name === 'RUNNING') return;

    // A closed V2/V3 execution has no live work to preserve. Re-arm it as V3
    // so an expired token can recover after a restart.
    await start();
  }

  private async refreshProcess(
    integration: Integration,
    socialProvider: SocialProvider
  ): Promise<AuthTokenDetails | false> {
    const refresh = await socialProvider.refreshToken(
      integration.refreshToken!,
      integration
    );

    if (!refresh || !refresh.accessToken) {
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
