import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import dayjs from 'dayjs';
import {
  BadBody,
  SocialAbstract,
  ValidityMedia,
} from '@postsider/nestjs-libraries/integrations/social.abstract';
import { TikTokDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';
import { timer } from '@postsider/helpers/utils/timer';
import { hasExtension } from '@postsider/helpers/utils/has.extension';
import { Integration } from '@prisma/client';
import { Rules } from '@postsider/nestjs-libraries/chat/rules.description.decorator';
import { Tool } from '@postsider/nestjs-libraries/integrations/tool.decorator';

/**
 * Video containers TikTok's Content Posting API accepts for Direct Post
 * (mp4/webm/mov). Anything else that the pipeline treats as video (mkv, avi,
 * m4v, …) is explicitly rejected at validation instead of being silently
 * misclassified as a photo.
 */
const TIKTOK_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'] as const;
/** Known non-photo containers that TikTok does NOT support. */
const OTHER_VIDEO_EXTENSIONS = [
  'mkv',
  'avi',
  'm4v',
  'mpeg',
  'wmv',
  'flv',
] as const;

/**
 * Image containers TikTok's photo endpoint rejects. JPEG and WebP are the
 * supported set; PNG is accepted here because `convertToJPEG` rewrites every
 * PNG to a JPEG upload before the request is built.
 */
const OTHER_IMAGE_EXTENSIONS = [
  'gif',
  'avif',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'svg',
] as const;

/** Content Posting API photo limit: "up to 35 photo content URLs". */
export const TIKTOK_MAX_PHOTOS = 35;
/** Content Posting API photo resolution cap (max 1080p per side). */
export const TIKTOK_MAX_PHOTO_PIXELS = 1080;
/** Content Posting API video resolution: min 360 and max 4096 per side. */
export const TIKTOK_MIN_VIDEO_PIXELS = 360;
export const TIKTOK_MAX_VIDEO_PIXELS = 4096;

const isTikTokVideoPath = (path?: string | null): boolean =>
  TIKTOK_VIDEO_EXTENSIONS.some((ext) => hasExtension(path, ext));

const isOtherVideoPath = (path?: string | null): boolean =>
  OTHER_VIDEO_EXTENSIONS.some((ext) => hasExtension(path, ext));

const isOtherImagePath = (path?: string | null): boolean =>
  OTHER_IMAGE_EXTENSIONS.some((ext) => hasExtension(path, ext));

/**
 * Domains/URL prefixes the app declared to TikTok in Manage URL properties.
 * `PULL_FROM_URL` only works for media under one of them, and TikTok answers
 * `url_ownership_unverified` otherwise. Both env vars are accepted so an
 * existing deployment can keep using the upload-domain restriction; a bare
 * host is normalised to its https form.
 */
function verifiedMediaPrefixes(): string[] {
  return [
    process.env.TIKTOK_VERIFIED_MEDIA_PREFIX,
    process.env.RESTRICT_UPLOAD_DOMAINS,
  ]
    .filter((value): value is string => !!value && value.trim().length > 0)
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter((value) => value.length > 0)
    .map((value) => (value.startsWith('http') ? value : `https://${value}`));
}

/**
 * Whether TikTok is allowed to pull this media URL.
 *
 * Direct Post requires an "https" URL that does not redirect and that lives
 * under a domain or URL prefix the app verified in the developer portal. When
 * no prefix is configured (local dev / self-hosting before verification) only
 * the https rule is enforced, so the failure is actionable rather than every
 * publish failing with `url_ownership_unverified`.
 */
export function isTikTokPullableUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') {
    return false;
  }
  const prefixes = verifiedMediaPrefixes();
  if (!prefixes.length) {
    return true;
  }
  const absolute = `${parsed.origin}${parsed.pathname}`;
  return prefixes.some(
    (prefix) => absolute === prefix || absolute.startsWith(`${prefix}/`)
  );
}

@Rules(
  'TikTok can have one video or one picture or multiple pictures, it cannot be without an attachment'
)
export class TiktokProvider extends SocialAbstract implements SocialProvider {
  identifier = 'tiktok';
  name = 'Tiktok';
  isBetweenSteps = false;
  convertToJPEG = true;
  scopes = [
    'user.info.basic',
    // Direct Post only: `video.publish` covers the init/status/creator_info
    // endpoints. `video.upload` is the other (inbox Upload API) transport and
    // is never used here, so it is not requested.
    'video.publish',
    'user.info.profile',
    'user.info.stats',
    'video.list',
  ];
  override maxConcurrentJob = 300;
  dto = TikTokDto;
  editor = 'normal' as const;
  maxLength() {
    return 2000;
  }

