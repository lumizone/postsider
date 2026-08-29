import { Injectable } from '@nestjs/common';
import { WebhooksRepository } from '@postsider/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksDto } from '@postsider/nestjs-libraries/dtos/webhooks/webhooks.dto';

@Injectable()
export class WebhooksService {
  constructor(private _webhooksRepository: WebhooksRepository) {}

  getTotal(orgId: string) {
    return this._webhooksRepository.getTotal(orgId);
  }

  getWebhooks(orgId: string) {
    return this._webhooksRepository.getWebhooks(orgId);
  }

  getWebhooksForDelivery(orgId: string) {
    return this._webhooksRepository.getWebhooksForDelivery(orgId);
  }

  createWebhook(orgId: string, body: WebhooksDto) {
    return this._webhooksRepository.createWebhook(orgId, body);
  }

  updateWebhook(orgId: string, body: WebhooksDto) {
    return this._webhooksRepository.updateWebhook(orgId, body);
  }

  deleteWebhook(orgId: string, id: string) {
    return this._webhooksRepository.deleteWebhook(orgId, id);
  }
}
