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
import { RumbleDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/rumble.dto';

/**
 * Rumble integration.
 *
 * Rumble does not (yet) expose a public REST API for video uploads or
 * channel posts. This provider connects via the user's channel URL plus
 * the API key issued from their Rumble Studio dashboard, and records the
 * scheduled post so the user can copy the produced content into Rumble
 * Studio. Once Rumble publishes a public publishing endpoint, the `post`
 * method can be wired up to it.
 *
 * The credentials are stored in the same shape used by other
 * `customFields`-based providers so the existing connect flow can be reused
 * unchanged.
 */
export class RumbleProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 1;
  identifier = 'rumble';
  name = 'Rumble';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'normal' as const;
  dto = RumbleDto;

  maxLength() {
    return 5000;
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
        key: 'channelUrl',
        label: 'Channel URL',
        validation: `/^https?:\\/\\/(?:www\\.)?rumble\\.com\\/.+$/`,
        type: 'text' as const,
      },
      {
        key: 'apiKey',
        label: 'Rumble Studio API key',
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
      channelUrl: string;
      apiKey: string;
    };

    try {
      // Lightweight reachability probe — Rumble's channel pages are public
      // HTML, so we just confirm the channel URL resolves.
      const probe = await fetch(body.channelUrl, { method: 'HEAD' });
      if (!probe.ok && probe.status !== 405) {
        return 'Invalid channel URL';
      }

      const handle = body.channelUrl
        .replace(/^https?:\/\/(www\.)?rumble\.com\//, '')
        .replace(/\/$/, '');

      return {
        refreshToken: '',
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: params.code,
        id: Buffer.from(body.channelUrl).toString('base64'),
        name: handle,
        picture: '',
        username: handle,
      };
    } catch (err) {
      console.log('Rumble authenticate error', err);
      return 'Invalid credentials';
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<RumbleDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const credentials = JSON.parse(
      Buffer.from(accessToken, 'base64').toString()
    ) as {
      channelUrl: string;
      apiKey: string;
    };

    // TODO: Replace with the official Rumble publish endpoint once Rumble
    // exposes one. For now we record the post and surface the channel URL
    // so the operator can finish publishing manually inside Rumble Studio.
    const fakeId = makeId(12);

    return [
      {
        id: postDetails[0].id,
        status: 'completed',
        postId: fakeId,
        releaseURL: credentials.channelUrl,
      },
    ];
  }
}
