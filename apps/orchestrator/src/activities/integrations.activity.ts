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

  // NOTE: this class used to declare an UNDECORATED `refreshToken(integration)`
  // that was never registered as an activity — refreshTokenWorkflow's
  // `refreshToken` call has always resolved, by name, to
  // PostActivity.refreshToken. The dead method was removed (2026-07-22 audit)
  // so nobody "fixes" it with @ActivityMethod() one day and silently swaps the
  // battle-tested implementation for one that never ran. The workflow's proxy
  // typing now points at PostActivity explicitly.
}
