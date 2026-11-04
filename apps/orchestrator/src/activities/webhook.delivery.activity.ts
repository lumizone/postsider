import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { PublicWebhookDeliveryService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-delivery.service';

@Injectable()
@Activity()
export class WebhookDeliveryActivity {
  constructor(private _delivery: PublicWebhookDeliveryService) {}

  @ActivityMethod()
  async processDueWebhookDeliveries(): Promise<{
    claimed: number;
    succeeded: number;
    retried: number;
    failed: number;
  }> {
    return this._delivery.processDue();
  }
}
