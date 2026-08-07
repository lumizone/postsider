import { Body, Controller, Delete, Get, HttpException, Param, Post, Put } from '@nestjs/common';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { AddTeamMemberDto } from '@postsider/nestjs-libraries/dtos/settings/add.team.member.dto';
import { ShortlinkPreferenceDto } from '@postsider/nestjs-libraries/dtos/settings/shortlink-preference.dto';
import { UpdateOrganizationDto } from '@postsider/nestjs-libraries/dtos/settings/update-organization.dto';
import { ApiTags } from '@nestjs/swagger';
import { AuthorizationActions, Sections } from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ProviderCredentialsService } from '@postsider/nestjs-libraries/database/prisma/integrations/provider-credentials.service';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostCheckerService } from '@postsider/nestjs-libraries/post-checker/post-checker.service';
import { SaveCheckerConfigDto } from '@postsider/nestjs-libraries/dtos/post-checker/save.checker.config.dto';
import { isPlatformAiEnabled } from '@postsider/nestjs-libraries/services/ai.flag';
import { PolarService } from '@postsider/nestjs-libraries/services/polar.service';

@ApiTags('Settings')
@Controller('/settings')
export class SettingsController {
  constructor(
    private _organizationService: OrganizationService,
    private _providerCredentialsService: ProviderCredentialsService,
    private _integrationService: IntegrationService,
    private _postChecker: PostCheckerService,
    private _polarService: PolarService,
  ) {}

  @Get('/post-checker')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getCheckerConfig(@GetOrgFromRequest() org: Organization) {
    return (await this._postChecker.getConfig(org.id)) ?? { provider: null, model: null };
  }

  @Post('/post-checker')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async saveCheckerConfig(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveCheckerConfigDto,
  ) {
    // Cloud uses the platform key — storing a BYO key here is meaningless.
    if (isPlatformAiEnabled()) {
      return { ignored: true };
    }
    await this._postChecker.saveConfig(org.id, body.provider, body.model, body.apiKey);
    return { success: true };
  }

  @Delete('/post-checker')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async deleteCheckerConfig(@GetOrgFromRequest() org: Organization) {
    await this._postChecker.deleteConfig(org.id);
    return { success: true };
  }

  // Listing the team must work on ANY plan (an org admin should always see
  // themselves + existing members); only INVITING is gated behind the paid
  // TEAM_MEMBERS feature (see @Post below). Requiring TEAM_MEMBERS here made the
  // whole Users tab 402 for plans without team seats.
  @Get('/team')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getTeam(@GetOrgFromRequest() org: Organization) {
    return this._organizationService.getTeam(org.id);
  }

