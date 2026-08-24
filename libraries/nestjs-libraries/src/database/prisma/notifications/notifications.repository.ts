import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationsRepository {
  constructor(
    private _notifications: PrismaRepository<'notifications'>,
    private _user: PrismaRepository<'user'>
  ) {}

  getLastReadNotification(userId: string) {
    return this._user.model.user.findFirst({
      where: {
        id: userId,
      },
      select: {
        lastReadNotifications: true,
      },
    });
  }

  async getMainPageCount(organizationId: string, userId: string) {
    const { lastReadNotifications } = (await this.getLastReadNotification(
      userId
    ))!;

    return {
      total: await this._notifications.model.notifications.count({
        where: {
          organizationId,
          // Soft-deleted notifications must not inflate the unread count.
          deletedAt: null,
          createdAt: {
            gt: lastReadNotifications!,
          },
        },
      }),
    };
  }

  /**
   * Clear the organization's notification list (soft delete, so nothing is
   * actually lost). Org-wide by design: the list itself is org-wide, every
   * member sees the same entries.
   */
  async clearNotifications(organizationId: string) {
    return this._notifications.model.notifications.updateMany({
      where: {
        organizationId,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async createNotification(
    organizationId: string,
    content: string,
    link?: string,
    event?: { key: string; params?: Record<string, string> }
  ) {
    await this._notifications.model.notifications.create({
      data: {
        organizationId,
        content,
        ...(event
          ? {
              eventKey: event.key,
              eventParams: JSON.stringify(event.params ?? {}),
            }
          : {}),
        // The column existed from the start but nothing ever wrote it, so every
        // notification was a dead end: "reconnect your channel" with no way to
        // get there. Customers are the audience here, not us — they should not
        // have to work out which page fixes it.
        ...(link ? { link } : {}),
      },
    });
  }

  async getNotificationsSince(organizationId: string, since: string) {
    return this._notifications.model.notifications.findMany({
      where: {
        organizationId,
        deletedAt: null,
        createdAt: {
          gte: new Date(since),
        },
      },
    });
  }

  async getNotificationsPaginated(organizationId: string, page: number) {
    const limit = 100;
    const skip = page * limit;

    const where = {
      organizationId,
      deletedAt: null as Date | null,
    };

    const [notifications, total] = await Promise.all([
      this._notifications.model.notifications.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: {
          id: true,
          content: true,
          link: true,
          createdAt: true,
        },
      }),
      this._notifications.model.notifications.count({ where }),
    ]);

    return {
      notifications,
      total,
      page,
      limit,
      hasMore: skip + notifications.length < total,
    };
  }

  async getNotifications(organizationId: string, userId: string) {
    const { lastReadNotifications } = (await this.getLastReadNotification(
      userId
    ))!;

    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        lastReadNotifications: new Date(),
      },
    });

    return {
      lastReadNotifications,
      notifications: await this._notifications.model.notifications.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
        where: {
          organizationId,
          // Match getMainPageCount, which already excludes these — otherwise a
          // soft-deleted notification is missing from the badge but still
          // rendered in the list.
          deletedAt: null,
        },
        select: {
          createdAt: true,
          content: true,
          link: true,
          eventKey: true,
          eventParams: true,
        },
      }),
    };
  }
}