  override async checkValidity(
    items: Array<ValidityMedia[]>,
    // Accepted for interface parity with the other providers; TikTok's rules
    // are derived from the media and the creator, not from additional settings.
    _settings?: unknown,
    _additionalSettings?: unknown[]
  ): Promise<string | true> {
    const [firstItems] = items ?? [];
    if ((firstItems?.length ?? 0) === 0) {
      return 'No video / images selected';
    }
    // A substring match would classify e.g. "promo-mp4-thumb.jpg" as a video,
    // so the extension check is used (matching post/buildTikok*). MOV and WebM
    // are first-class TikTok video containers, not photos.
    const isVideo = (p: ValidityMedia) =>
      p?.path ? isTikTokVideoPath(p.path) : false;
    // Known video containers outside TikTok's supported set (mkv/avi/m4v) must
    // be rejected explicitly — the pipeline would otherwise treat them as
    // photos and TikTok would fail the upload at publish time.
    const unsupported = (firstItems ?? []).find((p) =>
      p?.path ? isOtherVideoPath(p.path) : false
    );
    if (unsupported) {
      return 'TikTok supports video in MP4, WebM or MOV format only';
    }
    if ((firstItems?.length ?? 0) > 1 && firstItems?.some(isVideo)) {
      return 'Only pictures are supported when selecting multiple items';
    } else if (firstItems?.length !== 1 && isVideo(firstItems?.[0])) {
      return 'You need one media';
    }

    // Photo carousel rules. The Content Posting API accepts up to 35 photos per
    // post and only JPEG/WebP containers, so an unsupported image must be
    // rejected here instead of failing later with `invalid_params`.
    const photos = (firstItems ?? []).filter((p) => !isVideo(p));
    if (photos.length > TIKTOK_MAX_PHOTOS) {
      return `TikTok accepts up to ${TIKTOK_MAX_PHOTOS} photos in one post`;
    }
    const unsupportedPhoto = photos.find((p) =>
      p?.path ? isOtherImagePath(p.path) : false
    );
    if (unsupportedPhoto) {
      return 'TikTok supports photos in JPEG or WebP format only';
    }
    return true;
  }

  override handleErrors(body: string):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    // Authentication/Authorization errors - require re-authentication
    if (body.indexOf('access_token_invalid') > -1) {
      return {
        type: 'refresh-token' as const,
        value:
          'Access token invalid, please re-authenticate your TikTok account',
      };
    }

