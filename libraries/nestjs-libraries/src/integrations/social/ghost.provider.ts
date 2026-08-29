import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { SocialAbstract } from '@postsider/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { ssrfSafeDispatcher } from '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { Integration } from '@prisma/client';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { GhostDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/ghost.dto';
import jwt from 'jsonwebtoken';

/**
 * Ghost Admin API integration.
 *
 * Connection requires:
 *   - Site URL (e.g. https://example.ghost.io)
 *   - Admin API key (from "Custom Integrations" in the Ghost admin panel,
 *     formatted as "<id>:<secret>")
 *
 * The provider uses the Admin API directly with a short lived JWT signed
 * from the supplied Admin API key.
 *
 * Docs: https://ghost.org/docs/admin-api/
 */
export class GhostProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 5; // Ghost self-hosted instances usually have generous limits
  identifier = 'ghost';
  name = 'Ghost';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'html' as const;
  dto = GhostDto;

  maxLength() {
    return 1_000_000;
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
        key: 'url',
        label: 'Site URL',
        validation: `/^https?:\\/\\/(?:www\\.)?[\\w\\-]+(\\.[\\w\\-]+)+([\\/?#][^\\s]*)?$/`,
        type: 'text' as const,
      },
      {
        key: 'apiKey',
        label: 'Admin API Key',
        validation: `/^[a-f0-9]{24}:[a-f0-9]{64}$/i`,
        type: 'password' as const,
      },
    ];
  }

  /**
   * Builds a short-lived JWT for the Ghost Admin API using the
   * "<id>:<secret>" key format.
   */
  private buildToken(apiKey: string): string {
    const [id, secret] = apiKey.split(':');
    if (!id || !secret) {
      throw new Error('Invalid Ghost Admin API key format');
    }

    return jwt.sign({}, Buffer.from(secret, 'hex'), {
      keyid: id,
      algorithm: 'HS256',
      expiresIn: '5m',
      audience: '/admin/',
    });
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString()) as {
      url: string;
      apiKey: string;
    };

    try {
      const token = this.buildToken(body.apiKey);

      const url = body.url.replace(/\/$/, '');
      const response = await this.fetch(`${url}/ghost/api/admin/site/`, {
        headers: {
          Authorization: `Ghost ${token}`,
          'Content-Type': 'application/json',
        },
        // Ghost instances are user-supplied URLs; pin DNS and block private IPs.
        // @ts-ignore -- undici dispatcher is not in the DOM RequestInit type.
        dispatcher: ssrfSafeDispatcher,
      });

      const { site } = await response.json();

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: params.code,
        id: Buffer.from(url).toString('base64'),
        name: site?.title || url,
        picture: site?.icon || site?.logo || '',
        username: site?.title || url,
      };
    } catch (err) {
      console.log('Ghost authenticate error', err);
      return 'Invalid credentials';
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<GhostDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const body = JSON.parse(Buffer.from(accessToken, 'base64').toString()) as {
      url: string;
      apiKey: string;
    };
    const token = this.buildToken(body.apiKey);
    const url = body.url.replace(/\/$/, '');

    const settings = postDetails?.[0]?.settings || ({} as GhostDto);
    const status = settings.publish === false ? 'draft' : 'published';

    const featureImage = settings.feature_image?.path;
    const resolvedFeatureImage =
      featureImage && featureImage.indexOf('http') === -1
        ? `${process.env.FRONTEND_URL}/${featureImage}`
        : featureImage;

    const response = await this.fetch(
      `${url}/ghost/api/admin/posts/?source=html`,
      {
        method: 'POST',
        headers: {
          Authorization: `Ghost ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          posts: [
            {
              title: settings.title,
              html: postDetails[0].message,
              status,
              ...(settings.excerpt ? { custom_excerpt: settings.excerpt } : {}),
              ...(settings.canonical
                ? { canonical_url: settings.canonical }
                : {}),
              ...(resolvedFeatureImage
                ? { feature_image: resolvedFeatureImage }
                : {}),
              ...(settings.tags?.length
                ? {
                    tags: settings.tags.map((tag) => ({ name: tag.label })),
                  }
                : {}),
            },
          ],
        }),
        // @ts-ignore -- undici dispatcher is not in the DOM RequestInit type.
        dispatcher: ssrfSafeDispatcher,
      }
    );

    const { posts } = await response.json();
    const post = posts?.[0];

    return [
      {
        id: postDetails[0].id,
        status: 'completed',
        postId: String(post?.id || ''),
        releaseURL: post?.url || `${url}/${post?.slug || ''}`,
      },
    ];
  }
}
