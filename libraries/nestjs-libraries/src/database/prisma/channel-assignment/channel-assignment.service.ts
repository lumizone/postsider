import { Injectable } from '@nestjs/common';
import { ChannelAssignmentRepository } from './channel-assignment.repository';

@Injectable()
export class ChannelAssignmentService {
  constructor(private _repo: ChannelAssignmentRepository) {}

  listForIntegration(orgId: string, integrationId: string) {
    return this._repo.listForIntegration(orgId, integrationId);
  }

  listIntegrationIdsForUser(orgId: string, userId: string) {
    return this._repo.listIntegrationIdsForUser(orgId, userId);
  }

  listForOrg(orgId: string) {
    return this._repo.listForOrg(orgId);
  }

  setForIntegration(orgId: string, integrationId: string, userIds: string[]) {
    return this._repo.setForIntegration(orgId, integrationId, userIds);
  }
}
