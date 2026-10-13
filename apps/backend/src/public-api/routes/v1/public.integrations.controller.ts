import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Headers,
  UploadedFile,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { CustomFileValidationPipe } from '@postsider/nestjs-libraries/upload/custom.upload.validation';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { uploadInterceptorOptions, maxUploadBytesForMime } from '@postsider/nestjs-libraries/upload/upload.limits';
import { UploadFactory } from '@postsider/nestjs-libraries/upload/upload.factory';
import { probeDimensions } from '@postsider/nestjs-libraries/upload/probe-dimensions';
import { MediaService } from '@postsider/nestjs-libraries/database/prisma/media/media.service';
import { GetPostsDto } from '@postsider/nestjs-libraries/dtos/posts/get.posts.dto';
import { ChangePostStatusDto } from '@postsider/nestjs-libraries/dtos/posts/change.post.status.dto';
import {
  AuthorizationActions,
  Sections,
} from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { UploadDto } from '@postsider/nestjs-libraries/dtos/media/upload.dto';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { GetNotificationsDto } from '@postsider/nestjs-libraries/dtos/notifications/get.notifications.dto';
import { Readable } from 'stream';
import { ssrfSafeDispatcher } from '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { detectFileType } from '@postsider/nestjs-libraries/upload/detect-file-type';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';

const PUBLIC_API_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
]);
// Inline base64 uploads travel through the JSON body parser (50 MB) and the
// model context, so they are capped well below the multipart limit.
const BASE64_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
import * as Sentry from '@sentry/nestjs';
import {
  socialIntegrationList,
  IntegrationManager,
} from '@postsider/nestjs-libraries/integrations/integration.manager';
import { getValidationSchemas } from '@postsider/nestjs-libraries/chat/validation.schemas.helper';
import { RefreshIntegrationService } from '@postsider/nestjs-libraries/integrations/refresh.integration.service';
import { RefreshToken } from '@postsider/nestjs-libraries/integrations/social.abstract';
import { PostValidationException } from '@postsider/backend/api/routes/posts.validation.exception';
import { timer } from '@postsider/helpers/utils/timer';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { PublicApiIdempotencyService } from '@postsider/nestjs-libraries/database/prisma/idempotency/public-api-idempotency.service';
import { AgencyOverviewService } from '@postsider/nestjs-libraries/database/prisma/agency/agency-overview.service';
import { CustomerReportService } from '@postsider/nestjs-libraries/database/prisma/agency/customer-report.service';
import {
  RemoteMediaTooLargeError,
  withRemoteMediaPermit,
} from '@postsider/nestjs-libraries/upload/remote.response';

