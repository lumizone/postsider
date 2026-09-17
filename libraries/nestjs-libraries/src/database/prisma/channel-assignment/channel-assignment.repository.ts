import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class ChannelAssignmentRepository {
  constructor(
    private _assignment: PrismaRepository<'channelAssignment'>,
    private _userOrg: PrismaRepository<'userOrganization'>
  ) {}

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

  /**
   * Replaces the full assigned-user set for one channel.
   *
   * Only users who are members of `orgId` are accepted. The row itself is
   * org-scoped, but without this check an org admin could assign an arbitrary
   * global user id and then read that user's name/email back through
   * `listForIntegration` — a cross-tenant PII leak.
   */
  async setForIntegration(
    orgId: string,
    integrationId: string,
    userIds: string[]
  ) {
    const requested = [...new Set(userIds)];
    let memberUserIds: string[] = [];
    if (requested.length) {
      const members = await this._userOrg.model.userOrganization.findMany({
        where: { organizationId: orgId, userId: { in: requested } },
        select: { userId: true },
      });
      const allowed = new Set(members.map((member) => member.userId));
      memberUserIds = requested.filter((id) => allowed.has(id));
    }

    await this._assignment.model.channelAssignment.deleteMany({
      where: { organizationId: orgId, integrationId },
    });
    if (memberUserIds.length === 0) return [];
    return Promise.all(
      memberUserIds.map((userId) =>
        this._assignment.model.channelAssignment.create({
          data: { organizationId: orgId, integrationId, userId },
        })
      )
    );
  }
}
