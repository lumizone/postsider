import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { RefreshIntegrationService } from '@postsider/nestjs-libraries/integrations/refresh.integration.service';

@Injectable()
@Activity()
export class IntegrationsActivity {
  constructor(
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  /**
   * Daily best-effort sweep: retry the provider exchange for channels flagged
   * `refreshNeeded` and clear the flag on success, so a channel pushed into a
   * manual reconnect by a transient fault heals on its own. One channel's
   * failure never aborts the sweep.
   */
  @ActivityMethod()
  async recoverStuckRefreshes(
    limit = 200
  ): Promise<{ attempted: number; recovered: number }> {
    const candidates =
      await this._integrationService.findRefreshNeededForRecovery(limit);
    let recovered = 0;
    for (const candidate of candidates) {
      try {
        const integration = await this._integrationService.getIntegrationById(
          candidate.organizationId,
          candidate.id
        );
        if (!integration) continue;
        if (await this._refreshIntegrationService.recoverOnce(integration)) {
          recovered++;
        }
      } catch {
        // A single channel (provider outage, decrypt error) must not stop the
        // rest of the sweep.
      }
    }
    return { attempted: candidates.length, recovered };
  }

  @ActivityMethod()
  async getIntegrationsById(id: string, orgId: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  /**
   * Same lookup without the OAuth secrets, for workflow code.
   *
   * Refresh workflows V2 and V3 only need scheduling/lifecycle fields
   * (tokenExpiration, refreshNeeded, deletedAt, inBetweenSteps); handing it the
   * token would write a plaintext copy into Temporal's event history on every
   * loop, which is exactly what the v2 workflow exists to stop.
   */
  @ActivityMethod()
  async getIntegrationsSafeById(id: string, orgId: string) {
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      id
    );
    if (!integration) return integration;
    const { token, refreshToken, customInstanceDetails, ...safe } =
      integration as any;
    return safe;
  }

  // NOTE: this class used to declare an UNDECORATED `refreshToken(integration)`
  // that was never registered as an activity — refreshTokenWorkflow's
  // `refreshToken` call has always resolved, by name, to
  // PostActivity.refreshToken. The dead method was removed (2026-07-22 audit)
  // so nobody "fixes" it with @ActivityMethod() one day and silently swaps the
  // battle-tested implementation for one that never ran. The workflow's proxy
  // typing now points at PostActivity explicitly.
}
