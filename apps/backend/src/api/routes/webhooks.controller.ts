import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from '@postsider/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import {
  OnlyURL, UpdateDto, WebhooksDto
} from '@postsider/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { AuthorizationActions, Sections } from '@postsider/backend/services/auth/permissions/permission.exception.class';

@ApiTags('Webhooks')
@Controller('/webhooks')
export class WebhookController {
  constructor(private _webhooksService: WebhooksService) {}

  @Get('/')
  async getStatistics(@GetOrgFromRequest() org: Organization) {
    return this._webhooksService.getWebhooks(org.id);
  }

  @Post('/')
  async createAWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: WebhooksDto
  ) {
    return this._webhooksService.createWebhook(org.id, body);
  }

  @Put('/')
  async updateWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpdateDto
  ) {
    return this._webhooksService.createWebhook(org.id, body);
  }

  @Delete('/:id')
  async deleteWebhook(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._webhooksService.deleteWebhook(org.id, id);
  }

  @Post('/send')
  async sendWebhook(@Body() body: any, @Query() query: OnlyURL) {
    // Validate the target URL to prevent SSRF attacks (unlike OSS which allows any URL)
    const url = new URL(query.url);
    const blockedProtocols = ['file:', 'ftp:', 'data:', 'javascript:'];
    if (blockedProtocols.includes(url.protocol)) {
      return { send: false, error: 'Blocked protocol' };
    }

    try {
      const { ssrfSafeDispatcher } = await import(
        '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher'
      );
      await fetch(query.url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        // @ts-ignore - undici dispatcher
        dispatcher: ssrfSafeDispatcher,
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      /** sent **/
    }

    return { send: true };
  }
}
