import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { PostsRepository } from '@postsider/nestjs-libraries/database/prisma/posts/posts.repository';
import { CreatePostDto } from '@postsider/nestjs-libraries/dtos/posts/create.post.dto';
import dayjs from 'dayjs';
import { slotsForDay } from './queue-slots';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import {
  Integration,
  Post,
  Media,
  From,
  CreationMethod,
  State,
} from '@prisma/client';
import { GetPostsDto } from '@postsider/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@postsider/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { shuffle } from 'lodash';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { MediaService } from '@postsider/nestjs-libraries/database/prisma/media/media.service';
import { ShortLinkService } from '@postsider/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@postsider/nestjs-libraries/dtos/posts/create.tag.dto';
import {
  minifyPostsList,
  minifyPosts,
} from '@postsider/helpers/utils/posts.list.minify';
import axios from 'axios';
import sharp from 'sharp';
import { UploadFactory } from '@postsider/nestjs-libraries/upload/upload.factory';
import { Readable } from 'stream';
import { OpenaiService } from '@postsider/nestjs-libraries/openai/openai.service';
dayjs.extend(utc);
dayjs.extend(timezone);
import * as Sentry from '@sentry/nestjs';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@postsider/nestjs-libraries/temporal/temporal.search.attribute';
import { AnalyticsData } from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { timer } from '@postsider/helpers/utils/timer';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { RefreshToken } from '@postsider/nestjs-libraries/integrations/social.abstract';
import { RefreshIntegrationService } from '@postsider/nestjs-libraries/integrations/refresh.integration.service';
import { hasExtension } from '@postsider/helpers/utils/has.extension';
import { TiktokProvider } from '@postsider/nestjs-libraries/integrations/social/tiktok.provider';
import { stripLinks } from '@postsider/helpers/utils/strip.links';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { stripHtmlValidation } from '@postsider/helpers/utils/strip.html.validation';
import { weightedLength } from '@postsider/helpers/utils/count.length';
import { PostAnalyticsService } from '@postsider/nestjs-libraries/database/prisma/post-analytics/post-analytics.service';
import {
  SubscriptionService,
  TrialUsageLimitError,
  MonthlyPostQuotaExceededError,
} from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { PublishingPausedException } from '@postsider/nestjs-libraries/services/publishing.paused.exception';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';

type PostWithConditionals = Post & {
  integration?: Integration;
  childrenPost: Post[];
};

@Injectable()
export class PostsService {
  private _logger = new Logger(PostsService.name);
  private storage = UploadFactory.createStorage();
  constructor(
    private _postRepository: PostsRepository,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService,
    private _shortLinkService: ShortLinkService,
    private _openaiService: OpenaiService,
    private _temporalService: TemporalService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _postAnalyticsService: PostAnalyticsService,
    private _subscriptionService: SubscriptionService,
    private _organizationRepository: OrganizationRepository,
    private _notificationService: NotificationService,
  ) {}

  searchForMissingThreeHoursPosts() {
    return this._postRepository.searchForMissingThreeHoursPosts();
  }

  // ── Emergency Pause (kill switch) ──────────────────────────────────────────

  getPublishingState(orgId: string) {
    return this._organizationRepository.getPublishingState(orgId);
  }

  /** Pause all publishing for the org (idempotent). Stamps who/when/why. */
  async pausePublishing(orgId: string, userId: string, reason?: string) {
    await this._organizationRepository.setPublishingState(orgId, {
      publishingState: 'PAUSED',
      publishingPausedAt: new Date(),
      publishingPausedById: userId,
      publishingPauseReason: reason || null,
    });
    await this._notificationService.inAppNotification(
      orgId,
      'Publishing paused',
      'All publishing for this organization has been paused.',
      false,
      false,
      'info',
      undefined,
      { key: 'publishingPaused', params: { reason: reason ?? '' } }
    );
    return this._organizationRepository.getPublishingState(orgId);
  }

  /**
   * Public-API pause (auto-pause by monitoring/webhook): there is no session
   * user, so the pause is attributed to the org's own SUPERADMIN (falling back
   * to any ADMIN, then any member) — "the org itself, via API" — mirroring
   * ApprovalService's resolveApiRequester.
   */
  async pausePublishingFromApi(orgId: string, reason?: string) {
    const org = await this._organizationRepository.getAllUsersOrgs(orgId);
    const users = (org?.users || []) as Array<{
      role: string;
      user: { id: string };
    }>;
    const chosen =
      users.find((u) => u.role === 'SUPERADMIN') ||
      users.find((u) => u.role === 'ADMIN') ||
      users[0];
    if (!chosen) {
      throw new BadRequestException(
        'Organization has no users to attribute this pause to'
      );
    }
    return this.pausePublishing(orgId, chosen.user.id, reason);
  }

  /**
   * Resume publishing. `to_draft` (default) parks every HELD post to DRAFT so
   * a human re-approves before anything goes out; `auto_resume` only requeues
   * HELD posts whose publishDate is still in the future (re-arming their
   * Temporal workflows) and drafts the rest.
   */
  async resumePublishing(orgId: string, behavior: 'to_draft' | 'auto_resume') {
    const { heldPostsProcessed, requeued } =
      await this._postRepository.resumePublishing(orgId, behavior);
    for (const post of requeued) {
      await this.startWorkflow(post.taskQueue, post.id, orgId, 'QUEUE').catch(
        (err) =>
          this._logger.error(
            `resumePublishing: scheduling failed for post ${post.id}: ${err}`
          )
      );
    }
    const state = await this._organizationRepository.getPublishingState(orgId);
    await this._notificationService.inAppNotification(
      orgId,
      'Publishing resumed',
      'Publishing has been resumed for this organization.',
      false,
      false,
      'info',
      undefined,
      { key: 'publishingResumed', params: { count: String(heldPostsProcessed) } }
    );
    return { state, heldPostsProcessed };
  }

