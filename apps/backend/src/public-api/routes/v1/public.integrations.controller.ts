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
import { uploadInterceptorOptions } from '@postsider/nestjs-libraries/upload/upload.limits';
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

// Ceiling for the remote-download endpoint (matches the video upload cap).
const MAX_REMOTE_MEDIA_BYTES = 500 * 1024 * 1024;

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
    const { width, height } = await probeDimensions(file);
    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      file.originalname,
      getFile.kind,
      file.size,
      width,
      height
    );
  }

  @Post('/upload-from-url')
  async uploadsFromUrl(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UploadDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const response = await fetch(body.url, {
      // @ts-ignore — undici option, not in lib.dom fetch types
      dispatcher: ssrfSafeDispatcher,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      throw new HttpException({ msg: 'Failed to fetch URL' }, 400);
    }
    // Bound the download so an attacker-supplied URL cannot OOM the process.
    const declared = Number(response.headers.get('content-length'));
    if (declared && declared > MAX_REMOTE_MEDIA_BYTES) {
      throw new HttpException({ msg: 'File too large' }, 413);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_REMOTE_MEDIA_BYTES) {
      throw new HttpException({ msg: 'File too large' }, 413);
    }
    const detected = await detectFileType(buffer);
    if (!detected || !PUBLIC_API_ALLOWED_MIME.has(detected.mime)) {
      throw new HttpException({ msg: 'Unsupported file type.' }, 400);
    }
    const mimetype = detected.mime;
    const ext = detected.ext;
    const originalName = body.url.split('/').pop()?.split('?')[0] || undefined;

    const getFile = await this.storage.uploadFile({
      buffer,
      mimetype,
      size: buffer.length,
      path: '',
      fieldname: '',
      destination: '',
      stream: new Readable(),
      filename: '',
      originalname: `upload.${ext}`,
      encoding: '',
    });

    const { width, height } = await probeDimensions({
      buffer,
      mimetype,
      size: buffer.length,
      path: '',
      fieldname: '',
      destination: '',
      stream: new Readable(),
      filename: '',
      originalname: `upload.${ext}`,
      encoding: '',
    });

    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      originalName,
      getFile.kind,
      buffer.length,
      width,
      height
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
    @Query() query: GetPostsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const posts = await this._postsService.getPosts(org.id, query);
    return {
      posts,
      // comments,
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

    if (
      process.env.RESTRICT_UPLOAD_DOMAINS &&
      body.posts.some((p) =>
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

    // Server-side validation — same rules as the dashboard, surfaced as a
    // readable 400 (see PostValidationExceptionFilter).
    const validation = await this._postsService.validatePosts(
      org.id,
      body.posts
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

    if (body.type !== 'draft') {
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
    @Query('refresh') refresh: string,
    @GetOrgFromRequest() org: Organization
  ) {
    Sentry.metrics.count('public_api-request', 1);
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
        await ioRedis.set(`refresh:${state}`, refresh, 'EX', 3600);
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
    const isTherePosts = await this._integrationService.getPostsForChannel(
      org.id,
      id
    );
    if (isTherePosts.length) {
      for (const post of isTherePosts) {
        this._postsService.deletePost(org.id, post.group).catch(() => {});
      }
    }

    return this._integrationService.deleteChannel(org.id, id);
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
          const data = await this._refreshIntegrationService.refresh(
            getIntegration
          );

          if (!data) {
            await this._integrationService.disconnectChannel(
              org.id,
              getIntegration
            );
            throw new HttpException(
              { msg: 'Channel disconnected due to expired token' },
              401
            );
          }

          const { accessToken } = data;

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
