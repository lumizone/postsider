import {
  forwardRef,
  Inject,
  Injectable,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Integration } from '@prisma/client';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  NotEnoughScopes,
  RefreshToken,
} from '@postsider/nestjs-libraries/integrations/social.abstract';
import { TemporalService } from 'nestjs-temporal-core';

export type RefreshLifecycleResult =
  | { status: 'refreshed'; refresh: AuthTokenDetails }
  | { status: 'deferred' }
  | { status: 'stale' }
  | { status: 'failed' };

/**
 * How long the scheduled refresh workflow waits before retrying a *transient*
 * provider failure (network blip, 5xx, timeout). Kept well above the workflow's
 * 5-minute pre-expiry buffer so a deferred retry always schedules a real sleep
 * instead of hot-looping the provider.
 */
const TRANSIENT_REFRESH_BACKOFF_MS = 10 * 60 * 1000;

/**
 * Upper bound on a single provider refresh exchange. Kept below the Temporal
 * activity's start-to-close budget; the PX TTL is the dead-man's switch if the
 * process dies mid-refresh.
 */
const REFRESH_LOCK_TTL_MS = 60 * 1000;

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

    // Serialize concurrent refreshes of the SAME channel. The scheduled V3
    // workflow, a publish-time refresh and the analytics sweep can all target
    // one channel at once; for providers that rotate refresh tokens (TikTok,
    // LinkedIn, Twitch, Discord, Whop) two concurrent exchanges can revoke the
    // whole token family and force a reconnect. If another attempt holds the
    // lock this one defers, and the winner's result lands in the database.
    const lock = await this.acquireRefreshLock(integration.id);
    if (!lock.acquired) {
      const deferred = await this._integrationService.deferRefreshIfCurrent(
        integration.organizationId,
        integration.id,
        integration.revision,
        TRANSIENT_REFRESH_BACKOFF_MS
      );
      return deferred ? { status: 'deferred' } : { status: 'stale' };
    }

    try {
      return await this.runRefreshLifecycle(
        integration,
        socialProvider,
        siblings,
        cause
      );
    } finally {
      await this.releaseRefreshLock(integration.id, lock.token);
    }
  }

  private async acquireRefreshLock(
    integrationId: string
  ): Promise<{ acquired: true; token: string } | { acquired: false }> {
    const key = `refresh-lock:${integrationId}`;
    const token = randomUUID();
    try {
      const result = await ioRedis.set(key, token, 'PX', REFRESH_LOCK_TTL_MS, 'NX');
      return result === 'OK' ? { acquired: true, token } : { acquired: false };
    } catch {
      // Fail open: a lock-store outage must never block token refreshes.
      return { acquired: true, token };
    }
  }

  private async releaseRefreshLock(
    integrationId: string,
    token: string
  ): Promise<void> {
    try {
      await ioRedis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
        1,
        `refresh-lock:${integrationId}`,
        token
      );
    } catch {
      // The PX TTL releases it; a failed release is not worth surfacing.
    }
  }

  private async runRefreshLifecycle(
    integration: Integration,
    socialProvider: SocialProvider,
    siblings: { id: string; revision: number }[],
    cause: string
  ): Promise<RefreshLifecycleResult> {
    let refresh: false | AuthTokenDetails;
    let transient = false;
    try {
      refresh = await this.refreshProcess(integration, socialProvider);
    } catch (err) {
      console.error(
        `[refresh] provider refresh failed for ${integration.providerIdentifier} (${integration.id})`,
        err
      );
      // A network blip, provider 5xx or timeout is NOT proof that the
      // credentials are dead. Treating every failure as permanent used to set
      // `refreshNeeded`, which stops the refresh workflow, blocks publishing,
      // and can only be cleared by a manual reconnect — so a momentary outage
      // forced the user to reconnect the channel.
      transient = !this.isPermanentRefreshError(err);
      refresh = false;
    }

    if (!refresh && transient) {
      // Defer instead of flagging: bump the revision so the scheduled V3
      // workflow's existing "revision changed => continueAsNew" branch retries,
      // and push tokenExpiration out by the backoff so that retry is scheduled
      // rather than immediate. The channel stays usable in the meantime.
      const deferred = await this._integrationService.deferRefreshIfCurrent(
        integration.organizationId,
        integration.id,
        integration.revision,
        TRANSIENT_REFRESH_BACKOFF_MS
      );
      return deferred ? { status: 'deferred' } : { status: 'stale' };
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

  /**
   * Best-effort recovery for a channel flagged `refreshNeeded`. Runs the
   * provider exchange again and, on success, clears the flag and re-arms the
   * scheduled refresh workflow. Backs the daily recovery sweep and the manual
   * "Retry" action. It never notifies and never flips flags on failure: the
   * channel keeps whatever state it already had.
   */
  async recoverOnce(integration: Integration): Promise<boolean> {
    if (!integration.refreshToken) {
      return false;
    }
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

    const lock = await this.acquireRefreshLock(integration.id);
    if (!lock.acquired) {
      return false;
    }
    try {
      let refresh: false | AuthTokenDetails;
      try {
        refresh = await this.refreshProcess(integration, socialProvider);
      } catch (err) {
        console.warn(
          `[refresh recovery] ${integration.providerIdentifier} (${
            integration.id
          }) still failing: ${err instanceof Error ? err.message : String(err)}`
        );
        return false;
      }
      if (!refresh || !refresh.accessToken) {
        return false;
      }

      const recovered = await this._integrationService.refreshRecoveredIfCurrent(
        integration.organizationId,
        integration.id,
        integration.revision,
        refresh
      );
      if (!recovered) {
        return false;
      }
      if (socialProvider.oneTimeToken) {
        await this._integrationService.refreshLinkedTokensIfCurrent(
          integration.organizationId,
          integration.id,
          integration.rootInternalId,
          integration.refreshToken,
          siblings,
          refresh
        );
      }
      await this.startRefreshWorkflow(
        integration.organizationId,
        integration.id,
        true
      );
      return true;
    } finally {
      await this.releaseRefreshLock(integration.id, lock.token);
    }
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

  /**
   * Only a definitive credential rejection (revoked/expired refresh token,
   * missing scopes, invalid_grant) should send the user back through OAuth.
   * Everything else — DNS/network errors, provider 5xx, timeouts, HTML error
   * pages, SDK parse failures — is transient and must be retried, never turned
   * into a permanent "reconnect your channel".
   */
  private isPermanentRefreshError(err: unknown): boolean {
    if (err instanceof RefreshToken || err instanceof NotEnoughScopes) {
      return true;
    }
    const anyErr = err as any;
    const type = anyErr?.type ?? anyErr?.cause?.type;
    if (type === 'refresh_token' || type === 'not_enough_scopes') {
      return true;
    }
    const message = `${anyErr?.message ?? ''} ${
      anyErr?.cause?.message ?? ''
    }`;
    return /invalid_grant|invalid_token|token.*revoked|revoked.*token|access_token_invalid|invalid credentials|not enough scopes|invalid authentication credentials/i.test(
      message
    );
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
      // No credentials came back. That alone is not proof the token was
      // revoked, so throw (=> transient => deferred retry) instead of
      // returning false (=> permanent => forced reconnect). A provider that
      // detects a real rejection throws a typed error before it reaches here.
      throw new Error(
        `${integration.providerIdentifier} refresh returned no access token`
      );
    }

    if (
      !socialProvider.reConnect ||
      integration.rootInternalId === integration.internalId
    ) {
      return refresh;
    }

    // `reConnect` only re-resolves the provider-side id/name/picture — none of
    // which this service persists (refreshSucceededIfCurrent writes credentials
    // only). It must therefore never be allowed to invalidate an otherwise-good
    // refresh. YouTube is the live example: `reConnect` matches the selected
    // channel against `channels.list({ mine: true })`, which does not always
    // return brand-account channels, so it threw "Channel not found" and the
    // channel was marked as needing a reconnect roughly every other day even
    // though the freshly minted access token was perfectly valid.
    try {
      const reConnect = await socialProvider.reConnect(
        integration.rootInternalId!,
        integration.internalId,
        refresh.accessToken
      );

      return {
        ...refresh,
        ...reConnect,
      };
    } catch (err) {
      console.warn(
        `[refresh] reConnect failed for ${integration.providerIdentifier} ` +
          `(${integration.id}) — keeping refreshed credentials`,
        err
      );
      return refresh;
    }
  }
}