  /** Atomic publish gate called by the Temporal workflow at fire time. */
  claimPostForPublish(orgId: string, postId: string) {
    return this._postRepository.claimPostForPublish(orgId, postId);
  }

  private async assertOrgNotPausedForSchedule(orgId: string): Promise<void> {
    const orgState =
      await this._organizationRepository.getPublishingState(orgId);
    if (orgState?.publishingState === 'PAUSED') {
      throw new PublishingPausedException(orgState.publishingPauseReason);
    }
  }

  // ── End Emergency Pause ────────────────────────────────────────────────────

  findRecentPublishedForAnalytics(since: Date, limit?: number) {
    return this._postRepository.findRecentPublishedForAnalytics(since, limit);
  }

  updatePost(id: string, postId: string, releaseURL: string, orgId?: string) {
    return this._postRepository.updatePost(id, postId, releaseURL, orgId);
  }

  async getMissingContent(
    orgId: string,
    postId: string,
    forceRefresh = false,
    _retryCount = 0
  ): Promise<{ id: string; url: string }[]> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.releaseId !== 'missing') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.missing) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    try {
      return await integrationProvider.missing(
        getIntegration.internalId,
        getIntegration.token
      );
    } catch (e) {
      console.log(e);
      if (e instanceof RefreshToken && _retryCount < 3) {
        return this.getMissingContent(orgId, postId, true, _retryCount + 1);
      }
    }

    return [];
  }

  async getPostById(postId: string, orgId: string) {
    return this._postRepository.getPostById(postId, orgId);
  }

  async updateReleaseId(orgId: string, postId: string, releaseId: string) {
    return this._postRepository.updateReleaseId(postId, orgId, releaseId);
  }

  async checkPostAnalytics(
    orgId: string,
    postId: string,
    date: number,
    forceRefresh = false,
    _retryCount = 0
  ): Promise<AnalyticsData[] | { missing: true }> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || !post.releaseId) {
      return [];
    }

    if (post.releaseId === 'missing') {
      return { missing: true };
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.postAnalytics) {
      return [];
    }

    const getIntegration = post.integration!;

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    const cacheKey = `integration:${orgId}:${post.id}:${date}`;
    const getIntegrationData = await ioRedis.get(cacheKey);
    if (getIntegrationData) {
      try {
        return JSON.parse(getIntegrationData);
      } catch {}
    }

    try {
      const loadAnalytics = await integrationProvider.postAnalytics(
        getIntegration.internalId,
        getIntegration.token,
        post.releaseId,
        date
      );
      // Persistence is best-effort so a database write cannot turn a healthy
      // provider response into a failed analytics request.
      try {
        await this._postAnalyticsService.record(orgId, post.id, loadAnalytics);
      } catch (error) {
        this._logger.warn(
          `Could not persist analytics for post ${post.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      await ioRedis.set(
        cacheKey,
        JSON.stringify(loadAnalytics),
        'EX',
        !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
          ? 1
          : 3600
      );
      return loadAnalytics;
    } catch (e) {
      console.log(e);
      if (e instanceof RefreshToken && _retryCount < 3) {
        return this.checkPostAnalytics(orgId, postId, date, true, _retryCount + 1);
      }
    }

    return [];
  }

  async getStatistics(orgId: string, id: string) {
    const getPost = await this.getPostsRecursively(id, true, orgId, true);
    const content = getPost.map((p) => p.content);
    const shortLinksTracking = await this._shortLinkService.getStatistics(
      content
    );

    return {
      clicks: shortLinksTracking,
    };
  }

  async mapTypeToPost(
    body: CreatePostDto,
    organization: string,
    replaceDraft: boolean = false
  ): Promise<CreatePostDto> {
    if (!body?.posts?.every((p) => p?.integration?.id)) {
      throw new BadRequestException('All posts must have an integration id');
    }

    const mappedValues = {
      ...body,
      type: replaceDraft ? 'schedule' : body?.type,
      posts: await Promise.all(
        body?.posts?.map(async (post) => {
          const integration = await this._integrationService.getIntegrationById(
            organization,
            post.integration.id
          );

          if (!integration) {
            throw new BadRequestException(
              `Integration with id ${post.integration.id} not found`
            );
          }

          return {
            type: replaceDraft ? 'schedule' : body?.type,
            ...post,
            settings: {
              ...(post.settings || ({} as any)),
              __type: integration.providerIdentifier,
            },
          };
        }) || []
      ),
    };

    const validationPipe = new ValidationPipe({
      skipMissingProperties: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    return await validationPipe.transform(mappedValues, {
      type: 'body',
      metatype: CreatePostDto,
    });
  }

  async getPostsRecursively(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ): Promise<PostWithConditionals[]> {
    const post = await this._postRepository.getPost(
      id,
      includeIntegration,
      orgId,
      isFirst
    );

    if (!post) {
      return [];
    }

    return [
      post!,
      ...(post?.childrenPost?.length
        ? await this.getPostsRecursively(
            post?.childrenPost?.[0]?.id,
            false,
            orgId,
            false
          )
        : []),
    ];
  }

  /**
   * Public post preview gated by share token. Returns the flat post row
   * (no recursive children), stripped of internal fields. The share token is
   * crypto-random — knowing a post id is not enough to reach this.
   */
  async getPublicPost(shareToken: string) {
    const post = await this._postRepository.findByShareToken(shareToken);
    if (!post) return null;

    return {
      id: post.id,
      content: post.content,
      publishDate: post.publishDate,
      releaseURL: post.releaseURL,
      image: post.image,
      state: post.state,
      integration: post.integration,
    };
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    return this._postRepository.getPosts(orgId, query);
  }

  async getPostsMinified(orgId: string, query: GetPostsDto) {
    return minifyPosts({
      posts: await this._postRepository.getPosts(orgId, query),
    });
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    return minifyPostsList(
      await this._postRepository.getPostsList(orgId, query)
    );
  }

  async updateMedia(
    id: string,
    imagesList: any[],
    orgId: string,
    convertToJPEG = false
  ) {
    try {
      let imageUpdateNeeded = false;
      const getImageList = await Promise.all(
        (
          await Promise.all(
            (imagesList || []).map(async (p: any) => {
              if (!p.path && p.id) {
                imageUpdateNeeded = true;
                return this._mediaService.getMediaById(p.id, orgId);
              }

              return p;
            })
          )
        )
          .map((m) => {
            return {
              ...m,
              url:
                m.path.indexOf('http') === -1
                  ? process.env.FRONTEND_URL +
                    '/' +
                    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                    m.path
                  : m.path,
              type: m.type || this.deriveMediaType(m.path),
              path:
                m.path.indexOf('http') === -1
                  ? process.env.UPLOAD_DIRECTORY + m.path
                  : m.path,
            };
          })
          .map(async (m) => {
            if (!convertToJPEG) {
              return m;
            }

            if (hasExtension(m.path, 'png')) {
              imageUpdateNeeded = true;
              const response = await axios.get(m.url, {
                responseType: 'arraybuffer',
                timeout: 15000,
                maxContentLength: 50 * 1024 * 1024,
              });

              const imageBuffer = Buffer.from(response.data);

              // Use sharp to get the metadata of the image
              const buffer = await sharp(imageBuffer)
                .jpeg({ quality: 100 })
                .toBuffer();

              const { path, originalname } = await this.storage.uploadFile({
                buffer,
                mimetype: 'image/jpeg',
                size: buffer.length,
                path: '',
                fieldname: '',
                destination: '',
                stream: new Readable(),
                filename: '',
                originalname: '',
                encoding: '',
              });

              return {
                ...m,
                name: originalname,
                url:
                  path.indexOf('http') === -1
                    ? process.env.FRONTEND_URL +
                      '/' +
                      process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                      path
                    : path,
                type: 'image',
                path:
                  path.indexOf('http') === -1
                    ? process.env.UPLOAD_DIRECTORY + path
                    : path,
              };
            }

            return m;
          })
      );

      if (imageUpdateNeeded) {
        await this._postRepository.updateImages(
          id,
          JSON.stringify(getImageList)
        );
      }

      return getImageList;
    } catch (err: any) {
      return imagesList;
    }
  }

  /**
   * Best-effort media kind derived from the file path/URL. Used when a media
   * item carries no persisted `type` (e.g. posts created via the public API
   * reference media by {id, path} only). Falls back to 'image'.
   */
  private deriveMediaType(path: string): 'image' | 'video' | 'audio' {
    const videoExts = ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'];
    const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'];
    const p = (path || '').toLowerCase();
    if (videoExts.some((ext) => p.includes(`.${ext}`))) return 'video';
    if (audioExts.some((ext) => p.includes(`.${ext}`))) return 'audio';
    return 'image';
  }

  async getPostGroupDebugExport(orgId: string, group: string) {
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    // getPostsByGroup throws for nothing matching, but an unknown/foreign group
    // can still 500 on rootPost below — guard explicitly.
    if (!loadAll?.length) {
      throw new BadRequestException('Post group not found');
    }
    const errors = await this._postRepository.getErrorsByPostIds(
      loadAll.map((p) => p.id)
    );
    const posts = this.arrangePostsByGroup(loadAll, undefined);
    const rootPost = posts[0] as any;

    return {
      type: 'draft' as const,
      shortLink: false,
      date: rootPost.publishDate.toISOString(),
      tags:
        rootPost.tags?.map((t: any) => ({
          value: t.tag.id,
          label: t.tag.name,
        })) || [],
      posts: [
        {
          integration: { id: 'REPLACE_WITH_LOCAL_INTEGRATION_ID' },
          group: rootPost.group,
          settings: JSON.parse(rootPost.settings || '{}'),
          value: posts.map((post) => ({
            content: post.content,
            image: JSON.parse(post.image || '[]'),
            delay: post.delay || 0,
          })),
        },
      ],
      _debug: {
        providerIdentifier: rootPost.integration?.providerIdentifier,
        providerName: rootPost.integration?.name,
        state: rootPost.state,
        error: rootPost.error,
        errors: errors.map((e) => ({
          message: e.message,
          platform: e.platform,
          body: e.body,
          createdAt: e.createdAt,
        })),
        originalGroup: group,
        originalPublishDate: rootPost.publishDate,
        exportedAt: new Date().toISOString(),
      },
    };
  }

  async getPostsByGroup(orgId: string, group: string) {
    const convertToJPEG = false;
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const posts = this.arrangePostsByGroup(loadAll, undefined);

    if (!posts?.length) {
      throw new BadRequestException('Post not found');
    }

    return {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            orgId,
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };
  }

  arrangePostsByGroup(all: any, parent?: string, _visited = new Set<string>()): PostWithConditionals[] {
    const findAll = all
      .filter((p: any) =>
        !parent ? !p.parentPostId : p.parentPostId === parent
      )
      .filter((p: any) => !_visited.has(p.id))
      .map(({ integration, ...all }: any) => ({
        ...all,
        ...(!parent ? { integration } : {}),
      }));

    for (const p of findAll) {
      _visited.add(p.id);
    }

    return [
      ...findAll,
      ...(findAll.length
        ? findAll.flatMap((p: any) => this.arrangePostsByGroup(all, p.id, _visited))
        : []),
    ];
  }

  async getPost(orgId: string, id: string, convertToJPEG = false) {
    const posts = await this.getPostsRecursively(id, true, orgId, true);
    if (!posts?.length) {
      throw new BadRequestException('Post not found');
    }
    const list = {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...post,
          image: await this.updateMedia(
            post.id,
            JSON.parse(post.image || '[]'),
            orgId,
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };

    return list;
  }

  async getOldPosts(orgId: string, date: string) {
    return this._postRepository.getOldPosts(orgId, date);
  }

  public async updateTags(orgId: string, post: Post[]): Promise<Post[]> {
    const plainText = JSON.stringify(post);
    const extract = Array.from(
      plainText.match(/\(post:[a-zA-Z0-9-_]+\)/g) || []
    );
    if (!extract.length) {
      return post;
    }

    const ids = (extract || []).map((e) =>
      e.replace('(post:', '').replace(')', '')
    );
    const urls = await this._postRepository.getPostUrls(orgId, ids);
    const newPlainText = ids.reduce((acc, value) => {
      const findUrl = urls?.find?.((u) => u.id === value)?.releaseURL || '';
      return acc.replace(
        new RegExp(`\\(post:${value}\\)`, 'g'),
        findUrl.split(',')[0]
      );
    }, plainText);

    return this.updateTags(orgId, JSON.parse(newPlainText) as Post[]);
  }

  public async checkInternalPlug(
    integration: Integration,
    orgId: string,
    id: string,
    settings: any
  ) {
    const plugs = Object.entries(settings).filter(([key]) => {
      return key.indexOf('plug-') > -1;
    });

    if (plugs.length === 0) {
      return [];
    }

    const parsePlugs = plugs.reduce((all, [key, value]) => {
      const [_, name, identifier] = key.split('--');
      all[name] = all[name] || { name };
      all[name][identifier] = value;
      return all;
    }, {} as any);

    const list: {
      name: string;
      integrations: { id: string }[];
      delay: string;
      active: boolean;
    }[] = Object.values(parsePlugs);

    return (list || []).flatMap((trigger) => {
      return (trigger?.integrations || []).flatMap((int) => ({
        type: 'internal-plug',
        post: id,
        originalIntegration: integration.id,
        integration: int.id,
        plugName: trigger.name,
        orgId: orgId,
        delay: +trigger.delay,
        information: trigger,
      }));
    });
  }

  public async checkPlugs(
    orgId: string,
    providerName: string,
    integrationId: string
  ) {
    const loadAllPlugs = this._integrationManager.getAllPlugs();
    const getPlugs = await this._integrationService.getPlugs(
      orgId,
      integrationId
    );

    const currentPlug = loadAllPlugs.find((p) => p.identifier === providerName);

    return getPlugs
      .filter((plug) => {
        return currentPlug?.plugs?.some(
          (p: any) => p.methodName === plug.plugFunction
        );
      })
      .map((plug) => {
        const runPlug = currentPlug?.plugs?.find(
          (p: any) => p.methodName === plug.plugFunction
        )!;
        return {
          type: 'global',
          plugId: plug.id,
          delay: runPlug.runEveryMilliseconds,
          totalRuns: runPlug.totalRuns,
        };
      });
  }

  async deletePost(orgId: string, group: string) {
    const post = await this._postRepository.deletePost(orgId, group);

    if (post?.id) {
      try {
        const workflows = this._temporalService.client
          .getRawClient()
          ?.workflow.list({
            query: `postId="${post.id}" AND ExecutionStatus="Running"`,
          });

        for await (const executionInfo of workflows!) {
          try {
            const workflow =
              await this._temporalService.client.getWorkflowHandle(
                executionInfo.workflowId
              );
            if (
              workflow &&
              (await workflow.describe()).status.name !== 'TERMINATED'
            ) {
              await workflow.terminate();
            }
          } catch (err) {}
        }
      } catch (err) {}
    }

    return { success: true };
  }

  async countPostsFromDay(orgId: string, date: Date) {
    return this._postRepository.countPostsFromDay(orgId, date);
  }

  getPostByForWebhookId(id: string, orgId?: string) {
    return this._postRepository.getPostByForWebhookId(id, orgId);
  }

  async startWorkflow(
    taskQueue: string,
    postId: string,
    orgId: string,
    state: State
  ) {
    // Best-effort cleanup of previous runs — a failure here must not block the
    // (re)schedule below, but it is worth a log line.
    try {
      const workflows = this._temporalService.client
        .getRawClient()
        ?.workflow.list({
          query: `postId="${postId}" AND ExecutionStatus="Running"`,
        });

      for await (const executionInfo of workflows!) {
        try {
          const workflow = await this._temporalService.client.getWorkflowHandle(
            executionInfo.workflowId
          );
          if (
            workflow &&
            (await workflow.describe()).status.name !== 'TERMINATED'
          ) {
            await workflow.terminate();
          }
        } catch (err) {
          this._logger.warn(
            `startWorkflow: could not terminate old run ${executionInfo.workflowId} for post ${postId}: ${err}`
          );
        }
      }
    } catch (err) {
      this._logger.warn(
        `startWorkflow: could not list old runs for post ${postId}: ${err}`
      );
    }

    if (state === 'DRAFT' || state === 'HELD') {
      // DRAFT is never armed (a draft publish must not fire). HELD is a post
      // parked by the Emergency Pause — it must not be (re)armed until a human
      // resume moves it back to QUEUE.
      return;
    }

    // NOT best-effort. If this start is lost, the post sits in QUEUE forever
    // with no error and every health signal green — the silent 2026-07 outage
    // class. So: a null client is an error (the old `?.` chain made it a
    // no-op), and any failure marks the post ERROR (user-visible, and the
    // monitor's stuck-post check counts only error-less posts) before
    // rethrowing for the caller.
    try {
      const workflow = this._temporalService.client.getRawClient()?.workflow;
      if (!workflow) {
        throw new Error('Temporal client is not available');
      }
      await workflow.start('postWorkflowV107', {
        workflowId: `post_${postId}`,
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
        args: [
          {
            taskQueue: taskQueue,
            postId: postId,
            organizationId: orgId,
          },
        ],
        typedSearchAttributes: new TypedSearchAttributes([
          {
            key: postIdSearchParam,
            value: postId,
          },
          {
            key: organizationId,
            value: orgId,
          },
        ]),
      });
    } catch (err) {
      this._logger.error(
        `startWorkflow: FAILED to schedule publish workflow for post ${postId} (org ${orgId}): ${err}`
      );
      try {
        await this._postRepository.changeState(
          postId,
          'ERROR',
          'Could not schedule the publish workflow (scheduler unavailable). Please re-schedule this post.',
          undefined,
          orgId
        );
      } catch (stateErr) {
        this._logger.error(
          `startWorkflow: could not even mark post ${postId} as ERROR: ${stateErr}`
        );
      }
      throw err;
    }
  }

  /**
   * Server-side validation that used to live on the client (`checkValidity` +
   * the manage modal loop). Runs the provider's settings DTO validation, the
   * provider `checkValidity` (media rules) and the empty-content / too-long
   * character checks. Returns one result per post so the frontend can show the
   * same toasts it did before — and so `/posts` can refuse to create invalid
   * posts.
   */
  async validatePosts(
    orgId: string,
    posts: Array<{
      integration: { id: string };
      value: Array<{
        content?: string;
        image?: Array<{ id?: string; path: string; thumbnail?: string }>;
      }>;
      settings?: any;
    }>,
    /**
     * The create type (draft/schedule/now/update). Drafts skip the TikTok
     * creator-info round-trip — the controllers already ignore their errors,
     * so an extra network call per draft save is pure waste.
     */
    postType?: 'draft' | 'schedule' | 'now' | 'update'
  ) {
    const isDraft = postType === 'draft';
    return Promise.all(
      (posts || []).map(async (post) => {
        const integration = await this._integrationService.getIntegrationById(
          orgId,
          post?.integration?.id
        );

        if (!integration) {
          throw new BadRequestException(
            `Integration with id ${post?.integration?.id} not found`
          );
        }

        const provider = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        let additionalSettings: any[] = [];
        try {
          additionalSettings = JSON.parse(
            integration.additionalSettings || '[]'
          );
        } catch {
          additionalSettings = [];
        }

        const settings = post.settings || {};
        const media = (post.value || []).map((p) => p.image || []);

        // Settings DTO validation — mirrors the client `form.trigger()`.
        let valid = true;
        let settingsError = '';
        if (provider?.dto) {
          const instance = plainToInstance(provider.dto, settings, {
            enableImplicitConversion: true,
          });
          const validationErrors = await validate(instance as object, {
            skipMissingProperties: false,
          });
          settingsError = this.firstValidationError(validationErrors);
          valid = validationErrors.length === 0;
        }

        // Provider-specific media validation (the old client `checkValidity`).
        let errors: string | true = true;
        try {
          errors = await provider.checkValidity(
            media,
            settings,
            additionalSettings
          );
        } catch (err: any) {
          errors = err?.message || 'Invalid media';
        }

        // TikTok creator-derived rules (privacy options, interaction locks,
        // commercial+private rule, video length cap) enforced server-side as a
        // best effort. Consulted here for BOTH the dashboard and the public
        // API, which share this validation path.
        if (
          !isDraft &&
          integration.providerIdentifier === 'tiktok' &&
          provider instanceof TiktokProvider
        ) {
          const tiktokIssues = await this.checkTiktokCreatorRules(
            orgId,
            integration,
            post,
            settings
          );
          if (tiktokIssues.length) {
            errors =
              (errors === true ? '' : `${errors} `) + tiktokIssues.join(' ');
          }
        }

        const maximumCharacters = provider.maxLength(additionalSettings);
        const isX = integration.providerIdentifier === 'x';

        const emptyContent = (post.value || []).some((a) => {
          const strip = stripHtmlValidation('normal', a.content || '', true);
          const length = isX ? weightedLength(strip) : strip.length;
          return length === 0 && (a.image || []).length === 0;
        });

        const tooLong = (post.value || []).some((a) => {
          const strip = stripHtmlValidation('normal', a.content || '', true);
          const weighted = isX ? weightedLength(strip) : strip.length;
          const totalCharacters =
            weighted > strip.length ? weighted : strip.length;
          return totalCharacters > (maximumCharacters || 1000000);
        });

        return {
          id: integration.id,
          identifier: integration.providerIdentifier,
          name: integration.name,
          valid,
          settingsError,
          errors,
          emptyContent,
          tooLong,
          maximumCharacters,
        };
      })
    );
  }

  /** Returns the first class-validator message (incl. nested children), or ''. */
  private firstValidationError(errors: any[]): string {
    for (const e of errors || []) {
      if (e?.constraints) {
        return Object.values(e.constraints as Record<string, string>)[0] || '';
      }
      const child = e?.children?.length
        ? this.firstValidationError(e.children)
        : '';
      if (child) {
        return child;
      }
    }
    return '';
  }

  /**
   * Best-effort TikTok creator-derived validation. Consulted at post
   * validation (dashboard + public API share this path): the creator info is
   * fetched live from TikTok, and the video length uses the duration probed
   * at upload time and persisted on the Media row. Any failure (TikTok down,
   * media row gone) skips the check rather than blocking post creation.
   */
  private async checkTiktokCreatorRules(
    orgId: string,
    integration: Integration,
    post: {
      value: Array<{ image?: Array<{ id?: string; path: string }> }>;
    },
    settings: any
  ): Promise<string[]> {
    try {
      const provider = this._integrationManager.getSocialIntegration('tiktok');
      if (!(provider instanceof TiktokProvider)) {
        return [];
      }
      const creator = await provider.creatorInfo(integration.token);
      if (!creator) {
        return [];
      }
      const mediaItems = (post?.value || [])[0]?.image || [];
      const mediaWithDuration = await Promise.all(
        mediaItems.map(async (item) => {
          if (!item?.id) {
            return { path: item?.path, durationSeconds: undefined };
          }
          const row = await this._mediaService.getMediaById(item.id, orgId);
          return {
            path: item?.path,
            durationSeconds: row?.durationSeconds ?? undefined,
          };
        })
      );
      return provider.validateCreatorRules(creator, settings, mediaWithDuration);
    } catch (err: any) {
      // Best effort by design: a failing creator-info call must not block
      // scheduling. TikTok still re-validates at publish time.
      this._logger.warn(`TikTok creator rules check skipped: ${err?.message}`);
      return [];
    }
  }

  async createPost(
    orgId: string,
    body: CreatePostDto,
    creationMethod: CreationMethod
  ): Promise<any[]> {
    // Emergency Pause gate — a paused org cannot create `now`/`schedule`
    // posts (deterministic 423, nothing persisted). Drafts stay fully
    // editable; only queueing for publish is blocked.
    if (body.type === 'schedule' || body.type === 'now') {
      await this.assertOrgNotPausedForSchedule(orgId);
    }

    const monthlyPostSlots = body.type === 'draft'
      ? 0
      : body.posts.reduce(
          (total, post) => total + (body.type === 'update'
            ? post.value.filter((value) => !value.id).length
            : (post.value?.length || 0)),
          0,
        );
    let monthlyReservation: string | null = null;
    try {
      monthlyReservation = await this._subscriptionService.reserveMonthlyPostSlots(
        orgId,
        monthlyPostSlots,
      );
    } catch (error) {
      if (error instanceof MonthlyPostQuotaExceededError) {
        throw new HttpException('Monthly post limit reached. Choose a plan to continue.', HttpStatus.PAYMENT_REQUIRED);
      }
      throw error;
    }

    let trialReservation: string | null = null;
    try {
      // Apply the private trial safety cap centrally so dashboard, API, CSV,
      // duplicate, and evergreen creation all follow the same rule.
      const newXIntegrationIds = body.type === 'update'
        ? []
        : body.posts.map((post) => post.integration?.id).filter(Boolean);
      const xTargets = await Promise.all(
        newXIntegrationIds.map((id) => this._integrationService.getIntegrationById(orgId, id))
      );
      try {
        trialReservation = await this._subscriptionService.reserveTrialXPosts(
          orgId,
          xTargets.filter((integration) => integration?.providerIdentifier === 'x').length
        );
      } catch (error) {
        if (error instanceof TrialUsageLimitError) {
          throw new HttpException(
            'Your trial includes usage limits. Choose a plan to continue.',
            HttpStatus.PAYMENT_REQUIRED
          );
        }
        throw error;
      }

    const postList: any[] = [];
    for (const post of body.posts) {
      const provider = this._integrationManager.getSocialIntegration(
        (post.settings as any)?.__type
      );
      const removeLinks = !!provider?.stripLinks?.();

      const messages = (post.value || []).map((p) => p.content);
      // No point shortlinking links on platforms that strip them out anyway
      const updateContent =
        !body.shortLink || removeLinks
          ? messages
          : await this._shortLinkService.convertTextToShortLinks(
              orgId,
              messages
            );

      post.value = (post.value || []).map((p, i) => ({
        ...p,
        content: removeLinks ? stripLinks(updateContent[i]) : updateContent[i],
      }));

      const { posts } = await this._postRepository.createOrUpdatePost(
        body.type,
        orgId,
        body.type === 'now'
          ? dayjs().format('YYYY-MM-DDTHH:mm:00')
          : body.date ?? dayjs().format('YYYY-MM-DDTHH:mm:00'),
        post,
        body.tags,
        creationMethod,
        body.inter
      );

      if (!posts?.length) {
        // This channel produced no posts (e.g. nothing to persist) — skip it
        // and keep processing the remaining channels instead of aborting the
        // whole batch and silently discarding posts already created.
        continue;
      }

      if (body.type !== 'update') {
        // Deliberately not awaited (don't hold the HTTP response for Temporal),
        // but never silent: on failure startWorkflow has already marked the
        // post ERROR, so the calendar shows it — this log is for the operator.
        this.startWorkflow(
          post.settings.__type.split('-')[0].toLowerCase(),
          posts[0].id,
          orgId,
          posts[0].state
        ).catch((err) =>
          this._logger.error(
            `createPost: scheduling failed for post ${posts[0].id}: ${err}`
          )
        );
      }

      Sentry.metrics.count('post_created', 1);
      postList.push({
        postId: posts[0].id,
        integration: post.integration.id,
      });
    }

      return postList;
    } finally {
      // Created posts become the durable count. The short-lived reservation
      // only closes races while concurrent requests are still being created.
      await this._subscriptionService.releaseTrialXReservation(trialReservation);
      await this._subscriptionService.releaseMonthlyPostReservation(monthlyReservation);
    }
  }


  /**
   * Duplicate a post group as a new draft.
   * Copies all content and media. Optionally re-targets to a different channel.
   */
  async duplicatePost(
    orgId: string,
    group: string,
    targetIntegrationId?: string,
    date?: string,
  ) {
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    if (!loadAll?.length) {
      throw new BadRequestException('Post group not found');
    }

    const source = this.arrangePostsByGroup(loadAll, undefined);
    const firstPost = source[0];

    // Resolve target integration (same channel or different)
    const integrationId = targetIntegrationId || firstPost.integrationId;
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId,
    );
    if (!integration) {
      throw new BadRequestException('Target channel not found');
    }

    // Build the payload in the same shape createPost expects
    const value = source.map((p) => ({
      content: p.content || '',
      image: JSON.parse(p.image || '[]'),
    }));

    // firstComment lives only on the group's main row. It was omitted here
    // while thread parts were copied, so duplicating a post silently dropped
    // it — invisible until after publish, and it is where hashtags usually
    // live.
    const firstComment =
      loadAll.find((p: any) => p.firstComment)?.firstComment || undefined;

    // Without an explicit date every duplicate landed on tomorrow at the
    // current minute, so duplicating a batch stacked them all on one
    // timestamp. Fall back to the next free queue slot for the target
    // channel, the same way the CSV importer does.
    const resolvedDate =
      date || (await this.findFreeDateTime(orgId, integrationId));

    const postPayload = {
      type: 'draft' as const,
      date: resolvedDate,
      shortLink: false,
      tags: [] as any[],
      posts: [
        {
          integration: { id: integrationId },
          value,
          ...(firstComment ? { firstComment } : {}),
          settings: {
            __type: integration.providerIdentifier,
          },
          group: '',
        },
      ],
    };

    const mapped = await this.mapTypeToPost(postPayload as any, orgId);
    const result = await this.createPost(orgId, mapped, 'WEB');
    const createdId = result[0]?.postId;

    // createPost returns post ids, not the group uuid it generated. `group`
    // used to carry that post id, so GET /posts/group/<value> 404'd on the
    // duplicate — every other posts route is group-keyed. Resolve the real
    // group and return the post id under its own name.
    const created = createdId
      ? await this._postRepository.getPost(createdId, false, orgId)
      : null;

    return {
      duplicated: true,
      source: { group, integration: firstPost.integrationId },
      target: {
        group: created?.group ?? null,
        postId: createdId,
        integration: integrationId,
      },
    };
  }

  async changeState(id: string, state: State, err?: any, body?: any, orgId?: string) {
    return this._postRepository.changeState(id, state, err, body, orgId);
  }

  /**
   * Blocks changeDate/changePostStatus from touching a post that is
   * PUBLISHED (already went out — not this endpoint's job) or in APPROVAL
   * (pending human review — moving it must go through the dedicated
   * approve/reject endpoints in ApprovalService, which are role-gated and
   * resolve the Approval record; this generic status/date endpoint is open
   * to any org member and any Public API key, so leaving it able to flip
   * APPROVAL -> QUEUE silently pulls a post out of review). Mirrors the
   * frontend's own isDraggableStatus() exclusion, which only ever guarded
   * the calendar drag handler, not the API these requests ultimately hit.
   */
  private assertMutable(post: { state: string }): void {
    if (post.state === 'PUBLISHED' || post.state === 'APPROVAL') {
      throw new BadRequestException(
        `Cannot change a post that is ${post.state === 'APPROVAL' ? 'pending approval' : 'already published'}`
      );
    }
  }

  async changePostStatus(
    orgId: string,
    id: string,
    status: 'draft' | 'schedule',
    // Only ApprovalService.onApproved sets this — it has already run
    // assertCanApprove(role) + assertPending(approval) before calling in, so
    // an APPROVAL post reaching here IS the authorized approve action, not
    // the bypass this guard exists to stop.
    allowApprovalTransition = false
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);
    if (!getPostById) {
      throw new BadRequestException('Post not found');
    }
    if (!(allowApprovalTransition && getPostById.state === 'APPROVAL')) {
      this.assertMutable(getPostById);
    }

    const state: State = status === 'draft' ? 'DRAFT' : 'QUEUE';
    if (status === 'schedule') {
      // A paused org may move posts to draft, but not arm them for publish.
      await this.assertOrgNotPausedForSchedule(orgId);
    }
    let monthlyReservation: string | null = null;
    if (state === 'QUEUE' && getPostById.state !== 'QUEUE') {
      try {
        monthlyReservation = await this._subscriptionService.reserveMonthlyPostSlots(orgId, 1);
      } catch (error) {
        if (error instanceof MonthlyPostQuotaExceededError) {
          throw new HttpException('Monthly post limit reached. Choose a plan to continue.', HttpStatus.PAYMENT_REQUIRED);
        }
        throw error;
      }
    }
    try {
      await this._postRepository.changeState(id, state, undefined, undefined, orgId);

      // No swallow: if the workflow cannot be scheduled the post is already
      // marked ERROR (inside startWorkflow) and the user must see the failure
      // instead of a green "scheduled" response over a post that will never
      // publish.
      await this.startWorkflow(
        getPostById.integration.providerIdentifier.split('-')[0].toLowerCase(),
        getPostById.id,
        orgId,
        state
      );
    } finally {
      await this._subscriptionService.releaseMonthlyPostReservation(monthlyReservation);
    }

    return { id, state };
  }

  /** Set post to an explicit state (APPROVAL ↔ DRAFT for the approval flow). */
  async setPostState(orgId: string, postId: string, state: State) {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post) throw new BadRequestException('Post not found');
    await this._postRepository.changeState(postId, state, undefined, undefined, orgId);
    return { id: postId, state };
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    action: 'schedule' | 'update' = 'schedule'
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);

    if (!getPostById) {
      throw new BadRequestException('Post not found');
    }
    this.assertMutable(getPostById);

    // Emergency Pause gate: rescheduling a post that would be re-armed to
    // QUEUE is blocked while paused (a draft reschedule stays a draft, so it
    // is allowed).
    if (action === 'schedule' && getPostById.state !== 'DRAFT') {
      await this.assertOrgNotPausedForSchedule(orgId);
    }

    // schedule: Set status to QUEUE and change date (reschedule the post)
    // update: Just change the date without changing the status
    const newDate = await this._postRepository.changeDate(
      orgId,
      id,
      date,
      getPostById.state === 'DRAFT',
      action
    );

    if (action === 'schedule') {
      // No swallow — same reasoning as changePostStatus: a reschedule that
      // silently failed to move the workflow leaves the DB date and the actual
      // publish time out of sync forever.
      await this.startWorkflow(
        getPostById.integration.providerIdentifier
          .split('-')[0]
          .toLowerCase(),
        getPostById.id,
        orgId,
        getPostById.state === 'DRAFT' ? 'DRAFT' : 'QUEUE'
      );
    }

    return newDate;
  }

  findAllExistingCategories() {
    return this._postRepository.findAllExistingCategories();
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._postRepository.findAllExistingTopicsOfCategory(category);
  }

  findPopularPosts(category: string, topic?: string) {
    return this._postRepository.findPopularPosts(category, topic);
  }

  async findFreeDateTime(orgId: string, integrationId?: string) {
    const { slots, timezone } = await this._integrationService.findFreeDateTime(
      orgId,
      integrationId
    );
    // A channel with no posting times configured would otherwise recurse 365
    // days and throw a 400. Fall back to sensible default hours (every day) so
    // quick-scheduling always returns a slot; the 365-day guard stays a true
    // safety net.
    const effective =
      slots?.length > 0
        ? slots
        : [9, 12, 15, 18].map((h) => ({ time: h * 60 }));
    // Anchored in the channel's own timezone (default 'UTC' — identical to
    // the old behavior for every channel that hasn't set one) so a "9am"
    // slot resolves to the correct UTC instant for the actual calendar date,
    // DST included, instead of a frozen offset baked in once.
    const start = dayjs().tz(timezone).startOf('day');
    return this.findFreeDateTimeRecursive(
      orgId,
      effective,
      start,
      start,
      integrationId
    );
  }

  async createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._postRepository.createPopularPosts(post);
  }

  private async findFreeDateTimeRecursive(
    orgId: string,
    slots: { time: number; days?: number[] }[],
    date: dayjs.Dayjs,
    start: dayjs.Dayjs,
    integrationId?: string
  ): Promise<string> {
    // Safety guard: never loop forever when a channel has no posting times.
    if (date.diff(start, 'day') > 365) {
      throw new BadRequestException(
        'No free posting slot found. Configure posting times for this channel.'
      );
    }

    // Only the slots scheduled for this weekday apply (see slotsForDay).
    const times = slotsForDay(slots, date.day());

    if (!times.length) {
      return this.findFreeDateTimeRecursive(
        orgId,
        slots,
        date.add(1, 'day'),
        start,
        integrationId
      );
    }

    const list = await this._postRepository.getPostsCountsByDates(
      orgId,
      times,
      date,
      integrationId
    );

    if (!list.length) {
      return this.findFreeDateTimeRecursive(
        orgId,
        slots,
        date.add(1, 'day'),
        start,
        integrationId
      );
    }

    const num = list.reduce<null | number>((prev, curr) => {
      if (prev === null || prev > curr) {
        return curr;
      }
      return prev;
    }, null) as number;

    // `date` may be anchored in the channel's own timezone (not UTC) — the
    // documented contract of this function is a UTC wall-clock string
    // (callers append 'Z'), so convert back to UTC before formatting.
    return date.clone().add(num, 'minutes').utc().format('YYYY-MM-DDTHH:mm:00');
  }

  getComments(postId: string) {
    return this._postRepository.getComments(postId);
  }

  getTags(orgId: string) {
    return this._postRepository.getTags(orgId);
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._postRepository.createTag(orgId, body);
  }

  editTag(id: string, orgId: string, body: CreateTagDto) {
    return this._postRepository.editTag(id, orgId, body);
  }

  deleteTag(id: string, orgId: string) {
    return this._postRepository.deleteTag(id, orgId);
  }

  async createComment(
    orgId: string,
    userId: string,
    postId: string,
    comment: string
  ) {
    // Make sure the post actually belongs to this organization before
    // attaching a comment — otherwise a user could comment on posts by id
    // across organizations.
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post) {
      throw new BadRequestException('Post not found');
    }
    return this._postRepository.createComment(orgId, userId, postId, comment);
  }

  async getCommentsForOrg(orgId: string, postId: string) {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post) {
      throw new BadRequestException('Post not found');
    }
    return this._postRepository.getCommentsForOrg(orgId, postId);
  }
}
