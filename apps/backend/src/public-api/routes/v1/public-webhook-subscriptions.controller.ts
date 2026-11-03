import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import {
  CreatePublicWebhookSubscriptionDto,
  UpdatePublicWebhookSubscriptionDto,
} from '@postsider/nestjs-libraries/dtos/webhooks/public-webhook-subscription.dto';
import { PublicWebhookSubscriptionsService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-subscriptions.service';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';
import { RequirePublicApiScopes } from '@postsider/backend/services/auth/public-api-scope.decorator';
import {
  PUBLIC_WEBHOOK_EVENTS,
  PUBLIC_WEBHOOK_EVENT_SAMPLES,
} from '@postsider/nestjs-libraries/services/public-webhook-events';

@ApiTags('Public API Webhooks')
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Raw PostSider API key or Bearer OAuth access token',
})
@Controller('/public/v1/webhook-subscriptions')
@UseGuards(PublicApiScopeGuard)
export class PublicWebhookSubscriptionsController {
  constructor(
    private readonly subscriptions: PublicWebhookSubscriptionsService
  ) {}

  @Get()
  @RequirePublicApiScopes('webhooks:read')
  list(@GetOrgFromRequest() organization: Organization) {
    return this.subscriptions.list(organization.id);
  }

  @Get('/events')
  @RequirePublicApiScopes('webhooks:read')
  events(@GetOrgFromRequest() organization: Organization) {
    return PUBLIC_WEBHOOK_EVENTS.map((event) => ({
      event,
      sample: {
        id: 'evt_example',
        event,
        createdAt: '2026-01-01T00:00:00.000Z',
        organizationId: organization.id,
        data: PUBLIC_WEBHOOK_EVENT_SAMPLES[event],
      },
    }));
  }

  @Get('/:id')
  @RequirePublicApiScopes('webhooks:read')
  get(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string
  ) {
    return this.subscriptions.get(organization.id, id);
  }

  @Post()
  @RequirePublicApiScopes('webhooks:write')
  create(
    @GetOrgFromRequest() organization: Organization,
    @Body() body: CreatePublicWebhookSubscriptionDto
  ) {
    return this.subscriptions.create(organization.id, body);
  }

  @Put('/:id')
  @RequirePublicApiScopes('webhooks:write')
  update(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Body() body: UpdatePublicWebhookSubscriptionDto
  ) {
    return this.subscriptions.update(organization.id, id, body);
  }

  @Post('/:id/rotate-secret')
  @RequirePublicApiScopes('webhooks:write')
  rotateSecret(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string
  ) {
    return this.subscriptions.rotateSecret(organization.id, id);
  }

  @Delete('/:id')
  @RequirePublicApiScopes('webhooks:write')
  delete(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string
  ) {
    return this.subscriptions.delete(organization.id, id);
  }
}
