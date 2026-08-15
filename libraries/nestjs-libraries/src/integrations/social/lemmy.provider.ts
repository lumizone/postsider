import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import {
  SocialAbstract,
  ValidityMedia,
} from '@postsider/nestjs-libraries/integrations/social.abstract';
import dayjs from 'dayjs';
import { ssrfSafeDispatcher } from '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { Integration } from '@prisma/client';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { LemmySettingsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/lemmy.dto';
import { Tool } from '@postsider/nestjs-libraries/integrations/tool.decorator';

export class LemmyProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Lemmy instances typically have moderate limits
  identifier = 'lemmy';
  name = 'Lemmy';
  isBetweenSteps = false;
  scopes = [] as string[];
  editor = 'normal' as const;
  maxLength() {
    return 10000;
  }
  dto = LemmySettingsDto;

  override async checkValidity(
    items: Array<ValidityMedia[]>
  ): Promise<string | true> {
    const [firstItems] = items ?? [];
    if (
      firstItems?.length &&
      (firstItems?.[0]?.path?.indexOf?.('png') ?? -1) === -1 &&
      (firstItems?.[0]?.path?.indexOf?.('jpg') ?? -1) === -1 &&
      (firstItems?.[0]?.path?.indexOf?.('jpef') ?? -1) === -1 &&
      (firstItems?.[0]?.path?.indexOf?.('gif') ?? -1) === -1
    ) {
      return 'You can set only one picture for a cover';
    }
    return true;
  }

  async customFields() {
    return [
      {
        key: 'service',
        label: 'Service',
        defaultValue: 'https://lemmy.world',
        validation: `/^https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)$/`,
        type: 'text' as const,
      },
      {
        key: 'identifier',
        label: 'Identifier',
        validation: `/^.{3,}$/`,
        type: 'text' as const,
      },
      {
        key: 'password',
        label: 'Password',
        validation: `/^.{3,}$/`,
        type: 'password' as const,
      },
    ];
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

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url: state,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const body = JSON.parse(Buffer.from(params.code, 'base64').toString());

    const load = await fetch(body.service + '/api/v3/user/login', {
      body: JSON.stringify({
        username_or_email: body.identifier,
        password: body.password,
      }),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      // @ts-ignore -- undici dispatcher is not in the DOM RequestInit type.
      dispatcher: ssrfSafeDispatcher,
    });

    if (load.status === 401) {
      return 'Invalid credentials';
    }

    const { jwt } = await load.json();

    try {
      const user = await (
        await fetch(body.service + `/api/v3/user?username=${body.identifier}`, {
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
          // @ts-ignore -- undici dispatcher is not in the DOM RequestInit type.
          dispatcher: ssrfSafeDispatcher,
        })
      ).json();

      return {
        refreshToken: jwt!,
        expiresIn: dayjs().add(100, 'years').unix() - dayjs().unix(),
        accessToken: jwt!,
        id: String(user.person_view.person.id),
        name:
          user.person_view.person.display_name ||
          user.person_view.person.name ||
          '',
        picture: user?.person_view?.person?.avatar || '',
        username: body.identifier || '',
      };
    } catch (e) {
      console.log(e);
      return 'Invalid credentials';
    }
  }

  private async getJwtAndService(integration: Integration): Promise<{ jwt: string; service: string }> {
    const body = JSON.parse(
      AuthService.decryptSecret(integration.customInstanceDetails!)
    );

    const response = await fetch(body.service + '/api/v3/user/login', {
      body: JSON.stringify({
        username_or_email: body.identifier,
        password: body.password,
      }),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const { jwt } = await response.json();

    // Lemmy returns 401/2FA-required as `jwt: undefined`; downstream would fail
    // confusingly (post_view undefined), so fail loudly here instead.
    if (!response.ok || !jwt) {
      throw new Error(
        `Lemmy re-login failed (${response.status}): ${
          jwt === undefined ? 'no JWT returned (bad credentials or 2FA required)' : ''
        }`
      );
    }

    return { jwt, service: body.service };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<LemmySettingsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const { jwt, service } = await this.getJwtAndService(integration);

    const valueArray: PostResponse[] = [];

    for (const lemmy of firstPost.settings.subreddit) {
      const { post_view } = await (
        await fetch(service + '/api/v3/post', {
          body: JSON.stringify({
            community_id: +lemmy.value.id,
            name: lemmy.value.title,
            body: firstPost.message,
            ...(lemmy.value.url
              ? {
                  url:
                    lemmy.value.url.indexOf('http') === -1
                      ? `https://${lemmy.value.url}`
                      : lemmy.value.url,
                }
              : {}),
            ...(firstPost.media?.length
              ? { custom_thumbnail: firstPost.media[0].path }
              : {}),
            nsfw: false,
          }),
          method: 'POST',
          headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
          },
        })
      ).json();

      valueArray.push({
        postId: post_view.post.id,
        releaseURL: service + '/post/' + post_view.post.id,
        id: firstPost.id,
        status: 'published',
      });
    }

    return [
      {
        id: firstPost.id,
        postId: valueArray.map((p) => String(p.postId)).join(','),
        releaseURL: valueArray.map((p) => p.releaseURL).join(','),
        status: 'published',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<LemmySettingsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const { jwt, service } = await this.getJwtAndService(integration);

    // postId can be comma-separated if posted to multiple communities
    const postIds = postId.split(',');
    const valueArray: PostResponse[] = [];

    for (const singlePostId of postIds) {
      const { comment_view } = await (
        await fetch(service + '/api/v3/comment', {
          body: JSON.stringify({
            post_id: +singlePostId,
            content: commentPost.message,
          }),
          method: 'POST',
          headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json',
          },
        })
      ).json();

      valueArray.push({
        postId: String(comment_view.comment.id),
        releaseURL: service + '/comment/' + comment_view.comment.id,
        id: commentPost.id,
        status: 'published',
      });
    }

    return [
      {
        id: commentPost.id,
        postId: valueArray.map((p) => p.postId).join(','),
        releaseURL: valueArray.map((p) => p.releaseURL).join(','),
        status: 'published',
      },
    ];
  }

  @Tool({
    description: 'Search for Lemmy communities by keyword',
    dataSchema: [
      {
        key: 'word',
        type: 'string',
        description: 'Keyword to search for',
      },
    ],
  })
  async subreddits(
    accessToken: string,
    data: any,
    id: string,
    integration: Integration
  ) {
    const { jwt, service } = await this.getJwtAndService(integration);

    const { communities } = await (
      await fetch(
        service + `/api/v3/search?type_=Communities&sort=Active&q=${data.word}`,
        {
          headers: {
            Authorization: `Bearer ${jwt}`,
          },
        }
      )
    ).json();

    return communities.map((p: any) => ({
      title: p.community.title,
      name: p.community.title,
      id: p.community.id,
    }));
  }
}