  @Post('/team')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.TEAM_MEMBERS],
    [AuthorizationActions.Create, Sections.ADMIN]
  )
  async inviteTeamMember(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AddTeamMemberDto
  ) {
    return this._organizationService.inviteTeamMember(org.id, body);
  }

  @Delete('/team/:id')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.TEAM_MEMBERS],
    [AuthorizationActions.Create, Sections.ADMIN]
  )
  deleteTeamMember(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._organizationService.deleteTeamMember(org, id);
  }

  @Get('/organization')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getOrganizationProfile(@GetOrgFromRequest() org: Organization) {
    return this._organizationService.getOrganizationProfile(org.id);
  }

  @Put('/organization')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async updateOrganizationProfile(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpdateOrganizationDto
  ) {
    return this._organizationService.updateOrganizationProfile(org.id, body);
  }

  @Get('/shortlink')
  async getShortlinkPreference(@GetOrgFromRequest() org: Organization) {
    return this._organizationService.getShortlinkPreference(org.id);
  }

  @Post('/shortlink')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async updateShortlinkPreference(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ShortlinkPreferenceDto
  ) {
    return this._organizationService.updateShortlinkPreference(
      org.id,
      body.shortlink
    );
  }

  /**
   * Change a team member's role. Only SUPERADMIN (Owner) can do this.
   */
  @Put('/team/:id/role')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async changeTeamMemberRole(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') userId: string,
    @Body('role') role: string
  ) {
    // Only SUPERADMIN can change roles.
    // @ts-ignore
    const myRole = org.users?.[0]?.role;
    if (myRole !== 'SUPERADMIN') {
      throw new HttpException('Only the owner can change roles', 403);
    }

    if (role !== 'ADMIN' && role !== 'USER') {
      throw new HttpException('Role must be ADMIN or USER', 400);
    }

    // Cannot change own role or promote to SUPERADMIN from here.
    if (userId === user.id) {
      throw new HttpException('Cannot change your own role', 400);
    }

    return this._organizationService.changeTeamMemberRole(org.id, userId, role);
  }

  /**
   * API Keys — CRUD for multiple named keys per organization.
   */
  @Get('/api-keys')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async listApiKeys(@GetOrgFromRequest() org: Organization) {
    return this._organizationService.listApiKeys(org.id);
  }

  @Post('/api-keys')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async createApiKey(
    @GetOrgFromRequest() org: Organization,
    @Body('name') name: string
  ) {
    if (!name || name.trim().length === 0) {
      throw new HttpException('Name is required', 400);
    }
    return this._organizationService.createApiKey(org.id, name.trim());
  }

  @Put('/api-keys/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async renameApiKey(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('name') name: string
  ) {
    if (!name || name.trim().length === 0) {
      throw new HttpException('Name is required', 400);
    }
    return this._organizationService.renameApiKey(org.id, id, name.trim());
  }

  @Delete('/api-keys/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async deleteApiKey(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._organizationService.deleteApiKey(org.id, id);
  }

  @Get('/storage')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getStorageInfo(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User
  ) {
    // Only lock this down in managed/SaaS mode — org admins shouldn't see the
    // platform's shared infrastructure. In self-hosted mode the operator's own
    // org admins may view it, mirroring the frontend nav gate
    // (NEXT_PUBLIC_SELF_HOSTED), so it no longer 403s (which logged them out).
    // Env vars are strings: only the literal 'true' means self-hosted, otherwise
    // NEXT_PUBLIC_SELF_HOSTED="false" would leak storage config to org admins.
    const selfHosted = process.env.NEXT_PUBLIC_SELF_HOSTED === 'true';
    if (!selfHosted && !user.isSuperAdmin) {
      throw new HttpException('Not available in managed mode', 403);
    }

    const provider = process.env.STORAGE_PROVIDER || 'local';
    const mediaStats = await this._organizationService.getMediaStats(org.id);

    return {
      provider,
      config:
        provider === 'local'
          ? {
              uploadDirectory: process.env.UPLOAD_DIRECTORY || '(not set)',
              publicUrl:
                (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000') +
                '/uploads',
            }
          : {
              bucket: process.env.CLOUDFLARE_BUCKETNAME || '(not set)',
              region: process.env.CLOUDFLARE_REGION || 'auto',
              bucketUrl: process.env.CLOUDFLARE_BUCKET_URL || '(not set)',
              accountId: process.env.CLOUDFLARE_ACCOUNT_ID
                ? process.env.CLOUDFLARE_ACCOUNT_ID.slice(0, 8) + '…'
                : '(not set)',
            },
      stats: mediaStats,
    };
  }

  // --- Provider OAuth Credentials ---

  @Get('/provider-credentials')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async listProviderCredentials(@GetOrgFromRequest() org: Organization) {
    const configured = await this._providerCredentialsService.getAllConfigured(org.id);
    return { providers: configured };
  }

  @Get('/provider-credentials/:provider')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getProviderCredentials(
    @GetOrgFromRequest() org: Organization,
    @Param('provider') provider: string,
  ) {
    const creds = await this._providerCredentialsService.getCredentials(org.id, provider);
    if (!creds) return { configured: false };
    // Return clientId but only a presence flag for the secret — returning a
    // prefix leaks key material (narrowing brute force for short secrets).
    return {
      configured: true,
      clientId: creds.clientId,
      hasClientSecret: !!creds.clientSecret,
      extraData: creds.extraData,
    };
  }

  @Post('/provider-credentials/:provider')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async saveProviderCredentials(
    @GetOrgFromRequest() org: Organization,
    @Param('provider') provider: string,
    @Body() body: { clientId: string; clientSecret: string; extraData?: Record<string, any> },
  ) {
    if (!body.clientId || !body.clientSecret) {
      throw new HttpException('Client ID and Client Secret are required', 400);
    }
    await this._providerCredentialsService.saveCredentials(
      org.id,
      provider,
      body.clientId.trim(),
      body.clientSecret.trim(),
      body.extraData,
    );
    return { success: true };
  }

  @Delete('/provider-credentials/:provider')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async deleteProviderCredentials(
    @GetOrgFromRequest() org: Organization,
    @Param('provider') provider: string,
  ) {
    await this._providerCredentialsService.deleteCredentials(org.id, provider);
    return { success: true };
  }

  /**
   * DANGER ZONE — disconnect every channel for the organization.
   * Irreversible: removes all connected social accounts (and their posts).
   */
  @Post('/disconnect-all-channels')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async disconnectAllChannels(@GetOrgFromRequest() org: Organization) {
    const integrations = await this._integrationService.getIntegrationsList(
      org.id
    );
    // One failing delete must not abort the whole loop and report a partial
    // disconnect as full success (or a mid-way 500).
    const failed: string[] = [];
    for (const integration of integrations) {
      try {
        await this._integrationService.deleteChannel(org.id, integration.id);
      } catch (err) {
        console.error(
          `Failed to disconnect channel ${integration.id}`,
          err
        );
        failed.push(integration.id);
      }
    }
    return {
      disconnected: integrations.length - failed.length,
      ...(failed.length ? { failed } : {}),
    };
  }

  /**
   * DANGER ZONE — permanently delete the organization and the user account.
   * Irreversible.
   */
  @Post('/delete-account')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async deleteAccount(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
  ) {
    // Irreversible: only the owner may delete the org — ADMIN alone must not
    // (mirrors changeTeamMemberRole's SUPERADMIN gate for a far lighter op).
    // @ts-ignore — role is attached to org.users[0] by the auth middleware.
    if (org.users?.[0]?.role !== 'SUPERADMIN') {
      throw new HttpException('Only the owner can delete the account', 403);
    }
    // Cancel the real Polar subscription BEFORE the org's rows are gone —
    // deleteAccount only ever wiped the local Subscription row, so Polar kept
    // billing a customer whose org (and any way to manage or even see the
    // subscription) no longer existed.
    await this._polarService.cancelActiveSubscriptionBestEffort(org.id);
    return this._organizationService.deleteAccount(org.id, user.id);
  }
}
