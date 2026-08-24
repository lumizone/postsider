import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { timer } from '@postsider/helpers/utils/timer';
import dayjs from 'dayjs';
import {
  SocialAbstract,
  ValidityMedia,
} from '@postsider/nestjs-libraries/integrations/social.abstract';
import { InstagramDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/instagram.dto';
import { Integration } from '@prisma/client';
import { Rules } from '@postsider/nestjs-libraries/chat/rules.description.decorator';
import { hasExtension } from '@postsider/helpers/utils/has.extension';

@Rules(
  "Instagram should have at least one attachment, if it's a story, it can have only one picture"
)
export class InstagramProvider
  extends SocialAbstract
  implements SocialProvider
{
  identifier = 'instagram';
  name = 'Instagram\n(Facebook Business)';
  isBetweenSteps = true;
  toolTip = 'Instagram must be business and connected to a Facebook page';
  scopes = [
    'instagram_basic',
    'pages_show_list',
    'pages_read_engagement',
    'business_management',
    'instagram_content_publish',
    'instagram_manage_comments',
    'instagram_manage_insights',
  ];
  override maxConcurrentJob = 400;
  editor = 'normal' as const;
  dto = InstagramDto;
  maxLength() {
    return 2200;
  }

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (!firstPost?.length) {
      return 'Should have at least one media';
    }
    if (firstPost.length > 10) {
      return 'Instagram carousel only supports up to 10 media attachments';
    }
    if (settings?.is_trial_reel) {
      if ((firstPost?.length ?? 0) > 1) {
        return 'Trial Reels can only have one video';
      }
      const hasVideo = firstPost?.some(
        (f) => (f?.path?.indexOf?.('mp4') ?? -1) > -1
      );
      if (!hasVideo) {
        return 'Trial Reels must be a video';
      }
    }
    return true;
  }

  /**
   * Poll an Instagram media container until it leaves IN_PROGRESS.
   *
   * The previous loop slept a flat 30s at the END of every iteration —
   * including the one that already saw FINISHED — so a container that Meta
   * reported ready on the first check (typical: 1-3s for an image) still cost
   * a full 30s, and a carousel paid that twice. That was the whole reason
   * Instagram posts landed 70-105s after their scheduled time while X landed
   * in 3-6s. Return as soon as the status settles, and start with a short
   * interval that backs off, so quick containers are fast and slow ones
   * (video transcoding) still get roughly the same ~20 minute budget.
   */
  private async waitForContainer(url: string): Promise<string> {
    const MAX_WAIT_MS = 20 * 60 * 1000;
    const MAX_INTERVAL_MS = 30000;
    let interval = 2000;
    const deadline = Date.now() + MAX_WAIT_MS;
    let status = 'IN_PROGRESS';

    while (Date.now() < deadline) {
      const { status_code } = await (
        await this.fetch(url, undefined, '', 0, true)
      ).json();
      // A missing status_code is an error payload, not "done" — keep polling
      // so we never publish an unfinished container.
      status = status_code || 'IN_PROGRESS';
      if (status !== 'IN_PROGRESS') {
        return status;
      }
      await timer(Math.min(interval, deadline - Date.now()));
      interval = Math.min(interval * 1.5, MAX_INTERVAL_MS);
    }

    return status;
  }

  async refreshToken(
    refresh_token: string,
    integration?: Integration
  ): Promise<AuthTokenDetails> {
    // Same fb_exchange_token re-mint as FacebookProvider — this stored
    // refresh_token is the long-lived Meta USER token. The stored `token`
    // column, though, is the composite `pageToken___userToken`
    // (see fetchPageInformation/post): a bare refreshed user token can't
    // replace it wholesale without breaking every `token.split('___')` call.
    // The page-token half doesn't independently expire (it's minted from the
    // user token on demand), so we keep it as-is and only refresh the user
    // token half.
    const { access_token, expires_in } = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${refresh_token}`
      )
    ).json();

    if (!access_token) {
      throw new Error('Instagram token refresh failed: no access_token returned');
    }

    const [existingPageToken] = (integration?.token || '').split('___');

    return {
      id: '',
      name: '',
      accessToken: existingPageToken
        ? `${existingPageToken}___${access_token}`
        : access_token,
      refreshToken: access_token,
      expiresIn:
        expires_in || dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: '',
      username: '',
    };
  }

  public override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body' | 'retry';
        value: string;
      }
    | undefined {
    if (body.indexOf('An unknown error occurred') > -1) {
      return {
        type: 'retry' as const,
        value: 'An unknown error occurred, please try again later',
      };
    }
    if (body.indexOf('2207081') > -1) {
      return {
        type: 'bad-body' as const,
        value: "This account doesn't support Trial Reels",
      };
    }

    if (
      body.indexOf('REVOKED_ACCESS_TOKEN') > -1 ||
      body.indexOf('"error_subcode":33') > -1
    ) {
      return {
        type: 'refresh-token' as const,
        value:
          'Something is wrong with your connected user, please re-authenticate',
      };
    }

    if (
      body.toLowerCase().indexOf('the user is not an instagram business') > -1
    ) {
      return {
        type: 'refresh-token' as const,
        value:
          'Your Instagram account is not a business account, please convert it to a business account',
      };
    }

    if (body.toLowerCase().indexOf('session has been invalidated') > -1) {
      return {
        type: 'refresh-token' as const,
        value:
          'You session has been invalidated, this can usually happen from frequent posting, please re-authenticate, and wait 1-2 days before posting again',
      };
    }

    if (body.indexOf('2207050') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram user is restricted',
      };
    }

    // Media download/upload errors
    if (body.indexOf('2207003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Timeout downloading media, please try again',
      };
    }

    if (body.indexOf('2207020') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media expired, please upload again',
      };
    }

    if (body.indexOf('2207032') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to create media, please try again',
      };
    }

    if (body.indexOf('2207053') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown upload error, please try again',
      };
    }

    if (body.indexOf('2207052') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media fetch failed, please try again',
      };
    }

    if (body.indexOf('2207057') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid thumbnail offset for video',
      };
    }

    if (body.indexOf('2207026') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported video format',
      };
    }

    if (body.indexOf('2207023') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown media type',
      };
    }

    if (body.indexOf('2207006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media not found, please upload again',
      };
    }

    if (body.indexOf('2207008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Media builder expired, please try again',
      };
    }

    // Content validation errors
    if (body.indexOf('2207028') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Carousel validation failed',
      };
    }

    if (body.indexOf('2207010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Caption is too long',
      };
    }

    // Product tagging errors
    if (body.indexOf('2207035') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions not supported for videos',
      };
    }

    if (body.indexOf('2207036') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag positions required for photos',
      };
    }

    if (body.indexOf('2207037') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Product tag validation failed',
      };
    }

    if (body.indexOf('2207040') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Too many product tags',
      };
    }

    // Image format/size errors
    if (body.indexOf('2207004') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Image is too large',
      };
    }

    if (body.indexOf('2207005') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unsupported image format',
      };
    }

    if (body.indexOf('2207009') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    if (body.indexOf('Page request limit reached') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Page posting for today is limited, please try again tomorrow',
      };
    }

    if (body.indexOf('2207042') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'You have reached the maximum of 25 posts per day, allowed for your account',
      };
    }

    if (body.indexOf('Not enough permissions to post') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Not enough permissions to post',
      };
    }

    if (body.indexOf('36003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Aspect ratio not supported, must be between 4:5 to 1.91:1',
      };
    }

    if (body.indexOf('190,') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'The account is missing some permissions to perform this action, please re-add the account and allow all permissions',
      };
    }

    if (body.indexOf('36001') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid Instagram image resolution max: 1920x1080px',
      };
    }

    if (body.indexOf('2207051') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram blocked your request',
      };
    }

    if (body.indexOf('2207001') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Instagram detected that your post is spam, please try again with different content',
      };
    }

    if (body.indexOf('2207077') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram Video download failed',
      };
    }

    if (body.indexOf('too little or too many attachments') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Instagram carousel should have between 2 and 10 media attachments',
      }
    }

    if (body.indexOf('2207027') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Unknown error, please try again later or contact support',
      };
    }

    if (body.indexOf('param collaborators is not allowed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Collaborators are not allowed for carousel',
      };
    }

    return undefined;
  }

  async reConnect(
    id: string,
    requiredId: string,
    token: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const [accessToken, userToken] = token.split('___');
    const findPage = (await this.pages(accessToken)).find(
      (p) => p.id === requiredId
    );

    const information = await this.fetchPageInformation(accessToken, {
      id: requiredId,
      pageId: findPage?.pageId!,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url:
        'https://www.facebook.com/v20.0/dialog/oauth' +
        `?client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/instagram`
        )}` +
        `&state=${state}` +
        `&scope=${encodeURIComponent(this.scopes.join(','))}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const getAccessToken = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          `?client_id=${process.env.FACEBOOK_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/instagram${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token, expires_in, ...all } = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${getAccessToken.access_token}`
      )
    ).json();

    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me/permissions?access_token=${access_token}`
      )
    ).json();

    const permissions = data
      .filter((d: any) => d.status === 'granted')
      .map((p: any) => p.permission);
    this.checkScopes(this.scopes, permissions);

    const { id, name, picture } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me?fields=id,name,picture&access_token=${access_token}`
      )
    ).json();

    return {
      // Prefix the temporary id with the provider so a two-step Instagram
      // connection doesn't collide with a Facebook integration that shares the
      // same Facebook user id. fetchPageInformation replaces this with the real
      // Instagram account id once the user picks an account.
      id: `instagram-${id}`,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: picture?.data?.url || '',
      username: '',
    };
  }

  async pages(token: string) {
    const [accessToken, userToken] = token.split('___');
    const seenPageIds = new Set<string>();
    const allFacebookPages: any[] = [];

    const fetchPaginated = async (startUrl: string) => {
      let nextUrl: string | undefined = startUrl;
      while (nextUrl) {
        const response = await (await fetch(nextUrl)).json();
        if (response.data) {
          for (const page of response.data) {
            if (!seenPageIds.has(page.id)) {
              seenPageIds.add(page.id);
              allFacebookPages.push(page);
            }
          }
        }
        nextUrl = response.paging?.next;
      }
    };

    // Fetch pages the user explicitly shared during the OAuth dialog
    await fetchPaginated(
      `https://graph.facebook.com/v20.0/me/accounts?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
    );

    // Also fetch pages via Business Manager API to discover pages
    // not selected during the OAuth page selection step
    try {
      let bizUrl:
        | string
        | undefined = `https://graph.facebook.com/v20.0/me/businesses?access_token=${accessToken}`;

      while (bizUrl) {
        const bizResponse = await (await fetch(bizUrl)).json();
        if (bizResponse.data) {
          for (const business of bizResponse.data) {
            try {
              await fetchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/owned_pages?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }

            try {
              await fetchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/client_pages?fields=id,instagram_business_account,username,name,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }
          }
        }
        bizUrl = bizResponse.paging?.next;
      }
    } catch {
      // Business Manager API not available for all users
    }

    const onlyConnectedAccounts = await Promise.all(
      allFacebookPages
        .filter((f: any) => f.instagram_business_account)
        .map(async (p: any) => {
          return {
            pageId: p.id,
            ...(await (
              await fetch(
                `https://graph.facebook.com/v20.0/${p.instagram_business_account.id}?fields=name,profile_picture_url&access_token=${accessToken}`
              )
            ).json()),
            id: p.instagram_business_account.id,
          };
        })
    );

    return onlyConnectedAccounts.map((p: any) => ({
      pageId: p.pageId,
      id: p.id,
      // The generic connect-picker (oauth-callback.tsx handlePickPage) only
      // round-trips ONE field back to fetchPageInformation — `page.page`,
      // falling back to `page.id` only when `page.page` is missing. This
      // provider needs BOTH the Facebook Page id (for the page access token)
      // and the IG Business Account id (for the account's own name/picture),
      // so without a `page` field here, the picker sent back `id` under the
      // key `page` and `pageId` was silently undefined on every connection —
      // the first Graph fetch below 404'd, and the wrong page access token
      // was persisted. Packing both into one composite string here needs no
      // frontend change: the picker already prefers `page.page`.
      page: `${p.pageId}:${p.id}`,
      name: p.name,
      // Flat URL string — the picker renders <img src={picture}>, so a
      // { data: { url } } object showed up as a broken image.
      picture: p.profile_picture_url || '',
    }));
  }

  async fetchPageInformation(
    token: string,
    data: { page?: string; pageId?: string; id?: string }
  ) {
    const [accessToken, userToken] = token.split('___');
    // `data.page` is the composite `${pageId}:${igAccountId}` from pages()
    // above. Prefer explicit pageId/id when a caller passes the old shape
    // directly (e.g. tests), otherwise unpack the composite string.
    const [composedPageId, composedIgId] = (data.page || '').split(':');
    const pageId = data.pageId || composedPageId;
    const igId = data.id || composedIgId;

    const { access_token, ...all } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/${pageId}?fields=access_token,name,picture.type(large)&access_token=${accessToken}`
      )
    ).json();

    const { id, name, profile_picture_url, username } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/${igId}?fields=id,username,name,profile_picture_url&access_token=${accessToken}`
      )
    ).json();

    return {
      // Fall back to the id we already queried by (`igId`) — Graph API
      // does not reliably echo `id` back on a node fetched by its own id,
      // and destructuring an absent field silently produced `String(undefined)`
      // ("undefined" as a literal string) as the persisted internalId, which
      // then targeted every publish/media call at .../undefined/media.
      id: id || igId,
      name,
      picture: profile_picture_url,
      access_token: access_token + '___' + accessToken,
      username,
    };
  }

  async post(
    id: string,
    token: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [accessToken, userToken] = token.split('___');
    const [firstPost] = postDetails;
    console.log('in progress', id);
    const isStory = firstPost.settings.post_type === 'story';
    const isTrialReel = !!firstPost.settings.is_trial_reel;
    const medias = await Promise.all(
      firstPost?.media?.map(async (m) => {
        const caption =
          firstPost.media?.length === 1
            ? `&caption=${encodeURIComponent(firstPost.message)}`
            : ``;
        const isCarousel =
          (firstPost?.media?.length || 0) > 1 && !isStory
            ? `&is_carousel_item=true`
            : ``;
        const mediaType = hasExtension(m.path, 'mp4')
          ? firstPost?.media?.length === 1
            ? isStory
              ? `video_url=${encodeURIComponent(m.path)}&media_type=STORIES`
              : `video_url=${encodeURIComponent(
                  m.path
                )}&media_type=REELS&thumb_offset=${
                  m?.thumbnailTimestamp || 0
                }`
            : isStory
            ? `video_url=${encodeURIComponent(m.path)}&media_type=STORIES`
            : `video_url=${encodeURIComponent(
                m.path
              )}&media_type=VIDEO&thumb_offset=${
                m?.thumbnailTimestamp || 0
              }`
          : isStory
          ? `image_url=${encodeURIComponent(m.path)}&media_type=STORIES`
          : `image_url=${encodeURIComponent(m.path)}`;

        const trialParams = isTrialReel
          ? `&trial_params=${encodeURIComponent(
              JSON.stringify({
                graduation_strategy:
                  firstPost.settings.graduation_strategy || 'MANUAL',
              })
            )}`
          : ``;

        const collaborators =
          firstPost?.settings?.collaborators?.length && !isStory
            ? `&collaborators=${encodeURIComponent(
                JSON.stringify(
                  firstPost?.settings?.collaborators.map((p) => p.label)
                )
              )}`
            : ``;

        const { id: photoId } = await (
          await this.fetch(
            `https://${type}/v20.0/${id}/media?${mediaType}${isCarousel}${collaborators}${trialParams}&access_token=${accessToken}${caption}`,
            {
              method: 'POST',
            }
          )
        ).json();
        console.log('in progress2', id);

        const status = await this.waitForContainer(
          `https://${type}/v20.0/${photoId}?access_token=${
            userToken || accessToken
          }&fields=status_code`
        );
        if (status !== 'FINISHED') {
          throw new Error(`Instagram media not ready (status: ${status})`);
        }
        console.log('in progress3', id);

        return photoId;
      }) || []
    );

    if (isStory && medias.length > 1) {
      // Stories don't support carousels - publish each media as a separate story
      let lastMediaId = '';
      let lastPermalink = '';
      for (const mediaCreationId of medias) {
        const { id: mediaId } = await (
          await this.fetch(
            `https://${type}/v20.0/${id}/media_publish?creation_id=${mediaCreationId}&access_token=${accessToken}&field=id`,
            {
              method: 'POST',
            }
          )
        ).json();
        lastMediaId = mediaId;

        const { permalink } = await (
          await this.fetch(
            `https://${type}/v20.0/${mediaId}?fields=permalink&access_token=${
              userToken || accessToken
            }`
          )
        ).json();
        lastPermalink = permalink;
      }

      return [
        {
          id: firstPost.id,
          postId: lastMediaId,
          releaseURL: lastPermalink,
          status: 'success',
        },
      ];
    } else if (medias.length === 1) {
      const { id: mediaId } = await (
        await this.fetch(
          `https://${type}/v20.0/${id}/media_publish?creation_id=${medias[0]}&access_token=${accessToken}&field=id`,
          {
            method: 'POST',
          }
        )
      ).json();

      const { permalink } = await (
        await this.fetch(
          `https://${type}/v20.0/${mediaId}?fields=permalink&access_token=${
            userToken || accessToken
          }`
        )
      ).json();

      return [
        {
          id: firstPost.id,
          postId: mediaId,
          releaseURL: permalink,
          status: 'success',
        },
      ];
    } else {
      const { id: containerId, ...all3 } = await (
        await this.fetch(
          `https://${type}/v20.0/${id}/media?caption=${encodeURIComponent(
            firstPost?.message
          )}&media_type=CAROUSEL&children=${encodeURIComponent(
            medias.join(',')
          )}&access_token=${accessToken}`,
          {
            method: 'POST',
          }
        )
      ).json();

      const status = await this.waitForContainer(
        `https://${type}/v20.0/${containerId}?fields=status_code&access_token=${
          userToken || accessToken
        }`
      );
      if (status !== 'FINISHED') {
        throw new Error(`Instagram carousel not ready (status: ${status})`);
      }

      const { id: mediaId, ...all4 } = await (
        await this.fetch(
          `https://${type}/v20.0/${id}/media_publish?creation_id=${containerId}&access_token=${accessToken}&field=id`,
          {
            method: 'POST',
          }
        )
      ).json();

      const { permalink } = await (
        await this.fetch(
          `https://${type}/v20.0/${mediaId}?fields=permalink&access_token=${
            userToken || accessToken
          }`
        )
      ).json();

      return [
        {
          id: firstPost.id,
          postId: mediaId,
          releaseURL: permalink,
          status: 'success',
        },
      ];
    }
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    token: string,
    postDetails: PostDetails<InstagramDto>[],
    integration: Integration,
    type = 'graph.facebook.com'
  ): Promise<PostResponse[]> {
    const [accessToken, userToken] = token.split('___');
    const [commentPost] = postDetails;

    const { id: commentId } = await (
      await this.fetch(
        `https://${type}/v20.0/${postId}/comments?message=${encodeURIComponent(
          commentPost.message
        )}&access_token=${accessToken}`,
        {
          method: 'POST',
        }
      )
    ).json();

    // Get the permalink from the parent post
    const { permalink } = await (
      await this.fetch(
        `https://${type}/v20.0/${postId}?fields=permalink&access_token=${
          userToken || accessToken
        }`
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: commentId,
        releaseURL: permalink,
        status: 'success',
      },
    ];
  }

  private setTitle(name: string) {
    switch (name) {
      case 'likes': {
        return 'Likes';
      }

      case 'followers': {
        return 'Followers';
      }

      case 'reach': {
        return 'Reach';
      }

      case 'follower_count': {
        return 'Follower Count';
      }

      case 'views': {
        return 'Views';
      }

      case 'comments': {
        return 'Comments';
      }

      case 'shares': {
        return 'Shares';
      }

      case 'saves': {
        return 'Saves';
      }

      case 'replies': {
        return 'Replies';
      }
    }

    return '';
  }

  async analytics(
    id: string,
    token: string,
    date: number,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    const [accessToken, userToken] = token.split('___');
    const until = dayjs().startOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    const { data, ...all } = await (
      await fetch(
        `https://${type}/v21.0/${id}/insights?metric=follower_count,reach&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    const { data: data2, ...all2 } = await (
      await fetch(
        `https://${type}/v21.0/${id}/insights?metric_type=total_value&metric=likes,views,comments,shares,saves,replies&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();
    const analytics: any[] = [];

    analytics.push(
      ...(data?.map((d: any) => ({
        label: this.setTitle(d.name),
        // No percentage change: the platform API returns a point-in-time value
        // and nothing is persisted to compare against, so any number here is
        // invented. The frontend hides the badge when this is absent.
        data: d.values.map((v: any) => ({
          total: v.value,
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
        })),
      })) || [])
    );

    analytics.push(
      ...data2.map((d: any) => ({
        label: this.setTitle(d.name),
        // No percentage change: the platform API returns a point-in-time value
        // and nothing is persisted to compare against, so any number here is
        // invented. The frontend hides the badge when this is absent.
        data: [
          {
            total: d.total_value.value,
            date: dayjs().format('YYYY-MM-DD'),
          },
        ],
      }))
    );

    return analytics;
  }

  music(accessToken: string, data: { q: string }) {
    return this.fetch(
      `https://graph.facebook.com/v20.0/music/search?q=${encodeURIComponent(
        data.q
      )}&access_token=${accessToken}`
    );
  }

  async postAnalytics(
    integrationId: string,
    token: string,
    postId: string,
    date: number,
    type = 'graph.facebook.com'
  ): Promise<AnalyticsData[]> {
    const [accessToken, userToken] = token.split('___');
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Fetch media insights from Instagram Graph API
      const { data } = await (
        await this.fetch(
          `https://${type}/v21.0/${postId}/insights?metric=views,reach,saved,likes,comments,shares&access_token=${accessToken}`
        )
      ).json();

      if (!data || data.length === 0) {
        return [];
      }

      const result: AnalyticsData[] = [];

      for (const metric of data) {
        const value = metric.values?.[0]?.value;
        if (value === undefined) continue;

        let label = '';

        switch (metric.name) {
          case 'views':
            label = 'Views';
            break;
          case 'reach':
            label = 'Reach';
            break;
          case 'engagement':
            label = 'Engagement';
            break;
          case 'saved':
            label = 'Saves';
            break;
          case 'likes':
            label = 'Likes';
            break;
          case 'comments':
            label = 'Comments';
            break;
          case 'shares':
            label = 'Shares';
            break;
        }

        if (label) {
          result.push({
            label,
            percentageChange: 0,
            data: [{ total: String(value), date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      console.error('Error fetching Instagram post analytics:', err);
      return [];
    }
  }
}
