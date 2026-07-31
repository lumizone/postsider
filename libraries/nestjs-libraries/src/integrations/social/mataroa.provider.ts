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
import { MataroaDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/mataroa.dto';

const MATAROA_BASE = 'https://mataroa.blog/api';

/**
 * Mataroa blog integration.
 *
 * Mataroa exposes a small REST API protected by a per-user API key
 * available at https://mataroa.blog/api/. The username is the blog
 * subdomain (e.g. https://<username>.mataroa.blog).
 *
 * Docs: https://mataroa.blog/api/docs/
 */
export class MataroaProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3;
  identifier = 'mataroa';
  name = 'Mataroa';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'markdown' as const;
  dto = MataroaDto;

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
        key: 'username',
        label: 'Mataroa username',
        validation: `/^[a-z0-9-]{2,}$/i`,
        type: 'text' as const,
      },
      {
        key: 'apiKey',
        label: 'API key',
        validation: `/^.{10,}$/`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString()) as {
      username: string;
      apiKey: string;
    };

    try {
      // Mataroa's `/posts/` endpoint requires a valid token; using it as a
      // lightweight credentials probe.
      const probe = await this.fetch(`${MATAROA_BASE}/posts/`, {
        headers: {
          Authorization: `Bearer ${body.apiKey}`,
        },
      });

      if (!probe.ok) {
        return 'Invalid credentials';
      }

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: params.code,
        id: body.username,
        name: body.username,
        picture: '',
        username: body.username,
      };
    } catch (err) {
      console.log('Mataroa authenticate error', err);
      return 'Invalid credentials';
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<MataroaDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const credentials = JSON.parse(
      Buffer.from(accessToken, 'base64').toString()
    ) as {
      username: string;
      apiKey: string;
    };

    const settings = postDetails?.[0]?.settings || ({} as MataroaDto);

    const response = await this.fetch(`${MATAROA_BASE}/posts/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: settings.title,
        body: postDetails[0].message,
        // Mataroa derives the slug from the title automatically. Posts are
        // private until `published_at` is set; pass null for drafts.
        published_at:
          settings.published === false
            ? null
            : dayjs().format('YYYY-MM-DD'),
      }),
    });

    const data = await response.json();
    // this.fetch returns non-2xx responses (authenticate probes with ok), so the
    // status must be inspected here — otherwise a 400/401 is recorded as posted.
    if (!response.ok || data?.ok === false) {
      throw new Error(
        `Mataroa post failed (${response.status}): ${JSON.stringify(data)}`
      );
    }
    const slug = data?.slug || '';

    return [
      {
        id: postDetails[0].id,
        status: 'completed',
        postId: String(slug),
        releaseURL:
          data?.url ||
          (slug
            ? `https://${credentials.username}.mataroa.blog/blog/${slug}/`
            : `https://${credentials.username}.mataroa.blog/`),
      },
    ];
  }
}
