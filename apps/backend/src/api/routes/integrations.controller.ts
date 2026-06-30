import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { IntegrationFunctionDto } from '@postsider/nestjs-libraries/dtos/integrations/integration.function.dto';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { pricing } from '@postsider/nestjs-libraries/database/prisma/subscriptions/pricing';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationTimeDto } from '@postsider/nestjs-libraries/dtos/integrations/integration.time.dto';
import { PlugDto } from '@postsider/nestjs-libraries/dtos/plugs/plug.dto';
import { RefreshToken } from '@postsider/nestjs-libraries/integrations/social.abstract';

import { timer } from '@postsider/helpers/utils/timer';
import { TelegramProvider } from '@postsider/nestjs-libraries/integrations/social/telegram.provider';
import { MoltbookProvider } from '@postsider/nestjs-libraries/integrations/social/moltbook.provider';
import {
  AuthorizationActions,
  Sections,
} from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { uniqBy } from 'lodash';
import { RefreshIntegrationService } from '@postsider/nestjs-libraries/integrations/refresh.integration.service';
import { ProviderCredentialsService } from '@postsider/nestjs-libraries/database/prisma/integrations/provider-credentials.service';

@ApiTags('Integrations')
@Controller('/integrations')
export class IntegrationsController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _postService: PostsService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _providerCredentialsService: ProviderCredentialsService,
  ) {}

  @Post('/provider/:id/connect')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async saveProviderPage(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: any
  ) {
    return this._integrationService.saveProviderPage(org.id, id, body);
  }

  @Get('/:identifier/internal-plugs')
  getInternalPlugs(@Param('identifier') identifier: string) {
    return this._integrationManager.getInternalPlugs(identifier);
  }

  @Get('/customers')
  getCustomers(@GetOrgFromRequest() org: Organization) {
    return this._integrationService.customers(org.id);
  }

  @Put('/:id/group')
  async updateIntegrationGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { group: string }
  ) {
    return this._integrationService.updateIntegrationGroup(
      org.id,
      id,
      body.group
    );
  }

  @Put('/:id/customer-name')
  async updateOnCustomerName(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { name: string }
  ) {
    return this._integrationService.updateOnCustomerName(org.id, id, body.name);
  }

  @Get('/list')
  async getIntegrationList(@GetOrgFromRequest() org: Organization) {
    return {
      integrations: (await Promise.all(
        (
          await this._integrationService.getIntegrationsList(org.id)
        ).map(async (p) => {
          const findIntegration = this._integrationManager.getSocialIntegration(
            p.providerIdentifier
          );
          // Orphaned row for a provider no longer in socialIntegrationList
          // (e.g. a removed provider) — skip it so the whole channel list
          // doesn't 500 on `findIntegration.editor`.
          if (!findIntegration) return null;
          return {
            name: p.name,
            id: p.id,
            internalId: p.internalId,
            disabled: p.disabled,
            editor: findIntegration.editor,
            stripLinks: !!findIntegration?.stripLinks?.(),
            picture: p.picture || '/no-picture.jpg',
            identifier: p.providerIdentifier,
            inBetweenSteps: p.inBetweenSteps,
            refreshNeeded: p.refreshNeeded,
            isCustomFields: !!findIntegration.customFields,
            ...(findIntegration.customFields
              ? { customFields: await findIntegration.customFields() }
              : {}),
            display: p.profile,
            type: p.type,
            time: JSON.parse(p.postingTimes),
            changeProfilePicture: !!findIntegration?.changeProfilePicture,
            changeNickName: !!findIntegration?.changeNickname,
            customer: p.customer,
            additionalSettings: p.additionalSettings || '[]',
          };
        })
      )).filter(Boolean),
    };
  }

  @Post('/:id/settings')
  async updateProviderSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('additionalSettings') body: string
  ) {
    if (typeof body !== 'string') {
      throw new Error('Invalid body');
    }

    await this._integrationService.updateProviderSettings(org.id, id, body);
  }
  @Post('/:id/nickname')
  async setNickname(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { name: string; picture: string }
  ) {
    const integration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );
    if (!integration) {
      throw new Error('Invalid integration');
    }

    const manager = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!manager.changeProfilePicture && !manager.changeNickname) {
      throw new Error('Invalid integration');
    }

    const { url } = manager.changeProfilePicture
      ? await manager.changeProfilePicture(
          integration.internalId,
          integration.token,
          body.picture
        )
      : { url: '' };

    const { name } = manager.changeNickname
      ? await manager.changeNickname(
          integration.internalId,
          integration.token,
          body.name
        )
      : { name: '' };

    return this._integrationService.updateNameAndUrl(id, name, url);
  }

  @Get('/:id')
  getSingleIntegration(
    @Param('id') id: string,
    @Query('order') order: string,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    return this._integrationService.getIntegrationForOrder(
      id,
      order,
      user.id,
      org.id
    );
  }

  @Get('/social/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') refresh: string,
    @Query('externalUrl') externalUrl: string,
    @Query('redirectUrl') redirectUrl: string,
    @Query('onboarding') onboarding: string,
    @GetOrgFromRequest() org: Organization
  ) {
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new Error('Integration not allowed');
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    try {
      const state = makeId(10);

      await ioRedis.set(`organization:${state}`, org.id, 'EX', 3600);
      await ioRedis.set(`login:${state}`, 'none', 'EX', 3600);

      if (refresh) {
        await ioRedis.set(`refresh:${state}`, refresh, 'EX', 3600);
      }

      if (onboarding === 'true') {
        await ioRedis.set(`onboarding:${state}`, 'true', 'EX', 3600);
      }

      if (redirectUrl) {
        await ioRedis.set(`redirect:${state}`, redirectUrl, 'EX', 3600);
      }

      // Determine if this provider is OAuth-capable (has env mapping defined).
      // In SaaS mode, OAuth providers never expose manual credential fields to
      // the end user — only API-key-only providers get customFields.
      const isOAuthCapable = Object.keys(this.getEnvMapping(integration)).length > 0;

      let customFields: any[] | undefined;
      if (!isOAuthCapable) {
        // Manual-only provider — return the credential form fields.
        if (integrationProvider.customFields) {
          customFields = await integrationProvider.customFields();
        } else {
          customFields = this.getDefaultCustomFields(integration);
        }
      }

      // Try to generate an OAuth URL if the provider supports it and the
      // required env vars are configured. If it fails (missing keys, network
      // error), we simply omit the oauthUrl — the credential form remains
      // available as a fallback.
      let oauthUrl: string | undefined;
      let oauthConfigured = false;
      try {
        // Check if org has OAuth credentials stored in DB for this provider
        const dbCreds = await this._providerCredentialsService.getCredentials(org.id, integration);
        if (dbCreds && dbCreds.clientId && dbCreds.clientSecret) {
          // Temporarily inject into process.env so provider's generateAuthUrl works
          const envMapping = this.getEnvMapping(integration);
          const originalEnv: Record<string, string | undefined> = {};
          for (const [envKey, credKey] of Object.entries(envMapping)) {
            originalEnv[envKey] = process.env[envKey];
            if (credKey === 'clientId') process.env[envKey] = dbCreds.clientId;
            else if (credKey === 'clientSecret') process.env[envKey] = dbCreds.clientSecret;
          }

          try {
            const getExternalUrl = integrationProvider.externalUrl && externalUrl
              ? {
                  ...(await integrationProvider.externalUrl(externalUrl)),
                  instanceUrl: externalUrl,
                }
              : undefined;

            const authResult = await integrationProvider.generateAuthUrl(getExternalUrl);
            if (authResult?.url && authResult.url.startsWith('http')) {
              oauthUrl = authResult.url;
              oauthConfigured = true;
              await ioRedis.set(`login:${authResult.state}`, authResult.codeVerifier, 'EX', 3600);
              await ioRedis.set(`organization:${authResult.state}`, org.id, 'EX', 3600);
              if (refresh) {
                await ioRedis.set(`refresh:${authResult.state}`, refresh, 'EX', 3600);
              }
              if (onboarding === 'true') {
                await ioRedis.set(`onboarding:${authResult.state}`, 'true', 'EX', 3600);
              }
              if (redirectUrl) {
                await ioRedis.set(`redirect:${authResult.state}`, redirectUrl, 'EX', 3600);
              }
              if (getExternalUrl) {
                await ioRedis.set(`external:${authResult.state}`, JSON.stringify(getExternalUrl), 'EX', 3600);
              }
            }
          } finally {
            // Restore original env vars
            for (const [envKey] of Object.entries(envMapping)) {
              if (originalEnv[envKey] === undefined) delete process.env[envKey];
              else process.env[envKey] = originalEnv[envKey];
            }
          }
        } else if (!dbCreds) {
          // No DB creds — check if env vars are actually set (non-empty)
          const envMapping = this.getEnvMapping(integration);
          const hasEnvVars = Object.keys(envMapping).length > 0 &&
            Object.keys(envMapping).every((key) => !!process.env[key]?.trim());

          if (hasEnvVars) {
            const getExternalUrl = integrationProvider.externalUrl && externalUrl
              ? {
                  ...(await integrationProvider.externalUrl(externalUrl)),
                  instanceUrl: externalUrl,
                }
              : undefined;

            const authResult = await integrationProvider.generateAuthUrl(getExternalUrl);
            if (authResult?.url && authResult.url.startsWith('http')) {
              oauthUrl = authResult.url;
              oauthConfigured = true;
              await ioRedis.set(`login:${authResult.state}`, authResult.codeVerifier, 'EX', 3600);
              await ioRedis.set(`organization:${authResult.state}`, org.id, 'EX', 3600);
              if (refresh) {
                await ioRedis.set(`refresh:${authResult.state}`, refresh, 'EX', 3600);
              }
              if (onboarding === 'true') {
                await ioRedis.set(`onboarding:${authResult.state}`, 'true', 'EX', 3600);
              }
              if (redirectUrl) {
                await ioRedis.set(`redirect:${authResult.state}`, redirectUrl, 'EX', 3600);
              }
              if (getExternalUrl) {
                await ioRedis.set(`external:${authResult.state}`, JSON.stringify(getExternalUrl), 'EX', 3600);
              }
            }
          }
        }
      } catch (oauthErr) {
        // OAuth not available for this provider (missing env vars, etc.)
      }

      return {
        url: state,
        ...(customFields ? { customFields } : {}),
        ...(oauthUrl ? { oauthUrl } : {}),
        // Farcaster connects via the Sign In With Neynar widget (client-side),
        // which needs the SIWN client id; `url` (above) carries the validated state.
        ...(integration === 'wrapcast' && process.env.NEYNAR_CLIENT_ID
          ? { neynarClientId: process.env.NEYNAR_CLIENT_ID }
          : {}),
        oauthConfigured,
      };
    } catch (err) {
      return { err: true };
    }
  }

  private getEnvMapping(integration: string): Record<string, 'clientId' | 'clientSecret'> {
    const mappings: Record<string, Record<string, 'clientId' | 'clientSecret'>> = {
      x: { X_API_KEY: 'clientId', X_API_SECRET: 'clientSecret' },
      linkedin: { LINKEDIN_CLIENT_ID: 'clientId', LINKEDIN_CLIENT_SECRET: 'clientSecret' },
      'linkedin-page': { LINKEDIN_CLIENT_ID: 'clientId', LINKEDIN_CLIENT_SECRET: 'clientSecret' },
      facebook: { FACEBOOK_APP_ID: 'clientId', FACEBOOK_APP_SECRET: 'clientSecret' },
      instagram: { FACEBOOK_APP_ID: 'clientId', FACEBOOK_APP_SECRET: 'clientSecret' },
      'instagram-standalone': { INSTAGRAM_APP_ID: 'clientId', INSTAGRAM_APP_SECRET: 'clientSecret' },
      threads: { THREADS_APP_ID: 'clientId', THREADS_APP_SECRET: 'clientSecret' },
      youtube: { YOUTUBE_CLIENT_ID: 'clientId', YOUTUBE_CLIENT_SECRET: 'clientSecret' },
      gmb: { YOUTUBE_CLIENT_ID: 'clientId', YOUTUBE_CLIENT_SECRET: 'clientSecret' },
      blogger: { YOUTUBE_CLIENT_ID: 'clientId', YOUTUBE_CLIENT_SECRET: 'clientSecret' },
      tiktok: { TIKTOK_CLIENT_ID: 'clientId', TIKTOK_CLIENT_SECRET: 'clientSecret' },
      pinterest: { PINTEREST_CLIENT_ID: 'clientId', PINTEREST_CLIENT_SECRET: 'clientSecret' },
      dribbble: { DRIBBBLE_CLIENT_ID: 'clientId', DRIBBBLE_CLIENT_SECRET: 'clientSecret' },
      discord: { DISCORD_CLIENT_ID: 'clientId', DISCORD_CLIENT_SECRET: 'clientSecret' },
      slack: { SLACK_ID: 'clientId', SLACK_SECRET: 'clientSecret' },
      twitch: { TWITCH_CLIENT_ID: 'clientId', TWITCH_CLIENT_SECRET: 'clientSecret' },
      mastodon: { MASTODON_CLIENT_ID: 'clientId', MASTODON_CLIENT_SECRET: 'clientSecret' },
      whop: { WHOP_CLIENT_ID: 'clientId', WHOP_CLIENT_SECRET: 'clientSecret' },
    };
    return mappings[integration] || {};
  }

  private getOAuthSetupFields(integration: string): { key: string; label: string; type: 'text' | 'password' }[] | null {
    const fields: Record<string, { key: string; label: string; type: 'text' | 'password' }[]> = {
      x: [
        { key: 'clientId', label: 'API Key (Consumer Key)', type: 'text' },
        { key: 'clientSecret', label: 'API Secret (Consumer Secret)', type: 'password' },
      ],
      linkedin: [
        { key: 'clientId', label: 'Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      ],
      'linkedin-page': [
        { key: 'clientId', label: 'Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      ],
      facebook: [
        { key: 'clientId', label: 'Facebook App ID', type: 'text' },
        { key: 'clientSecret', label: 'Facebook App Secret', type: 'password' },
      ],
      instagram: [
        { key: 'clientId', label: 'Facebook App ID', type: 'text' },
        { key: 'clientSecret', label: 'Facebook App Secret', type: 'password' },
      ],
      'instagram-standalone': [
        { key: 'clientId', label: 'Instagram App ID', type: 'text' },
        { key: 'clientSecret', label: 'Instagram App Secret', type: 'password' },
      ],
      threads: [
        { key: 'clientId', label: 'Threads App ID', type: 'text' },
        { key: 'clientSecret', label: 'Threads App Secret', type: 'password' },
      ],
      youtube: [
        { key: 'clientId', label: 'Google Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Google Client Secret', type: 'password' },
      ],
      gmb: [
        { key: 'clientId', label: 'Google Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Google Client Secret', type: 'password' },
      ],
      tiktok: [
        { key: 'clientId', label: 'Client Key', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      ],
      pinterest: [
        { key: 'clientId', label: 'App ID', type: 'text' },
        { key: 'clientSecret', label: 'App Secret', type: 'password' },
      ],
      dribbble: [
        { key: 'clientId', label: 'Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      ],
      discord: [
        { key: 'clientId', label: 'Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      ],
      slack: [
        { key: 'clientId', label: 'Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      ],
      twitch: [
        { key: 'clientId', label: 'Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      ],
      mastodon: [
        { key: 'clientId', label: 'Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      ],
      whop: [
        { key: 'clientId', label: 'Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password' },
      ],
    };
    // Providers that are customFields-only (no OAuth) return null
    // so the frontend won't show "Setup OAuth" option for them.
    return fields[integration] || null;
  }

  private getDefaultCustomFields(integration: string) {
    const fields: Record<string, any[]> = {
      x: [
        { key: 'accessToken', label: 'Access Token (OAuth 1.0a)', validation: '/^.{3,}$/', type: 'password' },
        { key: 'accessSecret', label: 'Access Secret (OAuth 1.0a)', validation: '/^.{3,}$/', type: 'password' },
        { key: 'userId', label: 'User ID (numeric)', validation: '/^\\d+$/', type: 'text' },
        { key: 'username', label: 'Username (without @)', validation: '/^.{1,}$/', type: 'text' },
      ],
      linkedin: [
        { key: 'accessToken', label: 'Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'userId', label: 'Person ID (sub claim)', validation: '/^.{3,}$/', type: 'text' },
        { key: 'name', label: 'Display Name', validation: '/^.{1,}$/', type: 'text' },
      ],
      'linkedin-page': [
        { key: 'accessToken', label: 'Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'pageId', label: 'Organization ID (numeric)', validation: '/^\\d+$/', type: 'text' },
        { key: 'name', label: 'Page Name', validation: '/^.{1,}$/', type: 'text' },
      ],
      instagram: [
        { key: 'accessToken', label: 'Page Access Token (long-lived)', validation: '/^.{3,}$/', type: 'password' },
        { key: 'pageId', label: 'Instagram Business Account ID', validation: '/^\\d+$/', type: 'text' },
        { key: 'name', label: 'Account Name', validation: '/^.{1,}$/', type: 'text' },
      ],
      'instagram-standalone': [
        { key: 'accessToken', label: 'Long-lived Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'userId', label: 'Instagram User ID', validation: '/^\\d+$/', type: 'text' },
        { key: 'username', label: 'Username', validation: '/^.{1,}$/', type: 'text' },
      ],
      facebook: [
        { key: 'accessToken', label: 'Page Access Token (long-lived)', validation: '/^.{3,}$/', type: 'password' },
        { key: 'pageId', label: 'Facebook Page ID', validation: '/^\\d+$/', type: 'text' },
        { key: 'name', label: 'Page Name', validation: '/^.{1,}$/', type: 'text' },
      ],
      threads: [
        { key: 'accessToken', label: 'Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'userId', label: 'Threads User ID', validation: '/^\\d+$/', type: 'text' },
        { key: 'username', label: 'Username', validation: '/^.{1,}$/', type: 'text' },
      ],
      youtube: [
        { key: 'accessToken', label: 'OAuth Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'channelId', label: 'Channel ID (UC...)', validation: '/^.{3,}$/', type: 'text' },
        { key: 'name', label: 'Channel Name', validation: '/^.{1,}$/', type: 'text' },
      ],
      gmb: [
        { key: 'accessToken', label: 'OAuth Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'locationId', label: 'Location ID (accounts/XXX/locations/YYY)', validation: '/^.{3,}$/', type: 'text' },
        { key: 'name', label: 'Business Name', validation: '/^.{1,}$/', type: 'text' },
      ],
      tiktok: [
        { key: 'accessToken', label: 'Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'userId', label: 'Open ID (user ID)', validation: '/^.{3,}$/', type: 'text' },
        { key: 'username', label: 'Username', validation: '/^.{1,}$/', type: 'text' },
      ],
      pinterest: [
        { key: 'accessToken', label: 'Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'userId', label: 'User ID', validation: '/^.{3,}$/', type: 'text' },
        { key: 'username', label: 'Username', validation: '/^.{1,}$/', type: 'text' },
      ],
      dribbble: [
        { key: 'accessToken', label: 'Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'userId', label: 'User ID', validation: '/^\\d+$/', type: 'text' },
        { key: 'username', label: 'Username', validation: '/^.{1,}$/', type: 'text' },
      ],
      discord: [
        { key: 'serverId', label: 'Server (Guild) ID', validation: '/^\\d+$/', type: 'text' },
        { key: 'name', label: 'Bot/Server Name', validation: '/^.{1,}$/', type: 'text' },
      ],
      slack: [
        { key: 'accessToken', label: 'Bot OAuth Token (xoxb-...)', validation: '/^xoxb-.{3,}$/', type: 'password' },
        { key: 'teamId', label: 'Workspace ID (Team ID)', validation: '/^.{3,}$/', type: 'text' },
        { key: 'name', label: 'Bot Name', validation: '/^.{1,}$/', type: 'text' },
      ],
      twitch: [
        { key: 'accessToken', label: 'Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'userId', label: 'User ID (numeric)', validation: '/^\\d+$/', type: 'text' },
        { key: 'username', label: 'Channel Name', validation: '/^.{1,}$/', type: 'text' },
      ],
      mastodon: [
        { key: 'accessToken', label: 'Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'instanceUrl', label: 'Instance URL', defaultValue: 'https://mastodon.social', validation: '/^https?:\\/\\/.+/', type: 'text' },
        { key: 'username', label: 'Username', validation: '/^.{1,}$/', type: 'text' },
      ],
      'mastodon-custom': [
        { key: 'accessToken', label: 'Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'instanceUrl', label: 'Instance URL', validation: '/^https?:\\/\\/.+/', type: 'text' },
        { key: 'username', label: 'Username', validation: '/^.{1,}$/', type: 'text' },
      ],
      whop: [
        { key: 'accessToken', label: 'Access Token', validation: '/^.{3,}$/', type: 'password' },
        { key: 'userId', label: 'User ID (sub)', validation: '/^.{3,}$/', type: 'text' },
        { key: 'username', label: 'Username', validation: '/^.{1,}$/', type: 'text' },
      ],
      wrapcast: [
        { key: 'signerUuid', label: 'Signer UUID (from Neynar)', validation: '/^.{3,}$/', type: 'password' },
        { key: 'fid', label: 'Farcaster FID', validation: '/^\\d+$/', type: 'text' },
        { key: 'username', label: 'Username', validation: '/^.{1,}$/', type: 'text' },
      ],
    };

    return fields[integration] || [
      { key: 'accessToken', label: 'Access Token', defaultValue: '', validation: '/^.{3,}$/', type: 'password' },
    ];
  }

  @Post('/:id/time')
  async setTime(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: IntegrationTimeDto
  ) {
    return this._integrationService.setTimes(org.id, id, body);
  }

  // Queue plan = the channel's recurring posting slots ({ time, days? }[]).
  // Backed by the same postingTimes field used by Add to queue / find-slot.
  @Get('/:id/queue-plan')
  async getQueuePlan(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    const integration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );
    const slots = integration?.postingTimes
      ? JSON.parse(integration.postingTimes)
      : [];
    return { slots };
  }

  @Put('/:id/queue-plan')
  async setQueuePlan(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: IntegrationTimeDto
  ) {
    return this._integrationService.setTimes(org.id, id, body);
  }

  @Post('/mentions')
  async mentions(
    @GetOrgFromRequest() org: Organization,
    @Body() body: IntegrationFunctionDto
  ) {
    const getIntegration = await this._integrationService.getIntegrationById(
      org.id,
      body.id
    );
    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    let newList: any[] | { none: true } = [];
    try {
      newList = (await this.functionIntegration(org, body)) || [];
    } catch (err) {
      console.log(err);
    }

    if (!Array.isArray(newList) && newList?.none) {
      return newList;
    }

    const list = await this._integrationService.getMentions(
      getIntegration.providerIdentifier,
      body?.data?.query
    );

    if (Array.isArray(newList) && newList.length) {
      await this._integrationService.insertMentions(
        getIntegration.providerIdentifier,
        newList
          .map((p: any) => ({
            name: p.label || '',
            username: p.id || '',
            image: p.image || '',
            doNotCache: p.doNotCache || false,
          }))
          .filter((f: any) => f.name && !f.doNotCache)
      );
    }

    return uniqBy(
      [
        ...list.map((p) => ({
          id: p.username,
          image: p.image,
          label: p.name,
        })),
        ...(newList as any[]),
      ],
      (p) => p.id
    ).filter((f) => f.label && f.id);
  }

  @Post('/function')
  async functionIntegration(
    @GetOrgFromRequest() org: Organization,
    @Body() body: IntegrationFunctionDto
  ): Promise<any> {
    const getIntegration = await this._integrationService.getIntegrationById(
      org.id,
      body.id
    );
    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );
    if (!integrationProvider) {
      throw new Error('Invalid provider');
    }

    // Only allow invoking methods explicitly registered as @Tool functions for
    // this provider — never arbitrary properties/methods on the instance
    // (e.g. fetch, refreshToken, internal helpers). `body.name` comes straight
    // from the client.
    const allowedTools: string[] = (
      Reflect.getMetadata(
        'custom:tool',
        (integrationProvider as any)?.constructor?.prototype
      ) || []
    ).map((t: { methodName: string }) => t.methodName);

    if (!allowedTools.includes(body.name)) {
      throw new Error('Invalid function');
    }

    // @ts-ignore
    if (integrationProvider[body.name]) {
      try {
        // @ts-ignore
        const load = await integrationProvider[body.name](
          getIntegration.token,
          body.data,
          getIntegration.internalId,
          getIntegration
        );

        return load;
      } catch (err) {
        if (err instanceof RefreshToken) {
          const data = await this._refreshIntegrationService.refresh(
            getIntegration
          );

          if (!data) {
            return;
          }

          const { accessToken } = data;

          if (accessToken) {
            if (integrationProvider.refreshWait) {
              await timer(10000);
            }
            return this.functionIntegration(org, body);
          }

          return false;
        }

        return false;
      }
    }
    throw new Error('Function not found');
  }

  @Post('/disable')
  disableChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    return this._integrationService.disableChannel(org.id, id);
  }

  @Post('/enable')
  enableChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    return this._integrationService.enableChannel(
      org.id,
      // @ts-ignore
      org?.subscription?.totalChannels || pricing.FREE.channel,
      id
    );
  }

  @Delete('/')
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    const isTherePosts = await this._integrationService.getPostsForChannel(
      org.id,
      id
    );
    if (isTherePosts.length) {
      for (const post of isTherePosts) {
        this._postService.deletePost(org.id, post.group).catch((err) => {});
      }
    }

    return this._integrationService.deleteChannel(org.id, id);
  }

  @Get('/plug/list')
  async getPlugList() {
    return { plugs: this._integrationManager.getAllPlugs() };
  }

  @Get('/:id/plugs')
  async getPlugsByIntegrationId(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization
  ) {
    return this._integrationService.getPlugsByIntegrationId(org.id, id);
  }

  @Post('/:id/plugs')
  async postPlugsByIntegrationId(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @Body() body: PlugDto
  ) {
    return this._integrationService.createOrUpdatePlug(org.id, id, body);
  }

  @Put('/plugs/:id/activate')
  async changePlugActivation(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @Body('status') status: boolean
  ) {
    return this._integrationService.changePlugActivation(org.id, id, status);
  }

  @Get('/telegram/updates')
  async getUpdates(@Query() query: { word: string; id?: number }) {
    return new TelegramProvider().getBotId(query);
  }

  @Post('/moltbook/register')
  async moltbookRegister(@Body() body: { name: string; description: string }) {
    try {
      const provider = new MoltbookProvider();
      const result = await provider.registerAgent(body.name, body.description);
      return {
        apiKey: result.api_key,
        claimUrl: result.claim_url,
        verificationCode: result.verification_code,
      };
    } catch (err: any) {
      return { error: err.message || 'Registration failed' };
    }
  }

  @Get('/moltbook/status')
  async moltbookStatus(@Query('apiKey') apiKey: string) {
    try {
      const provider = new MoltbookProvider();
      const result = await provider.checkAgentStatus(apiKey);
      return { claimed: result?.status === 'claimed' };
    } catch (err) {
      return { claimed: false };
    }
  }
}
