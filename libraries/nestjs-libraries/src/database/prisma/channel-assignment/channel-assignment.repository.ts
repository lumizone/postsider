import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class ChannelAssignmentRepository {
  constructor(private _assignment: PrismaRepository<'channelAssignment'>) {}

  listForIntegration(orgId: string, integrationId: string) {
    return this._assignment.model.channelAssignment.findMany({
      where: { organizationId: orgId, integrationId },
      select: {
        userId: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /** All integration ids this user is scoped to (empty = unrestricted). */
  async listIntegrationIdsForUser(
    orgId: string,
    userId: string
  ): Promise<string[]> {
    const rows = await this._assignment.model.channelAssignment.findMany({
      where: { organizationId: orgId, userId },
      select: { integrationId: true },
    });
    return rows.map((r) => r.integrationId);
  }

  /** Full assignment matrix for the settings page: integrationId -> userIds. */
  async listForOrg(orgId: string) {
    return this._assignment.model.channelAssignment.findMany({
      where: { organizationId: orgId },
      select: { integrationId: true, userId: true },
    });
  }

  /** Replaces the full assigned-user set for one channel. */
  async setForIntegration(
    orgId: string,
    integrationId: string,
    userIds: string[]
  ) {
    await this._assignment.model.channelAssignment.deleteMany({
      where: { organizationId: orgId, integrationId },
    });
    if (userIds.length === 0) return [];
    return Promise.all(
      userIds.map((userId) =>
        this._assignment.model.channelAssignment.create({
          data: { organizationId: orgId, integrationId, userId },
        })
      )
    );
  }
}
