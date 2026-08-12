import { Body, Controller, Get, HttpException, Param, Post, Req } from '@nestjs/common';
import { SubscriptionService } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { PolarService } from '@postsider/nestjs-libraries/services/polar.service';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { BillingSubscribeDto } from '@postsider/nestjs-libraries/dtos/billing/billing.subscribe.dto';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { Request } from 'express';

@ApiTags('Billing')
@Controller('/billing')
export class BillingController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _polarService: PolarService,
    private _notificationService: NotificationService
  ) {}

  // Billing is owner-only: only the org's SUPERADMIN (the account that
  // created it, mirrors deleteAccount's "only the owner" gate below in
  // settings.controller.ts) can start a checkout, open the Polar customer
  // portal, or cancel the subscription. Plain ADMIN team members do not
  // manage billing. `Sections.ADMIN` via @CheckPolicies is the wrong tool
  // here — that ability check treats ADMIN and SUPERADMIN as equivalent
  // (see permissions.service.ts), so this is a manual role check instead,
  // same pattern deleteAccount already uses.
  private assertOwner(org: Organization) {
    // @ts-ignore — role is attached to org.users[0] by the auth middleware.
    if (org.users?.[0]?.role !== 'SUPERADMIN') {
      throw new HttpException('Only the account owner can manage billing', 403);
    }
  }

  @Get('/check/:id')
  async checkId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') body: string
  ) {
    return {
      status: await this._polarService.checkSubscription(org.id, body),
    };
  }

  @Get('/is-trial-finished')
  async isTrialFinished(@GetOrgFromRequest() org: Organization) {
    return {
      finished: !org.isTrailing,
    };
  }

  @Post('/embedded')
  embedded(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    this.assertOwner(org);
    const uniqueId = req?.cookies?.track;
    return this._polarService.embedded(
      uniqueId,
      org.id,
      user.id,
      body,
      org.allowTrial
    );
  }

  @Post('/subscribe')
  subscribe(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BillingSubscribeDto,
    @Req() req: Request
  ) {
    this.assertOwner(org);
    const uniqueId = req?.cookies?.track;
    return this._polarService.subscribe(
      uniqueId,
      org.id,
      user.id,
      body,
      org.allowTrial
    );
  }

  @Get('/portal')
  async modifyPayment(@GetOrgFromRequest() org: Organization) {
    this.assertOwner(org);
    const customerId = await this._polarService.getCustomerByOrganizationId(
      org.id
    );
    const { url } = await this._polarService.createBillingPortalLink(
      customerId,
      org.id
    );
    return { portal: url };
  }

  @Get('/')
  getCurrentBilling(@GetOrgFromRequest() org: Organization) {
    return this._subscriptionService.getSubscriptionByOrganizationId(org.id);
  }

  @Post('/cancel')
  async cancel(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: { feedback: string }
  ) {
    this.assertOwner(org);
    await this._notificationService.sendEmail(
      process.env.EMAIL_FROM_ADDRESS || '',
      'Subscription Cancelled',
      `Organization ${org.name} has cancelled their subscription because: ${body.feedback}`,
      user.email
    );

    return this._polarService.setToCancel(org.id);
  }

  @Post('/cancel-subscription')
  async cancelSubscription(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    this.assertOwner(org);

    return this._polarService.cancelSubscription(org.id);
  }

}
