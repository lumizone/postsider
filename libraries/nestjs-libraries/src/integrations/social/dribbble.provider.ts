import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import axios from 'axios';
import FormData from 'form-data';
import {
  SocialAbstract,
  ValidityMedia,
} from '@postsider/nestjs-libraries/integrations/social.abstract';
import { DribbbleDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import mime from 'mime-types';
import { DiscordDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/discord.dto';
import { Tool } from '@postsider/nestjs-libraries/integrations/tool.decorator';

export class DribbbleProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Dribbble has moderate API limits
  identifier = 'dribbble';
  name = 'Dribbble';
  isBetweenSteps = false;
  scopes = ['public', 'upload'];
  editor = 'normal' as const;
  maxLength() {
    return 40000;
  }
  dto = DribbbleDto;

  override async checkValidity(
    [firstItem]: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const isMp4 = firstItem?.find(
      (item) => (item?.path?.indexOf?.('mp4') ?? -1) > -1
    );
    if (firstItem?.length !== 1) {
      return 'Requires one item';
    }
    if (isMp4) {
      return 'Does not support mp4 files';
    }
    const details = await this.getImageDimensions(firstItem?.[0]?.path);
    if (
      (details?.width === 400 && details?.height === 300) ||
      (details?.width === 800 && details?.height === 600)
    ) {
      return true;
    }
    return 'Invalid image size. Requires 400x300 or 800x600 px images.';
  }

  // Dribbble access tokens do not expire and the API has no refresh grant.
  // This was Pinterest code pasted in (it hit api-sandbox.pinterest.com with
  // PINTEREST creds and leaked the Dribbble refresh token there); returning a
  // static result is safe and matches the "no refresh" reality.
  async refreshToken(_refreshToken: string): Promise<AuthTokenDetails> {
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

  @Tool({ description: 'Teams list', dataSchema: [] })
  async teams(accessToken: string) {
    const { teams } = await (
      await this.fetch('https://api.dribbble.com/v2/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      })
    ).json();

    return (
      teams?.map((team: any) => ({
        id: team.id,
        name: team.name,
      })) || []
    );
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: `https://dribbble.com/oauth/authorize?client_id=${
        process.env.DRIBBBLE_CLIENT_ID
      }&redirect_uri=${encodeURIComponent(
        `${process.env.FRONTEND_URL}/integrations/social/dribbble`
      )}&response_type=code&scope=${this.scopes.join('+')}&state=${state}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh: string;
  }) {
    const { access_token, scope } = await (
      await this.fetch(
        `https://dribbble.com/oauth/token?client_id=${process.env.DRIBBBLE_CLIENT_ID}&client_secret=${process.env.DRIBBBLE_CLIENT_SECRET}&code=${params.code}&redirect_uri=${process.env.FRONTEND_URL}/integrations/social/dribbble`,
        {
          method: 'POST',
        }
      )
    ).json();

    this.checkScopes(this.scopes, scope);

    const { id, name, avatar_url, login } = await (
      await this.fetch('https://api.dribbble.com/v2/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      id: id,
      name,
      accessToken: access_token,
      refreshToken: '',
      expiresIn: 999999999,
      picture: avatar_url,
      username: login,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<DribbbleDto>[]
  ): Promise<PostResponse[]> {
    const { data, status } = await axios.get(
      postDetails?.[0]?.media?.[0]?.path!,
      {
        responseType: 'stream',
      }
    );

    const slash = postDetails?.[0]?.media?.[0]?.path.split('/').at(-1);

    const formData = new FormData();
    formData.append('image', data, {
      filename: slash,
      contentType: mime.lookup(slash!) || '',
    });

    formData.append('title', postDetails[0].settings.title);
    formData.append('description', postDetails[0].message);

    const data2 = await axios.post(
      'https://api.dribbble.com/v2/shots',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const location = data2.headers['location'] as string | undefined;
    if (!location) {
      throw new Error('Dribbble did not return a shot location header');
    }
    const newId = location.split('/').at(-1) || '';

    return [
      {
        id: postDetails?.[0]?.id,
        status: 'completed',
        postId: newId,
        releaseURL: `https://dribbble.com/shots/${newId}`,
      },
    ];
  }

  analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    return Promise.resolve([]);
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    // Dribbble doesn't provide detailed post-level analytics via their API
    return [];
  }
}
