import { Injectable } from '@nestjs/common';
import {
  Activity,
  ActivityMethod,
  TemporalService,
} from 'nestjs-temporal-core';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import {
  NotificationService,
  NotificationType,
} from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { Integration, Post, State } from '@prisma/client';
import { stripHtmlValidation } from '@postsider/helpers/utils/strip.html.validation';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { AuthTokenDetails } from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { RefreshIntegrationService } from '@postsider/nestjs-libraries/integrations/refresh.integration.service';
import { timer } from '@postsider/helpers/utils/timer';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { WebhooksService } from '@postsider/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@postsider/nestjs-libraries/temporal/temporal.search.attribute';
import { SubscriptionService } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { ProviderEnvHelper } from '@postsider/nestjs-libraries/integrations/provider-env.helper';
import { isBillingEnabled } from '@postsider/nestjs-libraries/services/billing.flag';

// Drops fields the workflow and downstream activities never read — biggest wins are `error` (grows per retry) and `childrenPost` (Prisma side-loads it on every recursive row).
function slimPost(post: any) {
  if (!post) return post;
  const {
    error,
    childrenPost,
    tags,
    description,
    title,
    submittedForOrderId,
    submittedForOrganizationId,
    submittedForOrder,
    submittedForOrganization,
    lastMessageId,
    parentPostId,
    approvedSubmitForOrder,
    deletedAt,
    createdAt,
    updatedAt,
    payoutProblems,
    comments,
    errors,
    ...rest
  } = post;
  return rest;
}

@Injectable()
@Activity()
export class PostActivity {
  constructor(
    private _postService: PostsService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _webhookService: WebhooksService,
    private _temporalService: TemporalService,
    private _subscriptionService: SubscriptionService,
    private _providerEnvHelper: ProviderEnvHelper,
  ) {}

  @ActivityMethod()
  async getIntegrationById(orgId: string, id: string) {
    return this._integrationService.getIntegrationById(orgId, id);
  }

