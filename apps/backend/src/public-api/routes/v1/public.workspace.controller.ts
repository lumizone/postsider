import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as Sentry from '@sentry/nestjs';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { PermissionsService } from '@postsider/backend/services/auth/permissions/permissions.service';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { ChannelCapacityExceededError } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.repository';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { MediaService } from '@postsider/nestjs-libraries/database/prisma/media/media.service';
import { ComposerHelpersService } from '@postsider/nestjs-libraries/database/prisma/composer-helpers/composer-helpers.service';
import { SmartSlotsService } from '@postsider/nestjs-libraries/smart-slots/smart-slots.service';
import {
  NoCheckerConfigError,
  PostCheckerService,
} from '@postsider/nestjs-libraries/post-checker/post-checker.service';
import { AiQuotaExceededError } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { IntegrationTimeDto } from '@postsider/nestjs-libraries/dtos/integrations/integration.time.dto';
import {
  UpsertCaptionTemplateDto,
  UpsertHashtagGroupDto,
  UpsertUtmPresetDto,
} from '@postsider/nestjs-libraries/dtos/composer-helpers/composer-helpers.dto';
import { CheckPostDto } from '@postsider/nestjs-libraries/dtos/post-checker/check.post.dto';
import { RewritePostDto } from '@postsider/nestjs-libraries/dtos/post-checker/rewrite.post.dto';
import { isBillingEnabled } from '@postsider/nestjs-libraries/services/billing.flag';

const LIBRARY_KINDS = ['hashtag-groups', 'caption-templates', 'utm-presets'] as const;
type LibraryKind = (typeof LIBRARY_KINDS)[number];

/**
 * Workspace management over the Public API: channel configuration, the content
 * library, post duplication, AI checks and media deletion. Everything the
 * dashboard does for day-to-day publishing that an API-key or MCP client could
 * not do before. Billing, team, API keys, MFA and account deletion are
 * deliberately NOT here: they stay dashboard-only.
 */