    if (body.indexOf('scope_not_authorized') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Missing required permissions, please re-authenticate with all scopes',
      };
    }

    if (body.indexOf('scope_permission_missed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Additional permissions required, please re-authenticate',
      };
    }

    // Documented fail_reason: the creator removed the app's access mid-publish.
    // TikTok says explicitly that a retry must NOT be attempted, so this is a
    // reconnect prompt rather than a transient failure.
    if (body.indexOf('auth_removed') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'This TikTok account removed access for PostSider. Please reconnect the account',
      };
    }

    // Rate limiting errors
    if (body.indexOf('rate_limit_exceeded') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok API rate limit exceeded, please try again later',
      };
    }

    if (body.indexOf('file_format_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'File format is invalid, please check video specifications',
      };
    }

    if (body.indexOf('app_version_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'In order to use the TikTok upload feature, you have to update your app to the latest version',
      };
    }

    if (body.indexOf('duration_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Video duration is invalid, please check video specifications',
      };
    }

    if (body.indexOf('frame_rate_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Video frame rate is invalid, please check video specifications',
      };
    }

    if (body.indexOf('video_pull_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to pull video from URL, please check the URL',
      };
    }

    if (body.indexOf('photo_pull_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Failed to pull photo from URL, please check the URL',
      };
    }

    if (body.indexOf('spam_risk_user_banned_from_posting') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Account banned from posting, please check TikTok account status',
      };
    }

    if (body.indexOf('spam_risk_text') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok detected potential spam in the post text',
      };
    }

    if (body.indexOf('spam_risk_too_many_posts') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'TikTok says your daily post limit reached, please try again tomorrow',
      };
    }

    if (body.indexOf('spam_risk_too_many_pending_share') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'TikTok limits pending posts to 5 within any 24-hour period. Please check your TikTok inbox in the TikTok mobile app and try again after 24 hours.',
      };
    }

    if (body.indexOf('spam_risk_user_banned_from_posting') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Account banned from posting, please check TikTok account status',
      };
    }

    if (body.indexOf('spam_risk') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok detected potential spam',
      };
    }

    if (body.indexOf('reached_active_user_cap') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Daily active user quota reached, please try again later',
      };
    }

    // Guidelines 1b: TikTok telling us the creator cannot post right now is a
    // "try again later" state, not a broken post. The API surfaces it either as
    // a creator_info flag or as one of these errors on the publish call; both
    // have to stop the attempt with the same prompt.
    if (
      body.indexOf('post_publish_disabled') > -1 ||
      body.indexOf('daily_post_limit') > -1 ||
      body.indexOf('user_post_limit') > -1
    ) {
      return {
        type: 'bad-body' as const,
        value:
          'This TikTok account cannot publish right now. Please try again later',
      };
    }

    if (
      body.indexOf('unaudited_client_can_only_post_to_private_accounts') > -1
    ) {
      // Until the Direct Post audit passes, TikTok only lets this app post to
      // accounts that are private at the time of posting. The message names the
      // actual cause instead of implying the account is broken.
      return {
        type: 'bad-body' as const,
        value:
          'TikTok has not approved this app for public posting yet. Until the review passes, the TikTok account must be set to private and posts can use Self only visibility.',
      };
    }

    if (body.indexOf('url_ownership_unverified') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'You have to upload the picture/video to Postsider when sending a URL',
      };
    }

    if (body.indexOf('privacy_level_option_mismatch') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Privacy level mismatch, please check privacy settings',
      };
    }

    // Content/Format validation errors
    if (body.indexOf('invalid_file_upload') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid file format or specifications not met',
      };
    }

    if (body.indexOf('invalid_params') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid request parameters, please check content format',
      };
    }

    // Generic TikTok API errors — the more specific matches must come first,
    // a bare 'internal' substring is far too broad (it matches any body
    // mentioning "internal" in a message or field name).
    if (body.indexOf('picture_size_check_failed') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Video must be at least 720p, Picture must no exceed 1080p',
      };
    }

    if (body.indexOf('TikTok API error') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'TikTok API error, please try again',
      };
    }

    // Server errors (match the actual error code)
    if (body.indexOf('internal_error') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'There is a problem with TikTok servers, please try again later',
      };
    }

    // Fall back to parent class error handling
    return undefined;
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    const value = {
      client_key: process.env.TIKTOK_CLIENT_ID!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    const { access_token, refresh_token, ...all } = await (
      await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
        body: new URLSearchParams(value).toString(),
      })
    ).json();

    const {
      data: {
        user: { avatar_url, display_name, open_id, username },
      },
    } = await (
      await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,union_id,username',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        }
      )
    ).json();

    return {
      refreshToken: refresh_token,
      expiresIn: dayjs().add(23, 'hours').unix() - dayjs().unix(),
      accessToken: access_token,
      id: open_id.replace(/-/g, ''),
      name: display_name,
      picture: avatar_url || '',
      username: username,
    };
  }

  async generateAuthUrl() {
    const state = Math.random().toString(36).substring(2);

    return {
      url:
        'https://www.tiktok.com/v2/auth/authorize/' +
        `?client_key=${process.env.TIKTOK_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${
            process?.env?.FRONTEND_URL?.indexOf('https') === -1
              ? 'https://redirectmeto.com/'
              : ''
          }${process?.env?.FRONTEND_URL}/integrations/social/tiktok`
        )}` +
        `&state=${state}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(this.scopes.join(','))}`,
      codeVerifier: state,
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const value = {
      client_key: process.env.TIKTOK_CLIENT_ID!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code: params.code,
      grant_type: 'authorization_code',
      code_verifier: params.codeVerifier,
      redirect_uri: `${
        process?.env?.FRONTEND_URL?.indexOf('https') === -1
          ? 'https://redirectmeto.com/'
          : ''
      }${process?.env?.FRONTEND_URL}/integrations/social/tiktok`,
    };

    const { access_token, refresh_token, scope } = await (
      await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        method: 'POST',
        body: new URLSearchParams(value).toString(),
      })
    ).json();

    this.checkScopes(this.scopes, scope);

    const {
      data: {
        user: { avatar_url, display_name, open_id, username },
      },
    } = await (
      await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,union_id,username',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        }
      )
    ).json();

    return {
      id: open_id.replace(/-/g, ''),
      name: display_name,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: dayjs().add(23, 'hours').unix() - dayjs().unix(),
      picture: avatar_url,
      username: username,
    };
  }

  async maxVideoLength(accessToken: string) {
    const {
      data: { max_video_post_duration_sec },
    } = await (
      await fetch(
        'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )
    ).json();

    return {
      maxDurationSeconds: max_video_post_duration_sec,
    };
  }

  /**
   * Creator info for the composer. TikTok's Content Posting API audit checks
   * the posting UI, not just the API calls: the privacy options offered MUST
   * come from `creator_info` (a private account can never be offered a public
   * option), the duet/stitch/comment switches MUST respect the creator's own
   * settings, and nothing may be preselected for the user. Serving this to the
   * frontend is what makes those rules enforceable there.
   *
   * Reached through the generic `/integrations/function` endpoint, hence @Tool.
   */
  @Tool({
    description:
      'TikTok creator info: allowed privacy levels and interaction limits',
    dataSchema: [],
  })
  async creatorInfo(accessToken: string) {
    const { data, error } = await (
      await this.fetch(
        'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Authorization: `Bearer ${accessToken}`,
          },
        }
      )
    ).json();

    // TikTok answers HTTP 200 even when the creator cannot post; the real
    // signal is a non-`ok` `error.code` (Content Posting API reference for
    // creator_info). `post_publish_disabled` is NOT part of that response, so
    // the codes below are what actually enforce Content Sharing Guidelines 1b.
    const errorCode =
      error?.code && error.code !== 'ok' ? String(error.code) : '';
    const PUBLISH_BLOCKING_CODES = [
      'spam_risk_too_many_posts',
      'spam_risk_user_banned_from_posting',
      'reached_active_user_cap',
    ];
    const blockedByCode = PUBLISH_BLOCKING_CODES.includes(errorCode);

    return {
      nickname: data?.creator_nickname ?? '',
      username: data?.creator_username ?? '',
      avatarUrl: data?.creator_avatar_url ?? '',
      // No fallback list on purpose: if TikTok did not say what is allowed, the
      // composer must offer nothing rather than guess a public default.
      privacyOptions: (data?.privacy_level_options ?? []) as string[],
      duetDisabled: !!data?.duet_disabled,
      stitchDisabled: !!data?.stitch_disabled,
      commentDisabled: !!data?.comment_disabled,
      maxDurationSeconds: data?.max_video_post_duration_sec ?? 0,
      // 1b: when creator_info says the account cannot make more posts, surface
      // it so the client stops and asks the user to try again later. The
      // `post_publish_disabled*` fields are kept as a defensive fallback in
      // case TikTok starts returning them.
      publishDisabled: blockedByCode || !!data?.post_publish_disabled,
      publishDisabledReason:
        (blockedByCode ? error?.message || errorCode : '') ||
        data?.post_publish_disabled_reason ||
        '',
      dailyPostLimitRemaining:
        errorCode === 'spam_risk_too_many_posts'
          ? 0
          : data?.daily_post_limit_remaining ?? null,
      errorCode,
    };
  }

  /**
   * Creator-derived rules enforced server-side as a best effort at post
   * validation (dashboard + public API), mirroring what the composer enforces
   * from `creator_info`. Returns human-readable problems; empty = valid.
   *
   * Privacy is checked only against TikTok's own allowed list, the interaction
   * locks are honoured as "the account turned this off", and commercial
   * content can never be private — the same rule the audit checks in the UI.
   * The duration rule reuses the media row's probed `durationSeconds`.
   */
  validateCreatorRules(
    creator: {
      privacyOptions?: string[];
      duetDisabled?: boolean;
      stitchDisabled?: boolean;
      commentDisabled?: boolean;
      maxDurationSeconds?: number;
      publishDisabled?: boolean;
      dailyPostLimitRemaining?: number | null;
    },
    settings: TikTokDto & { commercial_content?: boolean },
    media: Array<{
      path?: string;
      durationSeconds?: number;
      width?: number;
      height?: number;
    }>
  ): string[] {
    const issues: string[] = [];
    // Content Posting Guidelines 1b: an account that creator_info marks as
    // unable to publish must not be sent a post — fail the validation and ask
    // the user to try again later. The daily cap is reported specifically when
    // that is the cause.
    if (
      typeof creator?.dailyPostLimitRemaining === 'number' &&
      creator.dailyPostLimitRemaining <= 0
    ) {
      issues.push(
        'This TikTok account has reached its daily post limit. Please try again later.'
      );
    } else if (creator?.publishDisabled) {
      issues.push(
        'This TikTok account cannot publish right now. Please try again later.'
      );
    }
    const privacy = settings?.privacy_level;
    const options = creator?.privacyOptions ?? [];
    if (!privacy) {
      // Guidelines 2b: the creator picks the privacy status themselves and the
      // field has no default, so an absent value is never published.
      issues.push('Choose who can see this post on TikTok');
    } else if (!options.length) {
      // An empty option list means creator_info gave us nothing to compare
      // against — publishing would be a guess.
      issues.push(
        'TikTok did not return the allowed privacy levels for this account. Please try again later.'
      );
    } else if (!options.includes(privacy)) {
      issues.push(
        'This TikTok account does not allow the chosen privacy level'
      );
    }
    // Guidelines 3a: once Content disclosure is on, at least one of the two
    // options has to be chosen before the post may go out.
    if (
      settings?.commercial_content &&
      !settings?.brand_content_toggle &&
      !settings?.brand_organic_toggle
    ) {
      issues.push(
        'Choose the applicable content disclosure before posting to TikTok'
      );
    }
    // Resolution rules from the media transfer guide: a photo must not exceed
    // 1080p and a video must stay between 360 and 4096 pixels per side.
    const firstMedia = media?.[0];
    const isPhoto = !!firstMedia?.path && !isTikTokVideoPath(firstMedia.path);
    if (isPhoto) {
      const oversized = (media || []).find(
        (item) =>
          (typeof item.width === 'number' &&
            item.width > TIKTOK_MAX_PHOTO_PIXELS) ||
          (typeof item.height === 'number' &&
            item.height > TIKTOK_MAX_PHOTO_PIXELS)
      );
      if (oversized) {
        issues.push(
          `This photo is ${oversized.width}x${oversized.height}. TikTok accepts photos up to ${TIKTOK_MAX_PHOTO_PIXELS}p.`
        );
      }
    } else if (firstMedia && (firstMedia.width || firstMedia.height)) {
      const width = firstMedia.width ?? 0;
      const height = firstMedia.height ?? 0;
      const outOfRange = (value: number) =>
        value > 0 &&
        (value < TIKTOK_MIN_VIDEO_PIXELS || value > TIKTOK_MAX_VIDEO_PIXELS);
      if (outOfRange(width) || outOfRange(height)) {
        issues.push(
          `This video is ${width}x${height}. TikTok accepts video between ${TIKTOK_MIN_VIDEO_PIXELS} and ${TIKTOK_MAX_VIDEO_PIXELS} pixels on each side.`
        );
      }
    }
    if (creator?.duetDisabled && settings?.duet) {
      issues.push('Duet is turned off on this TikTok account');
    }
    if (creator?.stitchDisabled && settings?.stitch) {
      issues.push('Stitch is turned off on this TikTok account');
    }
    if (creator?.commentDisabled && settings?.comment) {
      issues.push('Comments are turned off on this TikTok account');
    }
    // TikTok restricts only "Branded content" (third-party promotion) to
    // public/friends visibility; promoting your own brand privately is allowed.
    if (Boolean(settings?.brand_content_toggle) && privacy === 'SELF_ONLY') {
      issues.push(
        "Branded content can't be published with Self only visibility"
      );
    }
    const maxDuration = creator?.maxDurationSeconds ?? 0;
    if (
      maxDuration > 0 &&
      firstMedia?.durationSeconds &&
      firstMedia.durationSeconds > maxDuration
    ) {
      issues.push(
        `This video is ${Math.ceil(
          firstMedia.durationSeconds
        )} seconds long. This TikTok account allows videos up to ${maxDuration} seconds.`
      );
    }
    return issues;
  }

  private async uploadedVideoSuccess(
    id: string,
    publishId: string,
    accessToken: string
  ): Promise<{ url: string; id: string }> {
    // Bound the poll: a container stuck in PROCESSING_UPLOAD must not pin the
    // worker forever.
    for (let attempt = 0; ; attempt++) {
      if (attempt >= 60) {
        throw new BadBody(
          'tiktok-error-upload',
          '{}',
          Buffer.from('{}'),
          'TikTok did not finish processing the upload in time'
        );
      }
      const post = await (
        await this.fetch(
          'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              publish_id: publishId,
            }),
          },
          '',
          0,
          true
        )
      ).json();

      const { status, publicaly_available_post_id } = post.data;

      if (status === 'SEND_TO_USER_INBOX') {
        // This provider only supports Direct Post. An inbox handoff is neither
        // published nor a success that PostSider can truthfully report.
        throw new BadBody(
          'tiktok-inbox-handoff',
          JSON.stringify(post),
          Buffer.from(JSON.stringify(post)),
          'TikTok sent this post to the inbox instead of publishing it directly'
        );
      }

      if (status === 'PUBLISH_COMPLETE') {
        const publicId = publicaly_available_post_id?.[0];
        return {
          url: !publicId
            ? `https://www.tiktok.com/@${id}`
            : `https://www.tiktok.com/@${id}/video/${publicId}`,
          id: publicId || publishId,
        };
      }

      if (status === 'FAILED') {
        const handleError = this.handleErrors(JSON.stringify(post));
        throw new BadBody(
          'titok-error-upload',
          JSON.stringify(post),
          Buffer.from(JSON.stringify(post)),
          handleError?.value || ''
        );
      }

      await timer(10000);
    }
  }

  private postingMethod(isPhoto: boolean): string {
    return isPhoto ? '/content/init/' : '/video/init/';
  }

  private buildTikokPostInfoBody(firstPost: PostDetails<TikTokDto>) {
    const isPhoto = !isTikTokVideoPath(firstPost?.media?.[0]?.path);
    return {
      post_info: {
        ...(isPhoto && firstPost.settings.title
          ? { title: firstPost.settings.title.slice(0, 90) }
          : {}),
        ...(!isPhoto && firstPost.message ? { title: firstPost.message } : {}),
        ...(isPhoto ? { description: firstPost.message } : {}),
        // No default: TikTok's Content Sharing Guidelines require the user to
        // choose the privacy level themselves. A post that reaches publish
        // without one is rejected in `assertCreatorAllowsPublish`, never
        // silently sent as public.
        privacy_level: firstPost.settings.privacy_level,
        ...(isPhoto ? {} : { disable_duet: !firstPost.settings.duet || false }),
        disable_comment: !firstPost.settings.comment || false,
        ...(isPhoto
          ? {}
          : { disable_stitch: !firstPost.settings.stitch || false }),
        ...(isPhoto
          ? {}
          : { is_aigc: firstPost.settings.video_made_with_ai || false }),
        brand_content_toggle: firstPost.settings.brand_content_toggle || false,
        brand_organic_toggle: firstPost.settings.brand_organic_toggle || false,
        ...(isPhoto
          ? { auto_add_music: firstPost.settings.autoAddMusic === 'yes' }
          : {}),
      },
    };
  }

  private buildTikokSourceInfoBody(firstPost: PostDetails<TikTokDto>) {
    const isPhoto = !isTikTokVideoPath(firstPost?.media?.[0]?.path);

    if (isPhoto) {
      return {
        post_mode: 'DIRECT_POST',
        media_type: 'PHOTO',
        source_info: {
          source: 'PULL_FROM_URL',
          photo_cover_index: 0,
          photo_images: firstPost.media?.map((p) => p.path),
        },
      };
    }

    return {
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: firstPost?.media?.[0]?.path!,
        ...(firstPost?.media?.[0]?.thumbnailTimestamp!
          ? {
              video_cover_timestamp_ms:
                firstPost?.media?.[0]?.thumbnailTimestamp!,
            }
          : {}),
      },
    };
  }

  /**
   * Content Sharing Guidelines 1a-1c + 2b, enforced at the actual publish
   * moment. A post can be scheduled days in advance, so the creator's allowed
   * privacy levels, "cannot post right now" state and interaction locks are
   * re-read from `creator_info` immediately before the Direct Post call.
   *
   * Fails closed: a missing privacy choice, an unreadable creator_info, or any
   * rule violation aborts the publish instead of defaulting to a public post.
   */
  private async assertCreatorAllowsPublish(
    accessToken: string,
    firstPost: PostDetails<TikTokDto>
  ): Promise<void> {
    const privacy = firstPost?.settings?.privacy_level;
    if (!privacy) {
      throw new BadBody(
        'tiktok-privacy-required',
        '{}',
        Buffer.from('{}'),
        'TikTok requires choosing who can see the post; no privacy level was selected'
      );
    }

    const creator = await this.creatorInfo(accessToken);
    if (!creator?.privacyOptions?.length) {
      throw new BadBody(
        'tiktok-creator-info',
        '{}',
        Buffer.from('{}'),
        'Could not verify the TikTok account settings before publishing. Please try again later'
      );
    }

    const issues = this.validateCreatorRules(
      creator,
      firstPost.settings,
      (firstPost.media ?? []).map((media) => ({
        path: media.path,
        durationSeconds: (media as { durationSeconds?: number }).durationSeconds,
        width: (media as { width?: number }).width,
        height: (media as { height?: number }).height,
      }))
    );
    if (issues.length) {
      throw new BadBody(
        'tiktok-creator-rules',
        '{}',
        Buffer.from('{}'),
        issues.join(' ')
      );
    }
  }

  /**
   * Final gate on the exact URLs handed to `PULL_FROM_URL`. Runs inside the
   * publish call so it covers every route that can reach TikTok (composer,
   * public API, MCP, approval, evergreen, a re-armed queue row) rather than
   * only the ones that go through composer validation.
   */
  private assertPullable(firstPost: PostDetails<TikTokDto>) {
    const media = firstPost?.media || [];
    if (!media.length) {
      throw new BadBody(
        'tiktok-missing-media',
        '{}',
        Buffer.from('{}'),
        'TikTok needs one video or at least one photo'
      );
    }
    const isPhoto = !isTikTokVideoPath(media[0]?.path);
    if (isPhoto && media.length > TIKTOK_MAX_PHOTOS) {
      throw new BadBody(
        'tiktok-too-many-photos',
        '{}',
        Buffer.from('{}'),
        `TikTok accepts up to ${TIKTOK_MAX_PHOTOS} photos in one post`
      );
    }
    const notPullable = media.find((item) => !isTikTokPullableUrl(item?.path));
    if (notPullable) {
      throw new BadBody(
        'tiktok-unpullable-media',
        JSON.stringify({ url: notPullable.path }),
        Buffer.from('{}'),
        'TikTok can only download media from a public https URL on a domain verified in your TikTok app settings'
      );
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<TikTokDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const isPhoto = !isTikTokVideoPath(firstPost?.media?.[0]?.path);

    this.assertPullable(firstPost);
    await this.assertCreatorAllowsPublish(accessToken, firstPost);

    const {
      data: { publish_id },
    } = await (
      await this.fetch(
        `https://open.tiktokapis.com/v2/post/publish${this.postingMethod(
          !isTikTokVideoPath(firstPost?.media?.[0]?.path)
        )}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            ...this.buildTikokPostInfoBody(firstPost),
            ...this.buildTikokSourceInfoBody(firstPost),
            // Photo posts take the AI-generated flag at the TOP level (the
            // video payload carries it inside post_info). TikTok labels the
            // photo with an AI-generated tag when it is set.
            ...(isPhoto
              ? { is_aigc: firstPost.settings.video_made_with_ai || false }
              : {}),
          }),
        }
      )
    ).json();

    const { url, id: videoId } = await this.uploadedVideoSuccess(
      integration.profile!,
      publish_id,
      accessToken
    );

    return [
      {
        id: firstPost.id,
        releaseURL: url,
        postId: String(videoId),
        status: 'success',
      },
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');
    const result: AnalyticsData[] = [];

    try {
      // Get user stats (follower_count, following_count, likes_count, video_count)
      const userStatsResponse = await this.fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=follower_count,following_count,likes_count,video_count',
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const userStatsData = await userStatsResponse.json();
      const userStats = userStatsData?.data?.user;

      if (userStats) {
        if (userStats.follower_count !== undefined) {
          result.push({
            label: 'Followers',
            percentageChange: 0,
            isSnapshot: true,
            data: [{ total: String(userStats.follower_count), date: today }],
          });
        }

        if (userStats.following_count !== undefined) {
          result.push({
            label: 'Following',
            percentageChange: 0,
            isSnapshot: true,
            data: [{ total: String(userStats.following_count), date: today }],
          });
        }

        if (userStats.likes_count !== undefined) {
          result.push({
            label: 'Total Likes',
            percentageChange: 0,
            isSnapshot: true,
            data: [{ total: String(userStats.likes_count), date: today }],
          });
        }

        if (userStats.video_count !== undefined) {
          result.push({
            label: 'Videos',
            percentageChange: 0,
            isSnapshot: true,
            data: [{ total: String(userStats.video_count), date: today }],
          });
        }
      }
    } catch (err) {
      console.error('Error fetching TikTok account analytics:', err);
    }

    try {
      // Get recent videos and aggregate their stats. This needs `video.list`,
      // which older integrations may not have; keep account statistics above.
      const videoListResponse = await this.fetch(
        'https://open.tiktokapis.com/v2/video/list/?fields=id',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ max_count: 20 }),
        }
      );

      const videoListData = await videoListResponse.json();
      const videos = videoListData?.data?.videos;

      if (videos && videos.length > 0) {
        const videoIds = videos.map((v: { id: string }) => v.id);

        // Query video details to get engagement metrics
        const videoQueryResponse = await this.fetch(
          'https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              filters: { video_ids: videoIds },
            }),
          }
        );

        const videoQueryData = await videoQueryResponse.json();
        const videoDetails = videoQueryData?.data?.videos;

        if (videoDetails && videoDetails.length > 0) {
          let totalViews = 0;
          let totalLikes = 0;
          let totalComments = 0;
          let totalShares = 0;

          for (const video of videoDetails) {
            totalViews += video.view_count || 0;
            totalLikes += video.like_count || 0;
            totalComments += video.comment_count || 0;
            totalShares += video.share_count || 0;
          }

          result.push({
            label: 'Recent Views',
            percentageChange: 0,
            isSnapshot: true,
            data: [{ total: String(totalViews), date: today }],
          });

          result.push({
            label: 'Recent Likes',
            percentageChange: 0,
            isSnapshot: true,
            data: [{ total: String(totalLikes), date: today }],
          });

          result.push({
            label: 'Recent Comments',
            percentageChange: 0,
            isSnapshot: true,
            data: [{ total: String(totalComments), date: today }],
          });

          result.push({
            label: 'Recent Shares',
            percentageChange: 0,
            isSnapshot: true,
            data: [{ total: String(totalShares), date: today }],
          });
        }
      }
    } catch (err) {
      console.error('Error fetching TikTok video analytics:', err);
    }

    return result;
  }

  async missing(
    id: string,
    accessToken: string
  ): Promise<{ id: string; url: string }[]> {
    try {
      const videoListResponse = await this.fetch(
        'https://open.tiktokapis.com/v2/video/list/?fields=id,cover_image_url,title',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ max_count: 20 }),
        }
      );

      const videoListData = await videoListResponse.json();
      const videos = videoListData?.data?.videos;

      if (!videos || videos.length === 0) {
        return [];
      }

      return videos.map((v: { id: string; cover_image_url: string }) => ({
        id: String(v.id),
        url: v.cover_image_url,
      }));
    } catch (err) {
      console.error('Error fetching TikTok missing content:', err);
      return [];
    }
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    fromDate: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    if (postId.indexOf('v_pub_url') > -1) {
      const post = await (
        await this.fetch(
          'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({
              publish_id: postId,
            }),
          },
          '',
          0,
          true
        )
      ).json();

      if (!post?.data?.publicaly_available_post_id?.[0]) {
        return [];
      }

      postId = post.data.publicaly_available_post_id[0];
    }

    try {
      // Query video details using the video ID
      const response = await this.fetch(
        'https://open.tiktokapis.com/v2/video/query/?fields=id,like_count,comment_count,share_count,view_count',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            filters: {
              video_ids: [postId],
            },
          }),
        }
      );

      const data = await response.json();
      const video = data?.data?.videos?.[0];

      if (!video) {
        return [];
      }

      const result: AnalyticsData[] = [];

      if (video.view_count !== undefined) {
        result.push({
          label: 'Views',
          percentageChange: 0,
          data: [{ total: String(video.view_count), date: today }],
        });
      }

      if (video.like_count !== undefined) {
        result.push({
          label: 'Likes',
          percentageChange: 0,
          data: [{ total: String(video.like_count), date: today }],
        });
      }

      if (video.comment_count !== undefined) {
        result.push({
          label: 'Comments',
          percentageChange: 0,
          data: [{ total: String(video.comment_count), date: today }],
        });
      }

      if (video.share_count !== undefined) {
        result.push({
          label: 'Shares',
          percentageChange: 0,
          data: [{ total: String(video.share_count), date: today }],
        });
      }

      return result;
    } catch (err) {
      console.error('Error fetching TikTok post analytics:', err);
      return [];
    }
  }
}
