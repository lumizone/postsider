import { Controller, Delete, Get, Query } from '@nestjs/common';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Notifications')
@Controller('/notifications')
export class NotificationsController {
  constructor(private _notificationsService: NotificationService) {}
  @Get('/')
  async mainPageList(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    return this._notificationsService.getMainPageCount(
      organization.id,
      user.id
    );
  }

  @Delete('/')
  async clear(@GetOrgFromRequest() organization: Organization) {
    const { count } = await this._notificationsService.clearNotifications(
      organization.id
    );
    return { cleared: count };
  }

  @Get('/list')
  async notifications(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    return this._notificationsService.getNotifications(
      organization.id,
      user.id
    );
  }

  /**
   * Full history behind the bell's "see all". `/list` is capped at 10, which
   * is right for a dropdown and useless for an org that has accumulated
   * hundreds of them.
   */
  @Get('/page')
  async notificationsPage(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Query('page') page?: string
  ) {
    const parsed = Number.parseInt(page ?? '0', 10);
    const safePage =
      Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 0;
    return this._notificationsService.getNotificationsPageForUser(
      organization.id,
      user.id,
      safePage
    );
  }
}