@ApiTags('Public API')
@Controller('/public/v1')
export class PublicWorkspaceController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _mediaService: MediaService,
    private _composerHelpers: ComposerHelpersService,
    private _smartSlots: SmartSlotsService,
    private _postChecker: PostCheckerService,
    private _permissionsService: PermissionsService
  ) {}

  /** ADMIN or above. API keys act as SUPERADMIN; OAuth tokens carry the member's real role. */
  private assertAdmin(org: Organization) {
    const role = (org as any).users?.[0]?.role;
    if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
      throw new HttpException(
        { msg: 'This action needs an ADMIN or owner role.' },
        HttpStatus.FORBIDDEN
      );
    }
  }

  private async requireChannel(orgId: string, id: string) {
    const channel = await this._integrationService.getIntegrationById(orgId, id);
    if (!channel || channel.deletedAt) {
      throw new HttpException({ msg: 'Channel not found' }, 404);
    }
    return channel;
  }

  // Channels -----------------------------------------------------------------

  @Post('/integrations/:id/disable')
  async disableChannel(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    this.assertAdmin(org);
    await this.requireChannel(org.id, id);
    await this._integrationService.disableChannel(org.id, id);
    return { id, disabled: true };
  }

  @Post('/integrations/:id/enable')
  async enableChannel(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    this.assertAdmin(org);
    await this.requireChannel(org.id, id);
    const activeChannelLimit = isBillingEnabled()
      ? (await this._permissionsService.getPackageOptions(org.id)).subscription
          ?.totalChannels || 0
      : undefined;
    try {
      await this._integrationService.enableChannel(org.id, id, activeChannelLimit);
    } catch (error) {
      if (error instanceof ChannelCapacityExceededError) {
        throw new SubscriptionException({
          section: Sections.CHANNEL,
          action: AuthorizationActions.Create,
        });
      }
      throw error;
    }
    return { id, disabled: false };
  }

  @Get('/integrations/:id/queue-plan')
  async getQueuePlan(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this.queuePlanOf(org, await this.requireChannel(org.id, id));
  }

  @Put('/integrations/:id/queue-plan')
  async setQueuePlan(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: IntegrationTimeDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    this.assertAdmin(org);
    await this.requireChannel(org.id, id);
    await this._integrationService.setTimes(org.id, id, body);
    return this.queuePlanOf(org, await this.requireChannel(org.id, id));
  }

  private queuePlanOf(org: Organization, channel: any) {
    return {
      slots: channel.postingTimes ? JSON.parse(channel.postingTimes) : [],
      timezone: channel.timezone ?? (org as any).defaultTimezone ?? 'UTC',
    };
  }

  @Get('/integrations/:id/smart-slots')
  async smartSlots(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Query('count') rawCount?: unknown
  ) {
    const count = typeof rawCount === 'string' ? rawCount : undefined;
    Sentry.metrics.count('public_api-request', 1);
    const channel = await this.requireChannel(org.id, id);
    const n = count === undefined ? 3 : Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new HttpException({ msg: 'count must be an integer between 1 and 10' }, 400);
    }
    return this._smartSlots.suggest(org.id, id, channel.providerIdentifier, n);
  }

  /** Assign the channel to a client (customer) by name; empty name unassigns. */
  @Put('/integrations/:id/customer')
  async setChannelCustomer(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { name?: string | null }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    this.assertAdmin(org);
    await this.requireChannel(org.id, id);
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';
    await this._integrationService.updateOnCustomerName(org.id, id, name);
    // Never return the integration row: it carries the channel's OAuth tokens.
    return { id, customer: name || null };
  }

  // Content library ----------------------------------------------------------

  @Get('/library')
  async getLibrary(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    const [hashtagGroups, captionTemplates, utmPresets] = await Promise.all([
      this._composerHelpers.listHashtagGroups(org.id),
      this._composerHelpers.listCaptionTemplates(org.id),
      this._composerHelpers.listUtmPresets(org.id),
    ]);
    return { hashtagGroups, captionTemplates, utmPresets };
  }

  private kindOf(kind: string): LibraryKind {
    if (!(LIBRARY_KINDS as readonly string[]).includes(kind)) {
      throw new HttpException(
        { msg: `Unknown library kind. Use one of: ${LIBRARY_KINDS.join(', ')}` },
        400
      );
    }
    return kind as LibraryKind;
  }

  /** Validate the body against the right DTO, exactly as the dashboard does. */
  private async dtoFor(kind: LibraryKind, body: any) {
    const { plainToInstance } = await import('class-transformer');
    const { validate } = await import('class-validator');
    const cls =
      kind === 'hashtag-groups'
        ? UpsertHashtagGroupDto
        : kind === 'caption-templates'
        ? UpsertCaptionTemplateDto
        : UpsertUtmPresetDto;
    const dto = plainToInstance(cls as any, body ?? {}) as any;
    const errors = await validate(dto, { whitelist: true });
    if (errors.length) {
      throw new HttpException(
        {
          msg: errors
            .flatMap((e) => Object.values(e.constraints ?? {}))
            .join('; '),
        },
        400
      );
    }
    return dto;
  }

  @Post('/library/:kind')
  async createLibraryItem(
    @GetOrgFromRequest() org: Organization,
    @Param('kind') kind: string,
    @Body() body: any
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const k = this.kindOf(kind);
    const dto = await this.dtoFor(k, body);
    return k === 'hashtag-groups'
      ? this._composerHelpers.createHashtagGroup(org.id, dto)
      : k === 'caption-templates'
      ? this._composerHelpers.createCaptionTemplate(org.id, dto)
      : this._composerHelpers.createUtmPreset(org.id, dto);
  }

  @Put('/library/:kind/:id')
  async updateLibraryItem(
    @GetOrgFromRequest() org: Organization,
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Body() body: any
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const k = this.kindOf(kind);
    const dto = await this.dtoFor(k, body);
    return k === 'hashtag-groups'
      ? this._composerHelpers.updateHashtagGroup(org.id, id, dto)
      : k === 'caption-templates'
      ? this._composerHelpers.updateCaptionTemplate(org.id, id, dto)
      : this._composerHelpers.updateUtmPreset(org.id, id, dto);
  }

  @Delete('/library/:kind/:id')
  async deleteLibraryItem(
    @GetOrgFromRequest() org: Organization,
    @Param('kind') kind: string,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const k = this.kindOf(kind);
    return k === 'hashtag-groups'
      ? this._composerHelpers.deleteHashtagGroup(org.id, id)
      : k === 'caption-templates'
      ? this._composerHelpers.deleteCaptionTemplate(org.id, id)
      : this._composerHelpers.deleteUtmPreset(org.id, id);
  }

  // Posts --------------------------------------------------------------------

  /** Copy a post as a new draft, optionally onto another channel and date. */
  @Post('/posts/:id/duplicate')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async duplicatePost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { channelId?: string; date?: string }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    // Body ids reach Prisma `where` clauses: an object here would be read as a
    // filter ({contains: ''} matches any channel of the org), so require strings.
    const channelId = typeof body?.channelId === 'string' ? body.channelId : undefined;
    const date = typeof body?.date === 'string' ? body.date : undefined;
    if (
      (body?.channelId !== undefined && channelId === undefined) ||
      (body?.date !== undefined && date === undefined)
    ) {
      throw new HttpException({ msg: 'channelId and date must be strings' }, 400);
    }
    const source = await this._postsService.getPost(org.id, id);
    return this._postsService.duplicatePost(org.id, source.group, channelId, date);
  }

  @Post('/posts/check')
  async checkPost(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CheckPostDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    try {
      return await this._postChecker.check(
        org.id,
        { content: body.content, hasMedia: body.hasMedia, mediaType: body.mediaType },
        body.platforms
      );
    } catch (e) {
      throw this.aiError(e);
    }
  }

  @Post('/posts/rewrite')
  async rewritePost(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RewritePostDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    try {
      return await this._postChecker.rewrite(org.id, {
        content: body.content,
        tone: body.tone as any,
        count: body.count,
        platform: body.platform,
      });
    } catch (e) {
      throw this.aiError(e);
    }
  }

  private aiError(e: unknown) {
    if (e instanceof NoCheckerConfigError) {
      return new HttpException({ msg: 'No AI key configured' }, HttpStatus.CONFLICT);
    }
    if (e instanceof AiQuotaExceededError) {
      return new HttpException(
        { section: Sections.AI, msg: 'AI usage limit reached for this plan' },
        HttpStatus.PAYMENT_REQUIRED
      );
    }
    return e;
  }

  // Media --------------------------------------------------------------------

  @Delete('/media/:id')
  async deleteMedia(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const existing = await this._mediaService.getMediaById(id, org.id);
    if (!existing) {
      throw new HttpException({ msg: 'Media not found' }, 404);
    }
    await this._mediaService.deleteMedia(org.id, id);
    return { deleted: true, id };
  }
}
