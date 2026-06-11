import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@postsider/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { BearBlogDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/bear.blog.dto';
import slugify from 'slugify';

/**
 * Bear Blog integration.
 *
 * Bear Blog does not expose a public REST API for content management
 * (https://docs.bearblog.dev/migrate/ – content has to be added through the
 * dashboard). This provider therefore registers the user's blog domain so
 * PostSider can store the prepared post and render the canonical URL, while
 * leaving the actual publish step to the user inside the Bear dashboard.
 *
 * Once Bear ships an official write API the `post()` method can be wired up
 * to it without changing the connection flow.
 */
export class BearBlogProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 1;
  identifier = 'bear-blog';
  name = 'Bear Blog';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'markdown' as const;
  dto = BearBlogDto;

  maxLength() {
    return 100_000;
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async customFields() {
    return [
      {
        key: 'domain',
        label: 'Blog domain (https://...)',
        validation: `/^https?:\\/\\/(?:www\\.)?[\\w\\-]+(\\.[\\w\\-]+)+([\\/?#][^\\s]*)?$/`,
        type: 'text' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString()) as {
      domain: string;
    };

    try {
      const url = body.domain.replace(/\/$/, '');

      // Confirm the domain resolves; Bear blogs are always plain HTML so a
      // HEAD/GET probe is enough.
      const probe = await fetch(url, { method: 'HEAD' });
      if (!probe.ok && probe.status !== 405) {
        return 'Invalid blog domain';
      }

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: params.code,
        id: Buffer.from(url).toString('base64'),
        name: url.replace(/^https?:\/\//, ''),
        picture: '',
        username: url.replace(/^https?:\/\//, ''),
      };
    } catch (err) {
      console.log('Bear Blog authenticate error', err);
      return 'Invalid credentials';
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<BearBlogDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const credentials = JSON.parse(
      Buffer.from(accessToken, 'base64').toString()
    ) as { domain: string };

    const settings = postDetails?.[0]?.settings || ({} as BearBlogDto);
    const url = credentials.domain.replace(/\/$/, '');
    const slug =
      settings.slug ||
      slugify(settings.title, { lower: true, strict: true, trim: true });

    // TODO: replace with the official Bear Blog publish endpoint once one is
    // exposed. Until then we record the post and surface the predicted blog
    // URL so the operator can finish publishing manually.
    return [
      {
        id: postDetails[0].id,
        status: 'completed',
        postId: slug || makeId(12),
        releaseURL: `${url}/${slug}/`,
      },
    ];
  }
}
