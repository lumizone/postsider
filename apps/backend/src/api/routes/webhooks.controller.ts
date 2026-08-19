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
  @CheckPolicies([AuthorizationActions.Read, Sections.ADMIN])
  async getStatistics(@GetOrgFromRequest() org: Organization) {
    return this._webhooksService.getWebhooks(org.id);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async createAWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: WebhooksDto
  ) {
    return this._webhooksService.createWebhook(org.id, body);
  }

  @Put('/')
  @CheckPolicies([AuthorizationActions.Update, Sections.ADMIN])
  async updateWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpdateDto
  ) {
    return this._webhooksService.createWebhook(org.id, body);
  }

  @Delete('/:id')
  @CheckPolicies([AuthorizationActions.Delete, Sections.ADMIN])
  async deleteWebhook(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._webhooksService.deleteWebhook(org.id, id);
  }

  @Post('/send')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async sendWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: any,
    @Query() query: OnlyURL
  ) {
    // Validate the target URL to prevent SSRF attacks (unlike OSS which allows any URL)
    const url = new URL(query.url);
    const blockedProtocols = ['file:', 'ftp:', 'data:', 'javascript:'];
    if (blockedProtocols.includes(url.protocol)) {
      return { send: false, error: 'Blocked protocol' };
    }

    // Report the REAL outcome. This used to return { send: true } even when
    // the fetch threw — a user validating a broken/unreachable URL was told it
    // works, then wondered why deliveries never arrived.
    try {
      // Relative, not the `@postsider/*` alias: `nest build` only rewrites path
      // aliases in static imports, so an aliased dynamic import fails to
      // resolve at runtime (it made this endpoint report every URL as broken).
      const { ssrfSafeDispatcher } = await import(
        '../../../../../libraries/nestjs-libraries/src/dtos/webhooks/ssrf.safe.dispatcher'
      );
      const res = await fetch(query.url, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        // @ts-ignore - undici dispatcher
        dispatcher: ssrfSafeDispatcher,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return { send: false, error: `Endpoint responded with HTTP ${res.status}` };
      }
      return { send: true };
    } catch (err) {
      return {
        send: false,
        error: err instanceof Error ? err.message : 'Request failed',
      };
    }
  }
}
