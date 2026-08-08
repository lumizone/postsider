import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { SocialAbstract } from '@postsider/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import { DiscordDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/discord.dto';
import { Tool } from '@postsider/nestjs-libraries/integrations/tool.decorator';

export class DiscordProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 5; // Discord has generous rate limits for webhook posting
  identifier = 'discord';
  name = 'Discord';
  isBetweenSteps = false;
  editor = 'markdown' as const;
  scopes = ['identify', 'guilds'];
  maxLength() {
    return 1980;
  }
  dto = DiscordDto;

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    const { access_token, expires_in, refresh_token } = await (
      await this.fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            process.env.DISCORD_CLIENT_ID +
              ':' +
              process.env.DISCORD_CLIENT_SECRET
          ).toString('base64')}`,
        },
      })
    ).json();

    const { application } = await (
      await this.fetch('https://discord.com/api/oauth2/@me', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    return {
      refreshToken: refresh_token,
      expiresIn: expires_in,
      accessToken: access_token,
      id: '',
      name: application.name,
      picture: '',
      username: '',
    };
  }
  async generateAuthUrl() {
    const state = makeId(6);
    return {
      // 377957124096 + MANAGE_WEBHOOKS (1<<29). Needed so posts can go out
      // through a per-channel webhook (shows the server's own name/icon)
      // instead of the shared bot's identity — see getOrCreateWebhook().
      // Servers that invited the bot before this change won't have the new
      // permission until they re-invite/reauthorize it; post() falls back
      // to the old bot-API path when webhook creation fails for that reason.
      url: `https://discord.com/oauth2/authorize?client_id=${
        process.env.DISCORD_CLIENT_ID
      }&permissions=378493995008&response_type=code&redirect_uri=${encodeURIComponent(
        `${process.env.FRONTEND_URL}/integrations/social/discord`
      )}&integration_type=0&scope=bot+identify+guilds&state=${state}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { access_token, expires_in, refresh_token, scope, guild } = await (
      await this.fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          code: params.code,
          grant_type: 'authorization_code',
          redirect_uri: `${process.env.FRONTEND_URL}/integrations/social/discord`,
        }),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            process.env.DISCORD_CLIENT_ID +
              ':' +
              process.env.DISCORD_CLIENT_SECRET
          ).toString('base64')}`,
        },
      })
    ).json();

    this.checkScopes(this.scopes, scope.split(' '));

    const { application } = await (
      await this.fetch('https://discord.com/api/oauth2/@me', {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    ).json();

    // The channel/server list and the "connected as" identity should show
    // the actual Discord server (name + icon), not the shared bot's own
    // application name/avatar — that's what made every connection look
    // like "PostSider" regardless of which server it was. Falls back to
    // the bot's avatar only if the server has no icon set (common for
    // small/new servers) or the guild lookup fails for any reason.
    // this.fetch() itself throws (not just json() parse failures) on a
    // non-2xx response after its internal retries, so the whole block is
    // guarded — an earlier version only chained .catch() onto .json(),
    // which would have let a thrown BadBody/RefreshToken crash the entire
    // connect instead of falling back, and gave no visibility into WHY a
    // guild lookup failed when the fallback silently kicked in.
    let guildInfo: any = {};
    try {
      guildInfo = await (
        await this.fetch(`https://discord.com/api/guilds/${guild.id}`, {
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
          },
        })
      ).json();
    } catch (err) {
      console.error(
        `[discord] GET /guilds/${guild.id} failed, falling back to the bot's own name/avatar:`,
        err instanceof Error ? err.message : err
      );
    }

    return {
      id: guild.id,
      name: guildInfo?.name || application.name,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      picture: guildInfo?.icon
        ? `https://cdn.discordapp.com/icons/${guild.id}/${guildInfo.icon}.png`
        : `https://cdn.discordapp.com/avatars/${application.bot.id}/${application.bot.avatar}.png`,
      username: application.bot.username,
    };
  }

  @Tool({ description: 'Channels', dataSchema: [] })
  async channels(accessToken: string, params: any, id: string) {
    const list = await (
      await this.fetch(`https://discord.com/api/guilds/${id}/channels`, {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
        },
      })
    ).json();

    return list
      .filter((p: any) => p.type === 0 || p.type === 5 || p.type === 15)
      .map((p: any) => ({
        id: String(p.id),
        name: p.name,
      }));
  }

  /**
   * A webhook lets each message show the SERVER's own name/icon instead of
   * the shared bot's identity (the bot API has no per-message override —
   * that is exclusively a webhook feature). Reused across posts by name
   * rather than persisted anywhere: cheap to look up (Discord's rate limits
   * here are generous, per maxConcurrentJob above), self-healing if the
   * webhook is deleted on Discord's side, and needs no schema change.
   * Returns null (never throws) so callers can fall back to the bot API —
   * servers that invited the bot before MANAGE_WEBHOOKS was added to the
   * OAuth scope (see generateAuthUrl) will 403 here until they re-invite it.
   */
  private async getOrCreateWebhook(
    channel: string
  ): Promise<{ id: string; token: string } | null> {
    const WEBHOOK_NAME = 'PostSider Publisher';
    try {
      const existing = await (
        await this.fetch(`https://discord.com/api/channels/${channel}/webhooks`, {
          headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}` },
        })
      ).json();

      const found = Array.isArray(existing)
        ? existing.find((w: any) => w.name === WEBHOOK_NAME && w.token)
        : undefined;
      if (found) {
        return { id: found.id, token: found.token };
      }

      const created = await (
        await this.fetch(`https://discord.com/api/channels/${channel}/webhooks`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: WEBHOOK_NAME }),
        })
      ).json();

      return created?.id && created?.token
        ? { id: created.id, token: created.token }
        : null;
    } catch (err) {
      console.error(
        `[discord] webhook get-or-create failed for channel ${channel}, falling back to the bot API (likely missing MANAGE_WEBHOOKS — server needs to re-invite the bot):`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const channel = firstPost.settings.channel;

    const webhook = await this.getOrCreateWebhook(channel);

    const form = new FormData();
    form.append(
      'payload_json',
      JSON.stringify({
        content: firstPost.message.replace(/\[\[\[(@.*?)]]]/g, (match, p1) => {
          return `<${p1}>`;
        }),
        attachments: firstPost.media?.map((p, index) => ({
          id: index,
          description: `Picture ${index}`,
          filename: p.path.split('/').pop(),
        })),
        // Only meaningful on the webhook path — the bot-API path ignores
        // these fields and always shows the bot's own identity instead.
        ...(webhook
          ? { username: integration.name, avatar_url: integration.picture }
          : {}),
      })
    );

    let index = 0;
    for (const media of firstPost.media || []) {
      const loadMedia = await fetch(media.path);

      form.append(
        `files[${index}]`,
        await loadMedia.blob(),
        media.path.split('/').pop()
      );
      index++;
    }

    const postUrl = webhook
      ? `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}?wait=true`
      : `https://discord.com/api/channels/${channel}/messages`;

    const data = await (
      await this.fetch(postUrl, {
        method: 'POST',
        headers: webhook
          ? {}
          : { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}` },
        body: form,
      })
    ).json();

    return [
      {
        id: firstPost.id,
        releaseURL: `https://discord.com/channels/${id}/${channel}/${data.id}`,
        postId: data.id,
        status: 'success',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const channel = commentPost.settings.channel;

    // Discord threads are keyed by the original message id, so the same thread
    // serves every comment in the chain. Always ask Discord for the thread and
    // reuse the existing one when it reports "Thread has already been created"
    // (code 160004, body carries existing_thread) — otherwise second and later
    // comments would escape the thread and land in the channel.
    const threadResponse = await (
      await this.fetch(
        `https://discord.com/api/channels/${channel}/messages/${postId}/threads`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: 'Thread',
            auto_archive_duration: 1440,
          }),
        }
      )
    ).json();

    const threadChannel =
      threadResponse?.id ||
      threadResponse?.existing_thread?.id ||
      threadResponse?.thread?.id;
    if (!threadChannel) {
      throw new Error('Could not create or resolve Discord thread');
    }

    // Same webhook the original post used (it belongs to the parent channel,
    // not the thread) — keeps the comment branded the same way instead of
    // suddenly switching to the bot's identity mid-conversation.
    const webhook = await this.getOrCreateWebhook(channel);

    const form = new FormData();
    form.append(
      'payload_json',
      JSON.stringify({
        content: commentPost.message.replace(/\[\[\[(@.*?)]]]/g, (match, p1) => {
            return `<${p1}>`;
        }),
        attachments: commentPost.media?.map((p, index) => ({
          id: index,
          description: `Picture ${index}`,
          filename: p.path.split('/').pop(),
        })),
        ...(webhook
          ? { username: integration.name, avatar_url: integration.picture }
          : {}),
      })
    );

    let index = 0;
    for (const media of commentPost.media || []) {
      const loadMedia = await fetch(media.path);

      form.append(
        `files[${index}]`,
        await loadMedia.blob(),
        media.path.split('/').pop()
      );
      index++;
    }

    const commentUrl = webhook
      ? `https://discord.com/api/webhooks/${webhook.id}/${webhook.token}?wait=true&thread_id=${threadChannel}`
      : `https://discord.com/api/channels/${threadChannel}/messages`;

    const data = await (
      await this.fetch(commentUrl, {
        method: 'POST',
        headers: webhook
          ? {}
          : { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}` },
        body: form,
      })
    ).json();

    return [
      {
        id: commentPost.id,
        releaseURL: `https://discord.com/channels/${id}/${threadChannel}/${data.id}`,
        postId: data.id,
        status: 'success',
      },
    ];
  }

  async changeNickname(id: string, accessToken: string, name: string) {
    await (
      await this.fetch(`https://discord.com/api/guilds/${id}/members/@me`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nick: name,
        }),
      })
    ).json();

    return {
      name,
    };
  }

  override async mention(
    token: string,
    data: { query: string },
    id: string,
    integration: Integration
  ) {
    const allRoles = await (
      await this.fetch(`https://discord.com/api/guilds/${id}/roles`, {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
          'Content-Type': 'application/json',
        },
      })
    ).json();

    const matching = allRoles
      .filter((role: any) =>
        role.name.toLowerCase().includes(data.query.toLowerCase())
      )
      .filter((f: any) => f.name !== '@everyone' && f.name !== '@here');

    const list = await (
      await this.fetch(
        `https://discord.com/api/guilds/${id}/members/search?query=${encodeURIComponent(
          data.query
        )}`,
        {
          headers: {
            Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN_ID}`,
            'Content-Type': 'application/json',
          },
        }
      )
    ).json();

    return [
      ...[
        {
          id: String('here'),
          label: 'here',
          image: '',
          doNotCache: true,
        },
        {
          id: String('everyone'),
          label: 'everyone',
          image: '',
          doNotCache: true,
        },
      ].filter((role: any) => {
        return role.label.toLowerCase().includes(data.query.toLowerCase());
      }),
      ...matching.map((p: any) => ({
        id: String('&' + p.id),
        label: p.name.split('@')[1],
        image: '',
        doNotCache: true,
      })),
      ...list.map((p: any) => ({
        id: String(p.user.id),
        label: p.user.global_name || p.user.username,
        image: `https://cdn.discordapp.com/avatars/${p.user.id}/${p.user.avatar}.png`,
      })),
    ];
  }

  mentionFormat(idOrHandle: string, name: string) {
    if (name === '@here' || name === '@everyone') {
      return name;
    }
    return `[[[@${idOrHandle.replace('@', '')}]]]`;
  }

  override handleErrors(
    body: string
  ):
    | { type: 'refresh-token' | 'bad-body' | 'retry'; value: string }
    | undefined {
    if (body.includes('50001')) {
      return {
        type: 'bad-body',
        value: "Bot doesn't have access to this channel",
      };
    }

    if (body.includes('50013')) {
      return {
        type: 'bad-body',
        value: 'Bot lacks permission to send messages in this channel',
      };
    }

    if (body.includes('10003')) {
      return {
        type: 'bad-body',
        value: 'Channel no longer exists',
      };
    }

    if (body.includes('40005')) {
      return {
        type: 'bad-body',
        value: "Attachment exceeds Discord's size limit",
      };
    }

    if (body.includes('20028')) {
      return {
        type: 'retry',
        value: 'Rate limited by Discord',
      };
    }

    return undefined;
  }
}