@ApiTags('Public API')
@Controller('/public/v1')
export class PublicIntegrationsController {
  private storage = UploadFactory.createStorage();

  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _mediaService: MediaService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _approvalService: ApprovalService,
    private _idempotency: PublicApiIdempotencyService,
    private _agencyOverview: AgencyOverviewService,
    private _customerReport: CustomerReportService
  ) {}

  @Post('/upload')
  @UseInterceptors(FileInterceptor('file', uploadInterceptorOptions))
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File
  ) {
    Sentry.metrics.count('public_api-request', 1);
    if (!file) {
      throw new HttpException({ msg: 'No file provided' }, 400);
    }

    const getFile = await this.storage.uploadFile(file);
    const { width, height, durationSeconds } = await probeDimensions(file);
    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      file.originalname,
      getFile.kind,
      file.size,
      width,
      height,
      durationSeconds
    );
  }

  @Post('/upload-from-url')
  async uploadsFromUrl(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UploadDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    try {
      return await withRemoteMediaPermit(async (readResponse) => {
        const response = await fetch(body.url, {
          // @ts-ignore — undici option, not in lib.dom fetch types
          dispatcher: ssrfSafeDispatcher,
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          throw new HttpException({ msg: 'Failed to fetch URL' }, 400);
        }
        const buffer = await readResponse(response);
        const detected = await detectFileType(buffer);
        if (!detected || !PUBLIC_API_ALLOWED_MIME.has(detected.mime)) {
          throw new HttpException({ msg: 'Unsupported file type.' }, 400);
        }
        const originalName = body.url.split('/').pop()?.split('?')[0] || undefined;
        return this.storeBuffer(org.id, buffer, detected, originalName);
      });
    } catch (error) {
      if (error instanceof RemoteMediaTooLargeError) {
        throw new HttpException({ msg: 'File too large' }, 413);
      }
      throw error;
    }
  }

  /** Persist an already-validated media buffer and record it in the library. */
  private async storeBuffer(
    orgId: string,
    buffer: Buffer,
    detected: { mime: string; ext: string },
    originalName?: string
  ) {
    const file = {
      buffer,
      mimetype: detected.mime,
      size: buffer.length,
      path: '',
      fieldname: '',
      destination: '',
      stream: new Readable(),
      filename: '',
      originalname: `upload.${detected.ext}`,
      encoding: '',
    } as Express.Multer.File;

    const getFile = await this.storage.uploadFile(file);
    const { width, height, durationSeconds } = await probeDimensions(file);

    return this._mediaService.saveFile(
      orgId,
      getFile.originalname,
      getFile.path,
      originalName,
      getFile.kind,
      buffer.length,
      width,
      height,
      durationSeconds
    );
  }

  /**
   * Upload a file sent inline as base64 (for agents that cannot make a
   * multipart request or host a public URL). Same type allow-list and size
   * caps as the other upload routes; the type is detected from the bytes.
   */
  @Post('/upload-base64')
  async uploadBase64(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { data?: string; filename?: string }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    if (typeof body?.data !== 'string' || !body.data) {
      throw new HttpException({ msg: '`data` (base64) is required' }, 400);
    }
    // Accept a data URL too: "data:image/png;base64,...."
    const raw = body.data.replace(/^data:[^;,]*;base64,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) {
      throw new HttpException({ msg: '`data` is not valid base64' }, 400);
    }
    // Decoded size = 3/4 of the base64 length; reject before allocating.
    if ((raw.length * 3) / 4 > BASE64_UPLOAD_MAX_BYTES) {
      throw new HttpException(
        {
          msg: `File too large for base64 upload (max ${
            BASE64_UPLOAD_MAX_BYTES / 1024 / 1024
          } MB). Use /upload (multipart) or /upload-from-url.`,
        },
        413
      );
    }
    const buffer = Buffer.from(raw, 'base64');
    const detected = await detectFileType(buffer);
    if (!detected || !PUBLIC_API_ALLOWED_MIME.has(detected.mime)) {
      throw new HttpException({ msg: 'Unsupported file type.' }, 400);
    }
    if (buffer.length > maxUploadBytesForMime(detected.mime)) {
      throw new HttpException({ msg: 'File too large' }, 413);
    }
    const name =
      typeof body.filename === 'string' && body.filename.trim()
        ? body.filename.trim().slice(0, 200)
        : undefined;
    return this.storeBuffer(org.id, buffer, detected, name);
  }

  /** Browse the media library so already-uploaded files can be reused. */
  @Get('/media')
  async listMedia(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page?: unknown,
    @Query('search') search?: unknown
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const parsed = Number(page);
    return this._mediaService.getMedia(
      org.id,
      Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1,
      typeof search === 'string' ? search.slice(0, 200) : undefined
    );
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  @Get('/posts')
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsDto,
    @Query('state') rawState?: unknown,
    @Query('integration') rawIntegration?: unknown,
    @Query('page') page?: unknown,
    @Query('limit') limit?: unknown
  ) {
    Sentry.metrics.count('public_api-request', 1);
    // Express parses `?state[x]=y` into an object; only plain strings are filters.
    const state = typeof rawState === 'string' ? rawState : undefined;
    const integration =
      typeof rawIntegration === 'string' ? rawIntegration : undefined;
    let posts = await this._postsService.getPosts(org.id, query);

    // Optional filters, applied after the date-range query. Without any of
    // them the response is exactly what it always was.
    if (state) {
      posts = posts.filter((p) => p.state === state.toUpperCase());
    }
    if (integration) {
      posts = posts.filter((p) => p.integration?.id === integration);
    }

    const parsedLimit = Math.floor(Number(limit));
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
      return { posts };
    }
    const pageSize = Math.min(parsedLimit, 200);
    const parsedPage = Math.floor(Number(page));
    const pageNumber =
      Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const start = (pageNumber - 1) * pageSize;
    return {
      posts: posts.slice(start, start + pageSize),
      total: posts.length,
      page: pageNumber,
      hasMore: start + pageSize < posts.length,
    };
  }

  @Get('/overview')
  async getAgencyOverview(
    @GetOrgFromRequest() org: Organization,
    @Query('days') days?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const parsedDays = Number(days);
    return this._agencyOverview.getOverview(
      org.id,
      Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30
    );
  }

  @Get('/customers/:customerId/report')
  async getCustomerReport(
    @GetOrgFromRequest() org: Organization,
    @Param('customerId') customerId: string,
    @Query('days') days?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const parsedDays = Number(days);
    return this._customerReport.getReport(
      org.id,
      customerId,
      Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30
    );
  }

  @Get('/posts/:id')
  async getPost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.getPost(org.id, id);
  }

  @Post('/posts')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any,
    @Headers('idempotency-key') idempotencyKey?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);

    const body = await this._postsService.mapTypeToPost(
      rawBody,
      org.id,
      // The third param is the "is draft" flag — a literal `|| true` made the
      // predicate dead (always draft). Pass the real predicate.
      rawBody?.type === 'draft'
    );
    body.type = rawBody.type;

    this.assertMediaDomains(body.posts);

    await this.assertPostsValid(org.id, body.posts, body.type);

    const allowedCreationMethods = ['CLI', 'API'] as const;
    const creationMethod = allowedCreationMethods.includes(
      rawBody.creationMethod
    )
      ? (rawBody.creationMethod as 'CLI' | 'API')
      : 'API';

    const claim = await this._idempotency.claim(org.id, idempotencyKey, rawBody);
    if (claim?.kind === 'replay') return claim.response;

    try {
      const result = await this._postsService.createPost(org.id, body, creationMethod);
      if (claim?.kind === 'new') await this._idempotency.complete(claim.id, result);
      return result;
    } catch (error) {
      if (claim?.kind === 'new') await this._idempotency.release(claim.id);
      throw error;
    }
  }

  /** Reject media outside RESTRICT_UPLOAD_DOMAINS (when configured). */
  private assertMediaDomains(posts: Array<{ value: Array<{ image?: Array<{ path: string }> }> }>) {
    if (
      process.env.RESTRICT_UPLOAD_DOMAINS &&
      posts.some((p) =>
        p.value.some((a) =>
          // A post created without media has no image array — don't throw.
          (a.image ?? []).some(
            (i) => i.path.indexOf(process.env.RESTRICT_UPLOAD_DOMAINS!) === -1
          )
        )
      )
    ) {
      throw new HttpException(
        {
          msg: `All media must be uploaded through our upload API route and contain the domain: ${process.env.RESTRICT_UPLOAD_DOMAINS}`,
        },
        400
      );
    }
  }

  /**
   * Server-side validation — same rules as the dashboard, surfaced as a
   * readable 400 (see PostValidationExceptionFilter).
   */
  private async assertPostsValid(
    orgId: string,
    posts: any[],
    type: 'draft' | 'schedule' | 'now' | 'update'
  ) {
    const validation = await this._postsService.validatePosts(
      orgId,
      posts,
      type
    );

    const fail = (item: (typeof validation)[number], error: string) => {
      throw new PostValidationException({
        provider: item.identifier,
        name: item.name,
        error,
      });
    };

    for (const item of validation) {
      if (item.emptyContent) {
        fail(
          item,
          'Your post should have at least one character or one image.'
        );
      }
    }

    if (type !== 'draft') {
      for (const item of validation) {
        if (!item.valid) {
          fail(item, item.settingsError || 'Please fix your settings');
        }
        if (item.errors !== true) {
          fail(item, item.errors as string);
        }
        if (item.tooLong) {
          fail(item, 'post is too long, please fix it');
        }
      }
    }
  }

  /**
   * Edit an existing post in place (content, media, date, settings, first
   * comment). Only the fields sent change. `PUBLISHED` and pending-approval
   * posts are rejected. A QUEUE post is re-armed exactly like a dashboard edit.
   */
  @Put('/posts/:id')
  async updatePost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() rawBody: any
  ) {
    Sentry.metrics.count('public_api-request', 1);

    const patch = {
      content:
        typeof rawBody?.content === 'string' ? rawBody.content : undefined,
      images: Array.isArray(rawBody?.images) ? rawBody.images : undefined,
      date: typeof rawBody?.date === 'string' ? rawBody.date : undefined,
      settings:
        rawBody?.settings && typeof rawBody.settings === 'object'
          ? rawBody.settings
          : undefined,
      firstComment:
        rawBody?.firstComment === null
          ? null
          : typeof rawBody?.firstComment === 'string'
          ? rawBody.firstComment
          : undefined,
    };
    if (Object.values(patch).every((v) => v === undefined)) {
      throw new HttpException(
        {
          msg: 'Nothing to update. Send at least one of: content, images, date, settings, firstComment.',
        },
        400
      );
    }

    const { dto, state } = await this._postsService.buildPostUpdate(
      org.id,
      id,
      patch
    );
    const body = await this._postsService.mapTypeToPost(dto, org.id);

    this.assertMediaDomains(body.posts);
    // A draft may stay half-written, so it only gets the lenient checks.
    await this.assertPostsValid(
      org.id,
      body.posts,
      state === 'DRAFT' ? 'draft' : 'update'
    );

    return this._postsService.createPost(org.id, body, 'API');
  }

  @Delete('/posts/:id')
  async deletePost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getPostById = await this._postsService.getPost(org.id, id);
    if (!getPostById) {
      throw new HttpException({ msg: 'Post not found' }, 404);
    }
    return this._postsService.deletePost(org.id, getPostById.group);
  }

  @Delete('/posts/group/:group')
  deletePostByGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.deletePost(org.id, group);
  }

  // Lets an external content pipeline (agency's own generator, n8n, ...) push
  // a draft it already created via POST /posts (type: "draft") straight into
  // the human approval queue — no dashboard session, no manual "Send for
  // approval" click. There is no API-key-bound user, so the request is
  // attributed to the org's own SUPERADMIN (see ApprovalService).
  @Post('/posts/:id/request-approval')
  async requestApproval(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._approvalService.requestApprovalFromApi(org.id, id);
  }

  // Read-side counterpart to request-approval: lets a pipeline that pushed a
  // post into the approval queue poll for the outcome (state alone, from
  // GET /posts, can't distinguish "rejected" from "never submitted", and
  // never carries the reviewer's note).
  @Get('/posts/:id/approval')
  async getApprovalStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const approval = await this._approvalService.getForPost(org.id, id);
    if (!approval) {
      return { status: 'NONE' as const };
    }
    return {
      status: approval.status,
      note: approval.note,
      requestedAt: approval.requestedAt,
      resolvedAt: approval.resolvedAt,
    };
  }

  @Get('/is-connected')
  async getActiveIntegrations(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    const integrations = await this._integrationService.getIntegrationsList(org.id);
    return {
      connected: integrations.some((integration) => !integration.disabled),
    };
  }

  @Get('/groups')
  async listGroups(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return (await this._integrationService.customers(org.id)).map(
      (customer) => ({
        id: customer.id,
        name: customer.name,
      })
    );
  }

  @Get('/integrations')
  async listIntegration(
    @GetOrgFromRequest() org: Organization,
    @Query('group') group?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return (await this._integrationService.getIntegrationsList(org.id))
      .filter((integration) => !group || integration.customer?.id === group)
      .map((integration) => ({
        id: integration.id,
        name: integration.name,
        identifier: integration.providerIdentifier,
        picture: integration.picture,
        disabled: integration.disabled,
        // Surfaced so an agent can find channels that need a reconnect
        // without reading notifications.
        refreshNeeded: integration.refreshNeeded,
        inBetweenSteps: integration.inBetweenSteps,
        profile: integration.profile,
        customer: integration.customer
          ? {
              id: integration.customer.id,
              name: integration.customer.name,
            }
          : undefined,
      }));
  }

  @Get('/social/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') rawRefresh: unknown,
    @GetOrgFromRequest() org: Organization
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const refresh = typeof rawRefresh === 'string' && rawRefresh ? rawRefresh : undefined;
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new HttpException({ msg: 'Integration not allowed' }, 400);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    if (integrationProvider.externalUrl) {
      throw new HttpException(
        {
          msg: 'This integration requires an external URL and is not supported via the public API',
        },
        400
      );
    }

    try {
      const { codeVerifier, state, url } =
        await integrationProvider.generateAuthUrl();

      if (refresh) {
        // `refresh` is the PostSider channel id; the connect step compares it
        // with the platform's own id (internalId), so translate it exactly like
        // the dashboard route does. An unknown value passes through unchanged.
        const existing = await this._integrationService.getIntegrationById(
          org.id,
          refresh
        );
        await ioRedis.set(
          `refresh:${state}`,
          existing?.internalId || refresh,
          'EX',
          3600
        );
      }

      await ioRedis.set(`organization:${state}`, org.id, 'EX', 3600);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);

      return { url };
    } catch (err) {
      throw new HttpException({ msg: 'Failed to generate auth URL' }, 500);
    }
  }

  @Get('/notifications')
  async getNotifications(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetNotificationsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._notificationService.getNotificationsPaginated(
      org.id,
      query.page ?? 0
    );
  }

  @Delete('/integrations/:id')
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    // Same non-destructive behaviour as the dashboard route (`deleteChannel`
    // parks unpublished posts as drafts): removing a channel can never wipe
    // content the caller did not ask to delete. Older docs said the scheduled
    // posts are removed — they are only unscheduled now; `DELETE /posts/:group`
    // is still the way to actually delete them.
    return this._integrationService.deleteChannel(org.id, id);
  }

  // Emergency Pause (kill switch) — public API surface so an external monitor
  // (sentiment watcher, n8n loop-guard, security scanner) can halt ALL
  // publishing programmatically. Resume stays human-only (dashboard, owner).
  // NOTE: the pause is attributed to the org's own SUPERADMIN — there is no
  // session user on the public API.
  @Post('/publishing/pause')
  async pausePublishing(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { reason?: string }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const state = await this._postsService.pausePublishingFromApi(
      org.id,
      body?.reason
    );
    return {
      state: state?.publishingState ?? 'PAUSED',
      pausedAt: state?.publishingPausedAt ?? null,
      pausedBy: state?.publishingPausedById ?? null,
      reason: state?.publishingPauseReason ?? null,
    };
  }

  @Get('/publishing/state')
  async getPublishingState(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    const state = await this._postsService.getPublishingState(org.id);
    return {
      state: state?.publishingState ?? 'ACTIVE',
      pausedAt: state?.publishingPausedAt ?? null,
      pausedBy: state?.publishingPausedById ?? null,
      reason: state?.publishingPauseReason ?? null,
    };
  }

  @Get('/integration-settings/:id')
  async getIntegrationSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const loadIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    if (!loadIntegration) {
      throw new HttpException({ msg: 'Integration not found' }, 404);
    }

    const verified =
      JSON.parse(loadIntegration.additionalSettings || '[]')?.find(
        (p: any) => p?.title === 'Verified'
      )?.value || false;

    const integration = socialIntegrationList.find(
      (p) => p.identifier === loadIntegration.providerIdentifier
    )!;

    if (!integration) {
      return {
        output: { rules: '', maxLength: 0, settings: {}, tools: [] as any[] },
      };
    }

    const maxLength = integration.maxLength(verified);
    const schemas = !integration.dto
      ? false
      : getValidationSchemas()[integration.dto.name];
    const tools = this._integrationManager.getAllTools();
    const rules = this._integrationManager.getAllRulesDescription();

    return {
      output: {
        rules: rules[integration.identifier],
        maxLength,
        settings: !schemas ? 'No additional settings required' : schemas,
        tools: tools[integration.identifier],
      },
    };
  }

  @Get('/posts/:id/missing')
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.getMissingContent(org.id, id);
  }

  @Put('/posts/:id/status')
  async changePostStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: ChangePostStatusDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.changePostStatus(org.id, id, body.status);
  }

  @Put('/posts/:id/release-id')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('releaseId') releaseId: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.updateReleaseId(org.id, id, releaseId);
  }

  @Get('/analytics/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const days = Number(date);
    return this._postsService.checkPostAnalytics(
      org.id,
      postId,
      Number.isFinite(days) && days > 0 ? days : 7
    );
  }

  @Get('/analytics/:integration')
  async getAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._integrationService.checkAnalytics(org, integration, date);
  }

  @Post('/integration-trigger/:id')
  async triggerIntegrationTool(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { methodName: string; data: Record<string, string> }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    if (!getIntegration) {
      throw new HttpException({ msg: 'Integration not found' }, 404);
    }

    const integrationProvider = socialIntegrationList.find(
      (p) => p.identifier === getIntegration.providerIdentifier
    )!;

    if (!integrationProvider) {
      throw new HttpException({ msg: 'Integration provider not found' }, 404);
    }

    const tools = this._integrationManager.getAllTools();
    if (
      // @ts-ignore
      !tools[integrationProvider.identifier]?.some(
        (p: any) => p.methodName === body.methodName
      ) ||
      // @ts-ignore
      !integrationProvider[body.methodName]
    ) {
      throw new HttpException({ msg: 'Tool not found' }, 404);
    }

    // Bound the refresh retry: a provider that keeps returning a fresh token
    // while the tool still throws RefreshToken would otherwise loop forever,
    // holding the request thread at 10s per iteration.
    const MAX_ATTEMPTS = 2;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        // @ts-ignore
        const result = await integrationProvider[body.methodName](
          getIntegration.token,
          body.data || {},
          getIntegration.internalId,
          getIntegration
        );

        return { output: result };
      } catch (err) {
        if (err instanceof RefreshToken) {
          const refresh = await this._refreshIntegrationService.refreshWithLifecycle(
            getIntegration
          );

          if (refresh.status === 'stale') {
            throw new HttpException(
              { msg: 'Channel credentials changed while refreshing; retry the request' },
              409
            );
          }

          if (refresh.status === 'failed') {
            await this._integrationService.disconnectChannel(
              org.id,
              getIntegration
            );
            throw new HttpException(
              { msg: 'Channel disconnected due to expired token' },
              401
            );
          }

          if (refresh.status === 'deferred') {
            throw new HttpException(
              {
                msg: 'Channel token refresh is temporarily unavailable, please retry',
              },
              503
            );
          }

          const { accessToken } = refresh.refresh;

          if (accessToken) {
            getIntegration.token = accessToken;

            if (integrationProvider.refreshWait) {
              await timer(10000);
            }

            continue;
          }
        }
        throw new HttpException({ msg: 'Unexpected error' }, 500);
      }
    }

    throw new HttpException({ msg: 'Token refresh did not resolve' }, 401);
  }
}
