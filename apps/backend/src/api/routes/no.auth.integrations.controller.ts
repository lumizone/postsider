import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { ConnectIntegrationDto } from '@postsider/nestjs-libraries/dtos/integrations/connect.integration.dto';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { ApiTags } from '@nestjs/swagger';
import { NotEnoughScopesFilter } from '@postsider/nestjs-libraries/integrations/integration.missing.scopes';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { AuthTokenDetails } from '@postsider/nestjs-libraries/integrations/social/social.integrations.interface';
import { NotEnoughScopes } from '@postsider/nestjs-libraries/integrations/social.abstract';
import {
  AuthorizationActions,
  Sections,
} from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { RefreshIntegrationService } from '@postsider/nestjs-libraries/integrations/refresh.integration.service';
import { ssrfSafeDispatcher } from '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { isBillingEnabled } from '@postsider/nestjs-libraries/services/billing.flag';
import { PermissionsService } from '@postsider/backend/services/auth/permissions/permissions.service';

@ApiTags('Integrations')
@Controller('/integrations')
export class NoAuthIntegrationsController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _organizationService: OrganizationService,
    private _permissionsService: PermissionsService
  ) {}

  @Get('/')
  getIntegrations() {
    return this._integrationManager.getAllIntegrations();
  }

  @Post('/social-connect/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  @UseFilters(new NotEnoughScopesFilter())
  async connectSocialMedia(
    @Param('integration') integration: string,
    @Body() body: ConnectIntegrationDto
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

    const storedVerifier = await ioRedis.get(`login:${body.state}`);
    // Distinguish "no verifier stored for this state" from a stored but empty
    // value; the `|| 'none'` fallback made this guard unreachable and let a
    // replayed/already-consumed state proceed with a bogus verifier.
    if (storedVerifier === null) {
      throw new Error('Invalid state');
    }
    const getCodeVerifier = storedVerifier || 'none';

    const organization = await ioRedis.get(`organization:${body.state}`);
    if (!organization) {
      throw new Error('Organization not found');
    }

    const org = (await this._organizationService.getOrgById(organization))!;

    await ioRedis.del(`login:${body.state}`);

    const details = integrationProvider.externalUrl
      ? await ioRedis.get(`external:${body.state}`)
      : undefined;

    if (details) {
      await ioRedis.del(`external:${body.state}`);
    }

    const refresh = await ioRedis.get(`refresh:${body.state}`);
    if (refresh) {
      await ioRedis.del(`refresh:${body.state}`);
    }

    const onboarding = await ioRedis.get(`onboarding:${body.state}`);
    if (onboarding) {
      await ioRedis.del(`onboarding:${body.state}`);
    }

    const {
      error,
      accessToken,
      expiresIn,
      refreshToken,
      id,
      name,
      picture,
      username,
      additionalSettings,
      // eslint-disable-next-line no-async-promise-executor
    } = await new Promise<AuthTokenDetails>(async (res) => {
      try {
        // For providers without customFields, handle direct token paste
        if (!integrationProvider.customFields) {
          try {
            const decoded = JSON.parse(Buffer.from(body.code, 'base64').toString());
            if (decoded.accessToken || decoded.signerUuid || decoded.serverId || decoded.cookies) {
              // Build the appropriate token format per provider
              let token = decoded.accessToken || '';
              let odId = decoded.userId || decoded.pageId || decoded.channelId || decoded.teamId || decoded.locationId || decoded.serverId || decoded.fid || '';
              let odName = decoded.name || decoded.username || integration;
              let odUsername = decoded.username || '';

              // X: token format is accessToken:accessSecret
              if (integration === 'x' && decoded.accessSecret) {
                token = `${decoded.accessToken}:${decoded.accessSecret}`;
              }

              // Instagram: token format is pageToken___userToken (we only have page token)
              if (integration === 'instagram') {
                token = `${decoded.accessToken}___${decoded.accessToken}`;
                odId = decoded.pageId || '';
              }

              // Discord: doesn't use token for posting (uses env BOT_TOKEN), id is guild/server ID
              if (integration === 'discord') {
                token = decoded.accessToken || 'bot-token-from-env';
                odId = decoded.serverId || '';
              }

              // Farcaster: signer UUID is the token
              if (integration === 'wrapcast') {
                token = decoded.signerUuid || '';
                odId = decoded.fid || '';
              }

              // LinkedIn Page: id is the org ID
              if (integration === 'linkedin-page') {
                odId = decoded.pageId || '';
              }

              // YouTube: id is channel ID
              if (integration === 'youtube') {
                odId = decoded.channelId || '';
              }

              // GMB: id is location path
              if (integration === 'gmb') {
                odId = decoded.locationId || '';
              }

              return res({
                id: odId || token.substring(0, 16),
                name: odName,
                accessToken: token,
                refreshToken: '',
                expiresIn: 999999999,
                picture: '',
                username: odUsername,
              });
            }
          } catch {
            // Not base64 JSON — fall through to normal authenticate
          }
        }

        const auth = await integrationProvider.authenticate(
          {
            code: body.code,
            codeVerifier: getCodeVerifier,
            refresh: body.refresh,
          },
          details ? JSON.parse(details) : undefined
        );

        if (typeof auth === 'string') {
          return res({
            error: auth,
            accessToken: '',
            id: '',
            name: '',
            picture: '',
            username: '',
            additionalSettings: [],
          });
        }

        if (refresh && integrationProvider.reConnect) {
          try {
            const newAuth = await integrationProvider.reConnect(
              auth.id,
              refresh,
              auth.accessToken
            );
            return res({ ...newAuth, refreshToken: body.refresh });
          } catch (err: any) {
            return res({
              error: err.message,
              accessToken: '',
              id: '',
              name: '',
              picture: '',
              username: '',
              additionalSettings: [],
            });
          }
        }

        return res(auth);
      } catch (err) {
        if (err instanceof NotEnoughScopes) {
          return res({
            error: err.message,
            accessToken: '',
            id: '',
            name: '',
            picture: '',
            username: '',
            additionalSettings: [],
          });
        }

        return res({
          error: 'Authentication failed',
          accessToken: '',
          id: '',
          name: '',
          picture: '',
          username: '',
          additionalSettings: [],
        });
      }
    });

    if (error) {
      throw new NotEnoughScopes(error);
    }

    if (!id) {
      throw new NotEnoughScopes('Invalid API key');
    }

    if (refresh && String(id) !== String(refresh)) {
      throw new NotEnoughScopes(
        'Please refresh the channel that needs to be refreshed'
      );
    }

    let validName = name;
    if (!validName) {
      if (username) {
        validName = username.split('.')[0] ?? username;
      } else {
        validName = `Channel_${String(id).slice(0, 8)}`;
      }
    }

    if (
      isBillingEnabled() &&
      org.isTrailing &&
      (await this._integrationService.checkPreviousConnections(
        org.id,
        String(id)
      ))
    ) {
      throw new HttpException('', 412);
    }

    // BILLING AUDIT FIX (2026-08-06): this endpoint runs entirely outside
    // AuthMiddleware (NoAuthIntegrationsController isn't in
    // api.module.ts's authenticatedController list — org context here comes
    // from Redis state, not req.org), so the global PoliciesGuard
    // unconditionally bypasses `/integrations/social-connect/*` (it has to —
    // req.org is never set here, so the guard's own fail-closed check would
    // otherwise 403 every legitimate connect). That makes the
    // @CheckPolicies([Create, CHANNEL]) decorator above dead code: it's
    // never evaluated. Concretely, every account — FREE (0 channels) or any
    // paid tier — could connect UNLIMITED channels through this endpoint
    // with the plan limit fully unenforced. `refresh` truthy means this is
    // reconnecting an EXISTING channel (already counted), not a new one, so
    // it's exempt — same exemption the guard's CHANNEL branch makes via
    // `refreshChannelId`.
    if (!refresh && isBillingEnabled()) {
      const { options, subscription } =
        await this._permissionsService.getPackageOptions(org.id);
      const totalChannels = (
        await this._integrationService.getIntegrationsList(org.id)
      ).filter((f) => !f.refreshNeeded).length;
      const hasCapacity =
        (options.channel && options.channel > totalChannels) ||
        (subscription?.totalChannels || 0) > totalChannels;
      if (!hasCapacity) {
        throw new HttpException(
          'Channel limit reached for your plan. Upgrade to connect more channels.',
          402
        );
      }
    }

    const createUpdate =
      await this._integrationService.createOrUpdateIntegration(
        additionalSettings,
        !!integrationProvider.oneTimeToken,
        org.id,
        validName.trim(),
        picture,
        'social',
        String(id),
        integration,
        accessToken,
        refreshToken,
        expiresIn,
        username,
        refresh ? false : integrationProvider.isBetweenSteps,
        body.refresh,
        +body.timezone,
        details
          ? AuthService.encryptSecret(details)
          : integrationProvider.customFields
          ? AuthService.encryptSecret(
              Buffer.from(body.code, 'base64').toString()
            )
          : integrationProvider.isChromeExtension
          ? AuthService.encryptSecret(
              Buffer.from(body.code, 'base64').toString()
            )
          : undefined
      );

    this._refreshIntegrationService
      .startRefreshWorkflow(org.id, createUpdate.id, !!createUpdate.refreshToken)
      .catch((err) => {
        console.log(err);
      });

    // Fetch pages if this is a two-step provider and not a refresh
    let pages: any[] = [];
    if (integrationProvider.isBetweenSteps && !refresh) {
      try {
        // Check which method the provider uses (pages or companies)
        const fetchMethod =
          'pages' in integrationProvider
            ? 'pages'
            : 'companies' in integrationProvider
            ? 'companies'
            : null;

        if (fetchMethod) {
          // @ts-ignore - dynamic method call
          pages = await integrationProvider[fetchMethod](accessToken);
        }
      } catch (err) {
        console.log('Failed to fetch pages:', err);
      }
    }

    const webhookUrl = await ioRedis.get(`webhookUrl:${body.state}`);
    if (webhookUrl) {
      try {
        // The webhook URL comes from the caller's JWT — route it through the
        // DNS-pinned SSRF-safe dispatcher and bound it so a slow/private
        // endpoint cannot hang the request or probe internal addresses.
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
          // @ts-ignore — undici option, not in lib.dom fetch types
          dispatcher: ssrfSafeDispatcher,
          body: JSON.stringify({
            params: AuthService.signJWT({
              apiKey: org.apiKey,
            }),
          }),
        });
      } catch (err) {
        console.warn('Connect webhook delivery failed', err);
      }

      await ioRedis.del(`webhookUrl:${body.state}`);
    }

    const returnURL = await ioRedis.get(`redirect:${body.state}`);
    if (returnURL) {
      await ioRedis.del(`redirect:${body.state}`);
    }

    const extensionToken = integrationProvider.isChromeExtension
      ? AuthService.signJWT({
          integrationId: createUpdate.id,
          organizationId: org.id,
          internalId: String(id),
          provider: integration,
        })
      : undefined;

    // Never leak stored credentials (signed/encrypted secrets) back to the
    // caller. These columns hold the integration access token, refresh token
    // and encrypted custom instance details and must stay server-side.
    const {
      token: _token,
      refreshToken: _refreshToken,
      customInstanceDetails: _customInstanceDetails,
      ...safeIntegration
    } = createUpdate as any;

    return {
      ...safeIntegration,
      onboarding: onboarding === 'true',
      pages,
      ...(returnURL ? { returnURL } : {}),
      ...(extensionToken ? { extensionToken } : {}),
    };
  }

  @Post('/public/provider/:id/connect')
  async saveProviderPage(@Param('id') id: string, @Body() body: any) {
    if (!body.state) {
      throw new Error('Invalid state');
    }

    const organization = await ioRedis.get(`organization:${body.state}`);
    if (!organization) {
      throw new Error('Organization not found');
    }

    const org = (await this._organizationService.getOrgById(organization))!;

    return this._integrationService.saveProviderPage(org.id, id, body);
  }

  @Post('/extension-refresh')
  async extensionRefreshCookies(
    @Body() body: { jwt: string; cookies: string }
  ) {
    let payload: any;
    try {
      payload = AuthService.verifyJWT(body.jwt);
    } catch {
      throw new HttpException('Invalid token', 401);
    }

    const { integrationId, organizationId, internalId, provider } = payload;
    if (!integrationId || !organizationId || !internalId || !provider) {
      throw new HttpException('Invalid token payload', 400);
    }

    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    if (!integration || integration.internalId !== internalId) {
      throw new HttpException('Integration not found', 404);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(provider);
    if (!integrationProvider?.isChromeExtension) {
      throw new HttpException('Not a Chrome extension integration', 400);
    }

    const authResult = await integrationProvider.authenticate({
      code: body.cookies,
      codeVerifier: '',
    });

    if (typeof authResult === 'string') {
      throw new HttpException(authResult, 400);
    }

    if (String(authResult.id) !== String(integration.internalId)) {
      await this._integrationService.refreshNeeded(
        organizationId,
        integrationId
      );
      return { success: false, reason: 'account_mismatch' };
    }

    await this._integrationService.createOrUpdateIntegration(
      undefined,
      false,
      organizationId,
      integration.name,
      undefined,
      'social',
      integration.internalId,
      integration.providerIdentifier,
      authResult.accessToken,
      '',
      authResult.expiresIn,
      undefined,
      false,
      undefined,
      undefined,
      // Match the connect path (lines ~295-298): this column holds the
      // encryptSecret() ciphertext, so a signed JWT here would produce a value
      // no decrypt-side consumer can read and would leak the raw cookies.
      AuthService.encryptSecret(Buffer.from(body.cookies, 'base64').toString())
    );

    return { success: true };
  }
}
