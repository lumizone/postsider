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
import { WriteAsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/writeas.dto';

const WRITEAS_API = 'https://write.as/api';

/**
 * Write.as integration. Authenticates with username/password to obtain
 * an access token, then publishes posts via the Write.as REST API.
 *
 * Docs: https://developers.write.as/docs/api/
 */
export class WriteAsProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3;
  identifier = 'writeas';
  name = 'Write.as';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'markdown' as const;
  dto = WriteAsDto;

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
        key: 'alias',
        label: 'Username',
        validation: `/^.{1,}$/`,
        type: 'text' as const,
      },
      {
        key: 'pass',
        label: 'Password',
        validation: `/^.{1,}$/`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    try {
      const body = JSON.parse(Buffer.from(params.code, 'base64').toString()) as {
        alias: string;
        pass: string;
      };

      const response = await this.fetch(`${WRITEAS_API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: body.alias, pass: body.pass }),
      });

      const json = await response.json();
      const data = json?.data;

      if (!data?.access_token) {
        return 'Invalid credentials';
      }

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: data.access_token,
        id: data.user?.username || body.alias,
        name: data.user?.username || body.alias,
        picture: '',
        username: data.user?.username || body.alias,
      };
    } catch (err) {
      console.log('Write.as authenticate error', err);
      return 'Invalid credentials';
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<WriteAsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const settings = postDetails?.[0]?.settings || ({} as WriteAsDto);

    const endpoint = settings.collection
      ? `${WRITEAS_API}/collections/${settings.collection}/posts`
      : `${WRITEAS_API}/posts`;

    const response = await this.fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Token ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        body: postDetails[0].message,
        ...(settings.title ? { title: settings.title } : {}),
        ...(settings.font ? { font: settings.font } : {}),
        ...(settings.language ? { lang: settings.language } : {}),
      }),
    });

    const json = await response.json();
    const data = json?.data;

    // A response without data means the post was not created; don't record it
    // as published with a bogus releaseURL.
    if (!response.ok || !data?.id) {
      throw new Error(
        `Write.as post failed (${response.status}): ${JSON.stringify(json)}`
      );
    }

    const releaseURL = settings.collection
      ? `https://write.as/${settings.collection}/${data?.slug || data?.id}`
      : `https://write.as/${data?.id}`;

    return [
      {
        id: postDetails[0].id,
        status: 'completed',
        postId: String(data?.id || ''),
        releaseURL,
      },
    ];
  }
}
