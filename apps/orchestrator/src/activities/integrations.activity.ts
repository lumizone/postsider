import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';

@Injectable()
@Activity()
export class IntegrationsActivity {
  constructor(private _integrationService: IntegrationService) {}

  @ActivityMethod()
  async getIntegrationsById(id: string, orgId: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  /**
   * Same lookup without the OAuth secrets, for workflow code.
   *
   * `refreshTokenWorkflowV2` only needs the scheduling fields
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
