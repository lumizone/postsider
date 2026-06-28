import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class EvergreenRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _evergreenSettings: PrismaRepository<'evergreenSettings'>
  ) {}

  listEvergreen(orgId: string) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        evergreen: true,
        deletedAt: null,
      },
      select: {
        id: true,
        group: true,
        content: true,
        lastRecycledAt: true,
      },
    });
  }

  setEvergreen(orgId: string, group: string, on: boolean) {
    return this._post.model.post.updateMany({
      where: {
        organizationId: orgId,
        group,
        deletedAt: null,
      },
      data: {
        evergreen: on,
      },
    });
  }

  markRecycled(id: string, when: Date) {
    return this._post.model.post.update({
      where: {
        id,
      },
      data: {
        lastRecycledAt: when,
      },
    });
  }

  getSettings(orgId: string) {
    return this._evergreenSettings.model.evergreenSettings.findUnique({
      where: {
        organizationId: orgId,
      },
    });
  }

  upsertSettings(
    orgId: string,
    data: { enabled: boolean; intervalDays: number; maxPerRun: number }
  ) {
    return this._evergreenSettings.model.evergreenSettings.upsert({
      where: {
        organizationId: orgId,
      },
      update: data,
      create: {
        organizationId: orgId,
        ...data,
      },
    });
  }

  listEnabledOrgs() {
    return this._evergreenSettings.model.evergreenSettings.findMany({
      where: {
        enabled: true,
      },
    });
  }
}
