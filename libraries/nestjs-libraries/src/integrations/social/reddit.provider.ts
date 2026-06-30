import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { RedditSettingsDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/reddit.dto';
import { timer } from '@postsider/helpers/utils/timer';
import { groupBy } from 'lodash';
import {
  SocialAbstract,
  ValidityMedia,
} from '@postsider/nestjs-libraries/integrations/social.abstract';
import { lookup } from 'mime-types';
import axios from 'axios';
import WebSocket from 'ws';
import { Tool } from '@postsider/nestjs-libraries/integrations/tool.decorator';
import { Integration } from '@prisma/client';
import { hasExtension } from '@postsider/helpers/utils/has.extension';
import { AuthService } from '@postsider/helpers/auth/auth.service';

// @ts-ignore
global.WebSocket = WebSocket;

interface RedditCredentials {
  client_id: string;
  client_secret: string;
  username: string;
  password: string;
}

export class RedditProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 1; // Reddit has strict rate limits (1 request per second)
  identifier = 'reddit';
  name = 'Reddit';
  isBetweenSteps = false;
  scopes = ['read', 'identity', 'submit', 'flair'];
  editor = 'normal' as const;
  dto = RedditSettingsDto;

  maxLength() {
    return 10000;
  }

  override async checkValidity(
    posts: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (
      settings?.subreddit?.some(
        (p: any) => p?.value?.type === 'media' && posts?.[0]?.length !== 1
      )
    ) {
      return 'When posting a media post, you must attached exactly one media file.';
    }

    if (
      posts?.some((p) =>
        p?.some((a) => !a?.thumbnail && (a?.path?.indexOf?.('mp4') ?? -1) > -1)
      )
    ) {
      return 'You must attach a thumbnail to your video post.';
    }

    return true;
  }

  /**
   * Reddit via a user-owned "script" app (per-user credentials, no shared OAuth
   * app). The user supplies their own client_id/secret + Reddit username/password
   * (script app at reddit.com/prefs/apps); we mint user access tokens with the
   * OAuth password grant. Tokens last ~1h and carry no refresh_token, so we keep
   * the credentials (encrypted) and re-mint on expiry. 2FA accounts are not
   * supported by this grant.
   */
  private storeCreds(creds: RedditCredentials): string {
    return AuthService.fixedEncryption(JSON.stringify(creds));
  }

  private parseStoredCreds(blob: string): RedditCredentials {
    return JSON.parse(AuthService.fixedDecryption(blob));
  }

  private async passwordGrant(creds: RedditCredentials) {
    return (
      await this.fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': `web:postsider:v1.0 (by /u/${creds.username})`,
          Authorization: `Basic ${Buffer.from(
            `${creds.client_id}:${creds.client_secret}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'password',
          username: creds.username,
          password: creds.password,
        }),
      })
    ).json();
  }

  private async fetchMe(accessToken: string, username: string) {
    return (
      await this.fetch('https://oauth.reddit.com/api/v1/me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': `web:postsider:v1.0 (by /u/${username})`,
        },
      })
    ).json();
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    // refreshToken holds the encrypted script-app credentials — re-mint a token.
    const creds = this.parseStoredCreds(refreshToken);
    const { access_token: accessToken, expires_in: expiresIn } =
      await this.passwordGrant(creds);

    const { name, id, icon_img } = await this.fetchMe(
      accessToken,
      creds.username
    );

    return {
      id,
      name,
      accessToken,
      refreshToken, // keep the encrypted creds blob
      expiresIn,
      picture: icon_img?.split?.('?')?.[0] || '',
      username: name,
    };
  }

  // No OAuth — the connection is driven by the customFields credential form.
  async generateAuthUrl() {
    const state = makeId(6);
    return { url: state, codeVerifier: makeId(10), state };
  }

  async customFields() {
    return [
      {
        key: 'client_id',
        label: 'Reddit app ID (create a "script" app at reddit.com/prefs/apps)',
        validation: `/^.{4,}$/`,
        type: 'text' as const,
      },
      {
        key: 'client_secret',
        label: 'Reddit app secret',
        validation: `/^.{4,}$/`,
        type: 'password' as const,
      },
      {
        key: 'username',
        label: 'Reddit username (without u/)',
        validation: `/^[A-Za-z0-9_\\-]{3,20}$/`,
        type: 'text' as const,
      },
      {
        key: 'password',
        label: 'Reddit password (account must NOT have 2-factor auth)',
        validation: `/^.{6,}$/`,
        type: 'password' as const,
      },
    ];
  }

  async authenticate(params: { code: string; codeVerifier: string }) {
    let creds: RedditCredentials;
    try {
      const parsed = JSON.parse(Buffer.from(params.code, 'base64').toString());
      creds = {
        client_id: (parsed.client_id || '').trim(),
        client_secret: (parsed.client_secret || '').trim(),
        username: (parsed.username || '').trim().replace(/^\/?u\//, ''),
        password: parsed.password || '',
      };
    } catch {
      return 'Invalid credentials';
    }

    if (
      !creds.client_id ||
      !creds.client_secret ||
      !creds.username ||
      !creds.password
    ) {
      return 'Missing Reddit app ID, secret, username, or password';
    }

    let tokenRes: any;
    try {
      tokenRes = await this.passwordGrant(creds);
    } catch {
      tokenRes = null;
    }
    const accessToken = tokenRes?.access_token;
    const expiresIn = tokenRes?.expires_in;
    if (!accessToken) {
      return 'Reddit rejected the credentials. Check the app ID/secret and username/password — accounts with 2-factor auth are not supported by this method.';
    }

    let me: any;
    try {
      me = await this.fetchMe(accessToken, creds.username);
    } catch {
      me = null;
    }
    if (!me?.id) {
      return 'Could not load the Reddit account for these credentials.';
    }

    return {
      id: me.id,
      name: me.name,
      accessToken,
      refreshToken: this.storeCreds(creds),
      expiresIn,
      picture: me.icon_img?.split?.('?')?.[0] || '',
      username: me.name,
    };
  }

  private async uploadFileToReddit(accessToken: string, path: string) {
    const mimeType = lookup(path);
    const formData = new FormData();
    formData.append('filepath', path.split('/').pop()!);
    formData.append('mimetype', mimeType || 'application/octet-stream');

    const {
      args: { action, fields },
    } = await (
      await this.fetch(
        'https://oauth.reddit.com/api/media/asset',
        {
          method: 'POST',
          headers: {
            'User-Agent': 'web:postsider:v1.0',
            Authorization: `Bearer ${accessToken}`,
          },
          body: formData,
        },
        'reddit',
        0,
        true
      )
    ).json();

    const { data } = await axios.get(path, {
      responseType: 'arraybuffer',
    });

    const upload = (fields as { name: string; value: string }[]).reduce(
      (acc, value) => {
        acc.append(value.name, value.value);
        return acc;
      },
      new FormData()
    );

    upload.append(
      'file',
      new Blob([Buffer.from(data)], { type: mimeType as string })
    );

    const d = await fetch('https:' + action, {
      method: 'POST',
      body: upload,
    });

    return [...(await d.text()).matchAll(/<Location>(.*?)<\/Location>/g)][0][1];
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<RedditSettingsDto>[]
  ): Promise<PostResponse[]> {
    const [post] = postDetails;

    const valueArray: PostResponse[] = [];
    for (const firstPostSettings of post.settings.subreddit) {
      const kind =
        firstPostSettings.value.type === 'media'
          ? hasExtension(post.media![0].path, 'mp4')
            ? 'video'
            : 'image'
          : firstPostSettings.value.type;
      const postData = {
        api_type: 'json',
        title: firstPostSettings.value.title || '',
        kind:
          ['link', 'self', 'image', 'video', 'videogif'].indexOf(kind) > -1
            ? kind
            : 'self',
        ...(firstPostSettings.value.flair
          ? { flair_id: firstPostSettings.value.flair.id }
          : {}),
        ...(firstPostSettings.value.type === 'link'
          ? {
              url: firstPostSettings.value.url,
            }
          : {}),
        ...(firstPostSettings.value.type === 'media'
          ? {
              url: await this.uploadFileToReddit(
                accessToken,
                post.media![0].path
              ),
              ...(hasExtension(post.media![0].path, 'mp4')
                ? {
                    video_poster_url: await this.uploadFileToReddit(
                      accessToken,
                      post.media![0].thumbnail!
                    ),
                  }
                : {}),
            }
          : {}),
        text: post.message,
        sr: firstPostSettings.value.subreddit.replace('/r/', '').toLowerCase(),
      };

      const all = await (
        await this.fetch('https://oauth.reddit.com/api/submit', {
          method: 'POST',
          headers: {
            'User-Agent': 'web:postsider:v1.0',
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams(postData),
        })
      ).json();

      const {
        id: redditId,
        name,
        url,
      } = await new Promise<{
        id: string;
        name: string;
        url: string;
      }>((res) => {
        if (all?.json?.data?.id) {
          res(all.json.data);
        }

        const ws = new WebSocket(all.json.data.websocket_url);
        ws.on('message', (data: any) => {
          setTimeout(() => {
            res({ id: '', name: '', url: '' });
            ws.close();
          }, 30_000);
          try {
            const parsedData = JSON.parse(data.toString());
            if (parsedData?.payload?.redirect) {
              const onlyId = parsedData?.payload?.redirect.replace(
                /https:\/\/www\.reddit\.com\/r\/.*?\/comments\/(.*?)\/.*/g,
                '$1'
              );
              res({
                id: onlyId,
                name: `t3_${onlyId}`,
                url: parsedData?.payload?.redirect,
              });
            }
          } catch (err) {}
        });
      });

      valueArray.push({
        postId: redditId,
        releaseURL: url,
        id: post.id,
        status: 'published',
      });

      if (post.settings.subreddit.length > 1) {
        await timer(5000);
      }
    }

    return Object.values(groupBy(valueArray, (p) => p.id)).map((p) => ({
      id: p[0].id,
      postId: p.map((p) => p.postId).join(','),
      releaseURL: p.map((p) => p.releaseURL).join(','),
      status: 'published',
    }));
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<RedditSettingsDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;

    // Reddit uses thing_id format like t3_xxx for posts
    const thingId = postId.startsWith('t3_') ? postId : `t3_${postId}`;

    const {
      json: {
        data: {
          things: [
            {
              data: { id: commentId, permalink },
            },
          ],
        },
      },
    } = await (
      await this.fetch('https://oauth.reddit.com/api/comment', {
        method: 'POST',
        headers: {
          'User-Agent': 'web:postsider:v1.0',
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          text: commentPost.message,
          thing_id: thingId,
          api_type: 'json',
        }),
      })
    ).json();

    return [
      {
        postId: commentId,
        releaseURL: 'https://www.reddit.com' + permalink,
        id: commentPost.id,
        status: 'published',
      },
    ];
  }

  @Tool({
    description: 'Get list of subreddits with information',
    dataSchema: [
      {
        key: 'word',
        type: 'string',
        description: 'Search subreddit by string',
      },
    ],
  })
  async subreddits(accessToken: string, data: any) {
    const {
      data: { children },
    } = await (
      await this.fetch(
        `https://oauth.reddit.com/subreddits/search?show=public&q=${data.word}&sort=activity&show_users=false&limit=10`,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'web:postsider:v1.0',
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        'reddit',
        0,
        false
      )
    ).json();

    return children
      .filter(
        ({ data }: { data: any }) =>
          data.subreddit_type === 'public' && data.submission_type !== 'image'
      )
      .map(({ data: { title, url, id } }: any) => ({
        title,
        name: url,
        id,
      }));
  }

  private getPermissions(submissionType: string, allow_images: string) {
    const permissions: string[] = [];
    if (['any', 'self'].indexOf(submissionType) > -1) {
      permissions.push('self');
    }

    if (['any', 'link'].indexOf(submissionType) > -1) {
      permissions.push('link');
    }

    if (allow_images) {
      permissions.push('media');
    }

    return permissions;
  }

  @Tool({
    description: 'Get list of flairs and restrictions for a subreddit',
    dataSchema: [
      {
        key: 'subreddit',
        type: 'string',
        description:
          'Search flairs and restrictions by subreddit key should be "/r/[name]"',
      },
    ],
  })
  async restrictions(accessToken: string, data: { subreddit: string }) {
    const {
      data: { submission_type, allow_images, ...all2 },
    } = await (
      await this.fetch(
        `https://oauth.reddit.com/${data.subreddit}/about`,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'web:postsider:v1.0',
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        'reddit',
        0,
        false
      )
    ).json();

    const { is_flair_required, ...all } = await (
      await this.fetch(
        `https://oauth.reddit.com/api/v1/${
          data.subreddit.split('/r/')[1]
        }/post_requirements`,
        {
          method: 'GET',
          headers: {
            'User-Agent': 'web:postsider:v1.0',
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
        'reddit',
        0,
        false
      )
    ).json();

    // eslint-disable-next-line no-async-promise-executor
    const newData = await new Promise<{ id: string; name: string }[]>(
      async (res) => {
        try {
          const flair = await (
            await this.fetch(
              `https://oauth.reddit.com/${data.subreddit}/api/link_flair_v2`,
              {
                method: 'GET',
                headers: {
                  'User-Agent': 'web:postsider:v1.0',
            Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
              },
              'reddit',
              0,
              false
            )
          ).json();

          res(flair);
        } catch (err) {
          return res([]);
        }
      }
    );

    return {
      subreddit: data.subreddit,
      allow: this.getPermissions(submission_type, allow_images),
      is_flair_required: is_flair_required && newData.length > 0,
      flairs:
        newData?.map?.((p: any) => ({
          id: p.id,
          name: p.text,
        })) || [],
    };
  }
}