  @ActivityMethod()
  async searchForMissingThreeHoursPosts() {
    const list = await this._postService.searchForMissingThreeHoursPosts();
    for (const post of list) {
      await this._temporalService.client!
        .getRawClient()!
        .workflow.signalWithStart('postWorkflowV105', {
          workflowId: `post_${post.id}`,
          taskQueue: 'main',
          signal: 'poke',
          workflowIdConflictPolicy: 'USE_EXISTING',
          signalArgs: [],
          args: [
            {
              taskQueue: post.integration.providerIdentifier
                .split('-')[0]
                .toLowerCase(),
              postId: post.id,
              organizationId: post.organizationId,
            },
          ],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: postIdSearchParam,
              value: post.id,
            },
            {
              key: organizationId,
              value: post.organizationId,
            },
          ]),
        });
    }
  }

  @ActivityMethod()
  async updatePost(id: string, postId: string, releaseURL: string) {
    await this._postService.updatePost(id, postId, releaseURL);
  }

  @ActivityMethod()
  async getPost(orgId: string, postId: string) {
    if (isBillingEnabled()) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return false;
      }
    }
    const post = await this._postService.getPostById(postId, orgId);
    if (post!.deletedAt) {
      return false;
    }

    return post;
  }

  @ActivityMethod()
  async getPostsList(orgId: string, postId: string) {
    if (isBillingEnabled()) {
      const subscription = await this._subscriptionService.getSubscription(
        orgId
      );
      if (!subscription) {
        return [];
      }
    }

    const getPosts = await this._postService.getPostsRecursively(
      postId,
      true,
      orgId
    );
    if (!getPosts || getPosts.length === 0 || getPosts[0].parentPostId) {
      return [];
    }

    return getPosts.map(slimPost);
  }

  @ActivityMethod()
  async isCommentable(integration: Integration) {
    const getIntegration = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    return !!getIntegration.comment;
  }

  @ActivityMethod()
  async postComment(
    postId: string,
    lastPostId: string | undefined,
    integration: Integration,
    posts: Post[]
  ) {
    return this._providerEnvHelper.withCredentials(
      integration.organizationId,
      integration.providerIdentifier,
      async () => {
        const getIntegration = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        const newPosts = await this._postService.updateTags(
          integration.organizationId,
          posts
        );

        return getIntegration.comment!(
          integration.internalId,
          postId,
          lastPostId,
          integration.token,
          await Promise.all(
            (newPosts || []).map(async (p) => ({
              id: p.id,
              message: stripHtmlValidation(
                getIntegration.editor,
                p.content,
                true,
                false,
                !/<\/?[a-z][\s\S]*>/i.test(p.content),
                getIntegration.mentionFormat
              ),
              settings: JSON.parse(p.settings || '{}'),
              media: await this._postService.updateMedia(
                p.id,
                JSON.parse(p.image || '[]'),
                getIntegration?.convertToJPEG || false
              ),
            }))
          ),
          integration
        );
      },
    );
  }

  @ActivityMethod()
  async postSocial(integration: Integration, posts: Post[]) {
    return this._providerEnvHelper.withCredentials(
      integration.organizationId,
      integration.providerIdentifier,
      async () => {
        if (isBillingEnabled()) {
          const subscription = await this._subscriptionService.getSubscription(
            integration.organizationId
          );

          if (!subscription) {
            throw new Error('No active subscription found for this organization.');
          }
        }

        const getIntegration = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );
        // Orphaned integration for a provider that no longer exists — fail this
        // post cleanly (workflow marks it ERROR) instead of crashing on undefined.
        if (!getIntegration) {
          throw new Error(
            `Provider "${integration.providerIdentifier}" is no longer supported`
          );
        }

        const newPosts = await this._postService.updateTags(
          integration.organizationId,
          posts
        );

        const postNow = await getIntegration.post(
          integration.internalId,
          integration.token,
          await Promise.all(
            (newPosts || []).map(async (p) => ({
              id: p.id,
              message: stripHtmlValidation(
                getIntegration.editor,
                p.content,
                true,
                false,
                !/<\/?[a-z][\s\S]*>/i.test(p.content),
                getIntegration.mentionFormat
              ),
              settings: JSON.parse(p.settings || '{}'),
              media: await this._postService.updateMedia(
                p.id,
                JSON.parse(p.image || '[]'),
                getIntegration?.convertToJPEG || false
              ),
            }))
          ),
          integration
        );

        await this._temporalService.client!
          .getRawClient()!
          .workflow.start('streakWorkflow', {
            args: [{ organizationId: integration.organizationId }],
            workflowId: `streak_${integration.organizationId}`,
            taskQueue: 'main',
            workflowIdConflictPolicy: 'TERMINATE_EXISTING',
            typedSearchAttributes: new TypedSearchAttributes([
              {
                key: organizationId,
                value: integration.organizationId,
              },
            ]),
          });

        return postNow;
      },
    );
  }

  @ActivityMethod()
  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success'
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      subject,
      message,
      sendEmail,
      digest,
      type
    );
  }

  @ActivityMethod()
  async globalPlugs(integration: Integration) {
    return this._postService.checkPlugs(
      integration.organizationId,
      integration.providerIdentifier,
      integration.id
    );
  }

  @ActivityMethod()
  async changeState(id: string, state: State, err?: any, body?: any) {
    await this._postService.changeState(id, state, err, body);
  }

  @ActivityMethod()
  async internalPlugs(integration: Integration, settings: any) {
    return this._postService.checkInternalPlug(
      integration,
      integration.organizationId,
      integration.id,
      settings
    );
  }

  @ActivityMethod()
  async sendWebhooks(postId: string, orgId: string, integrationId: string) {
    const webhooks = (await this._webhookService.getWebhooks(orgId)).filter(
      (f) => {
        return (
          f.integrations.length === 0 ||
          f.integrations.some((i) => i.integration.id === integrationId)
        );
      }
    );

    const post = await this._postService.getPostByForWebhookId(postId);
    await Promise.all(
      webhooks.map(async (webhook) => {
        // Retry with exponential backoff (up to 3 attempts)
        // OSS does fire-and-forget with no retry — PostSider improvement.
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const res = await fetch(webhook.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Attempt': String(attempt + 1),
                'X-Postsider-Event': 'post.published',
              },
              body: JSON.stringify(post),
              signal: AbortSignal.timeout(10000),
            });
            if (res.ok || res.status < 500) break; // Success or client error — don't retry
            // Server error — retry after backoff
          } catch (e) {
            // Network error — retry after backoff
          }
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
          }
        }
      })
    );
  }
  @ActivityMethod()
  async processPlug(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    return this._integrationService.processPlugs(data);
  }

  @ActivityMethod()
  async processInternalPlug(data: {
    post: string;
    originalIntegration: string;
    integration: string;
    plugName: string;
    orgId: string;
    delay: number;
    information: any;
  }) {
    await this._integrationService.processInternalPlug(data);
  }

  @ActivityMethod()
  async refreshToken(
    integration: Integration
  ): Promise<false | AuthTokenDetails> {
    return this._providerEnvHelper.withCredentials(
      integration.organizationId,
      integration.providerIdentifier,
      async () => {
        const getIntegration = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        try {
          const refresh = await this._refreshIntegrationService.refresh(
            integration
          );
          if (!refresh) {
            return false;
          }

          if (getIntegration.refreshWait) {
            await timer(10000);
          }

          return refresh;
        } catch (err) {
          await this._refreshIntegrationService.setBetweenSteps(integration);
          return false;
        }
      },
    );
  }

  @ActivityMethod()
  async refreshTokenWithCause(
    integration: Integration,
    cause: string
  ): Promise<false | AuthTokenDetails> {
    return this._providerEnvHelper.withCredentials(
      integration.organizationId,
      integration.providerIdentifier,
      async () => {
        const getIntegration = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        try {
          const refresh = await this._refreshIntegrationService.refresh(
            integration,
            cause
          );
          if (!refresh) {
            return false;
          }

          if (getIntegration.refreshWait) {
            await timer(10000);
          }

          return refresh;
        } catch (err) {
          await this._refreshIntegrationService.setBetweenSteps(integration, cause);
          return false;
        }
      },
    );
  }
}
