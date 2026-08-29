import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import {
  NotEnoughScopes,
  SocialAbstract,
} from '@postsider/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import { DiscordDto } from '@postsider/nestjs-libraries/dtos/posts/providers-settings/discord.dto';
import { Tool } from '@postsider/nestjs-libraries/integrations/tool.decorator';

export class DiscordProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 5; // Discord has generous rate limits
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
      url: `https://discord.com/oauth2/authorize?client_id=${
        process.env.DISCORD_CLIENT_ID
      }&permissions=377957124096&response_type=code&redirect_uri=${encodeURIComponent(
        `${process.env.FRONTEND_URL}/integrations/social/discord`
      )}&integration_type=0&scope=bot+identify+guilds&state=${state}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  /**
   * Lets the user connect with THEIR OWN bot instead of the shared one, so
   * posts show up under their own bot's identity (name/avatar) on Discord —
   * the shared bot always posts as itself regardless of which server, and
   * Discord's Bot API has no per-message override for that (only webhooks
   * do, which is more moving parts than pasting a token). Offered as a
   * choice at connect time in the frontend (DiscordConnectModal), not a
   * replacement for the shared-bot OAuth flow above.
   */
  async customFields() {
    return [
      {
        key: 'botToken',
        label: 'Bot Token (Discord Developer Portal → your app → Bot → Reset Token)',
        validation: `/.+/`,
        type: 'password' as const,
      },
      {
        key: 'guildId',
        label: 'Server ID (enable Developer Mode in Discord, right-click your server icon → Copy Server ID)',
        validation: `/^\\d+$/`,
        type: 'text' as const,
      },
    ];
  }

  /** Bot token to use for API calls on this integration: the org's own bot
   * (stored token prefixed at connect time, see authenticate()'s custom
   * branch) if they brought one, otherwise the shared platform bot. */
  private resolveBotToken(accessToken?: string): string {
    return accessToken?.startsWith('custom:')
      ? accessToken.slice('custom:'.length)
      : process.env.DISCORD_BOT_TOKEN_ID || '';
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    // Bring-your-own-bot path: the customFields form base64-JSON-encodes the
    // field values into `code` (same convention every other customFields
    // provider uses, e.g. wordpress.provider.ts) instead of a real Discord
    // OAuth code, which is why this is a parse-and-check rather than a
    // dedicated params field — Discord is the only provider offering BOTH
    // an OAuth and a customFields path for the same connect action.
    try {
      const decoded = JSON.parse(
        Buffer.from(params.code, 'base64').toString()
      );
      if (decoded?.botToken && decoded?.guildId) {
        return this.authenticateWithOwnBot(decoded.botToken, decoded.guildId);
      }
    } catch {
      // Not base64 JSON — a real Discord OAuth code, fall through below.
    }

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

    // The channel/server list and the "connected as" identity in OUR OWN
    // dashboard should show the actual Discord server (name + icon), not
    // the shared bot's own application name/avatar — that's what made
    // every connection look like "PostSider" in the channel picker
    // regardless of which server it was. Posting itself still always shows
    // the bot's own identity on Discord (a platform limitation, not
    // something this fixes) — see customFields()/authenticateWithOwnBot
    // above for the option that actually changes what Discord displays.
    // this.fetch() itself throws (not just json() parse failures) on a
    // non-2xx response after its internal retries, so the whole block is
    // guarded — chaining .catch() only onto .json() would have let a
    // thrown BadBody/RefreshToken crash the entire connect instead of
    // falling back, and gave no visibility into WHY a guild lookup failed
    // when the fallback silently kicked in.
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

  private async authenticateWithOwnBot(botToken: string, guildId: string) {
    // Raw fetch, not this.fetch(): the shared fetch() throws BadBody/RefreshToken
    // whose message is 'Unknown Error' (Discord's actual response lives in
    // ApplicationFailure.details), which the connect endpoint turns into a
    // useless generic "Authentication failed". We want the user to SEE why their
    // own-bot connect failed. guildId is digits-only per the customFields regex,
    // and the host is fixed — no SSRF surface here.
    const safeGuildId = String(guildId).replace(/\D/g, '');
    const res = await fetch(`https://discord.com/api/guilds/${safeGuildId}`, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(10000),
    });
    const bodyText = await res.text();

    if (res.status === 401) {
      throw new NotEnoughScopes(
        'Invalid bot token — reset it in the Discord Developer Portal (Your App → Bot → Reset Token), then try again.'
      );
    }
    if (res.status === 404) {
      throw new NotEnoughScopes(
        'Your bot is not a member of that server — invite it via the OAuth2 URL in the Discord Developer Portal, then try again.'
      );
    }
    if (!res.ok) {
      throw new NotEnoughScopes(
        `Discord rejected the request (HTTP ${res.status}) — check the bot token and Server ID and try again.`
      );
    }

    let guildInfo: any = {};
    try {
      guildInfo = JSON.parse(bodyText);
    } catch {
      // fall through — the id check below will fail with a clear message
    }

    if (!guildInfo?.id) {
      throw new NotEnoughScopes(
        'Could not verify that server — check the Server ID and that your bot has been invited.'
      );
    }

    return {
      id: guildId,
      name: guildInfo.name,
      // Prefixed so post()/channels()/etc. know to use THIS token instead
      // of the shared platform bot — see resolveBotToken(). Bot tokens
      // don't expire the way OAuth access tokens do, so there is no
      // refresh token/cycle for this path (empty refreshToken already
      // excludes it from the token-refresh workflow, see
      // RefreshIntegrationService.startRefreshWorkflow's hasRefreshToken gate).
      accessToken: `custom:${botToken}`,
      refreshToken: '',
      expiresIn: 100 * 365 * 24 * 60 * 60,
      picture: guildInfo.icon
        ? `https://cdn.discordapp.com/icons/${guildId}/${guildInfo.icon}.png`
        : '',
      username: '',
    };
  }

  @Tool({ description: 'Channels', dataSchema: [] })
  async channels(accessToken: string, params: any, id: string) {
    const list = await (
      await this.fetch(`https://discord.com/api/guilds/${id}/channels`, {
        headers: {
          Authorization: `Bot ${this.resolveBotToken(accessToken)}`,
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

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const channel = firstPost.settings.channel;
    const botToken = this.resolveBotToken(accessToken);

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

    const data = await (
      await this.fetch(`https://discord.com/api/channels/${channel}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bot ${botToken}`,
        },
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
    const botToken = this.resolveBotToken(accessToken);

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
            Authorization: `Bot ${botToken}`,
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

    const data = await (
      await this.fetch(
        `https://discord.com/api/channels/${threadChannel}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bot ${botToken}`,
          },
          body: form,
        }
      )
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
          Authorization: `Bot ${this.resolveBotToken(accessToken)}`,
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
    const botToken = this.resolveBotToken(token);
    const allRoles = await (
      await this.fetch(`https://discord.com/api/guilds/${id}/roles`, {
        headers: {
          Authorization: `Bot ${botToken}`,
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
            Authorization: `Bot ${botToken}`,
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
