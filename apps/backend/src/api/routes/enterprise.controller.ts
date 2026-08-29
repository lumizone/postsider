import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';

@ApiTags('Enterprise')
@Controller('/enterprise')
export class EnterpriseController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _organizationService: OrganizationService,
    private _integrationService: IntegrationService,
    private _postsService: PostsService
  ) {}

  @Post('/create-user')
  async createUser(@Body('params') params: string) {
    try {
      const { id, name, saasName, email } = AuthService.verifyJWT(params) as {
        id: string;
        name: string;
        email: string;
        saasName: string;
      };

      // Require the full reseller payload. These routes are verified with the
      // shared JWT_SECRET, so without this a user's own session token — which
      // carries no saasName — could be replayed to self-provision a privileged
      // (ULTIMATE) org. The sibling routes already fail closed by requiring an
      // apiKey the session token lacks.
      if (!id || !name || !saasName || !email) {
        return { success: false };
      }

      try {
        return await this._organizationService.createMaxUser(
          id,
          name,
          saasName,
          email
        );
      } catch (err) {
        return { create: false };
      }
    } catch (err) {
      return { success: false };
    }
  }

  @Post('/url')
  async redirectParams(@Body('params') params: string) {
    try {
      const load = AuthService.verifyJWT(params) as {
        redirectUrl: string;
        apiKey: string;
        refreshId?: string;
        provider: string;
        webhookUrl: string;
      };

      if (!load || !load.redirectUrl || !load.apiKey || !load.provider) {
        return;
      }

      const org = await this._organizationService.getOrgByApiKey(load.apiKey);

      if (!org) {
        throw new Error('Organization not found');
      }

      if (
        !this._integrationManager
          .getAllowedSocialsIntegrations()
          .includes(load.provider)
      ) {
        throw new Error('Integration not allowed');
      }

      const integrationProvider = this._integrationManager.getSocialIntegration(
        load.provider
      );

      const { codeVerifier, state, url } =
        await integrationProvider.generateAuthUrl();

      if (load.refreshId) {
        await ioRedis.set(`refresh:${state}`, load.refreshId, 'EX', 3600);
      }

      // webhookUrl is optional in the payload but (when present) is later
      // fetch()ed server-side — validate it as an absolute http(s) URL before
      // storing it, and never write `undefined` into Redis (ioredis rejects that
      // and the empty catch would swallow the whole response).
      if (load.webhookUrl) {
        let parsed: URL;
        try {
          parsed = new URL(load.webhookUrl);
        } catch {
          throw new Error('Invalid webhookUrl');
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Invalid webhookUrl');
        }
        await ioRedis.set(`webhookUrl:${state}`, load.webhookUrl, 'EX', 3600);
      }
      await ioRedis.set(`redirect:${state}`, load.redirectUrl, 'EX', 3600);
      await ioRedis.set(`organization:${state}`, org.id, 'EX', 3600);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);

      return url;
    } catch (err) {}
  }

  @Post('/delete-channel')
  async deleteChannel(@Body('params') params: string) {
    try {
      const load = AuthService.verifyJWT(params) as {
        apiKey: string;
        id: string;
      };

      if (!load || !load.apiKey || !load.id) {
        return { success: false };
      }

      const org = await this._organizationService.getOrgByApiKey(load.apiKey);

      if (!org) {
        return { success: false };
      }

      // No post sweep here: `deleteChannel` parks unpublished posts as drafts
      // for every caller. The loop this replaces deleted them outright, and did
      // it fire-and-forget with errors swallowed — so it destroyed content the
      // caller never asked to delete, and lied about having done so.
      await this._integrationService.deleteChannel(org.id, load.id);
      return { success: true };
    } catch (err) {
      return { success: false };
    }
  }
}
