import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { Request } from 'express';
import { FunnelAttributionService, type FunnelClientStage, type OnboardingChoice } from '@postsider/nestjs-libraries/database/prisma/attribution/funnel-attribution.service';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';

@ApiTags('Analytics')
@Controller('/analytics')
export class AnalyticsController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _funnel: FunnelAttributionService
  ) {}

  @Post('/funnel')
  async recordFunnelStage(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body() body: { event?: FunnelClientStage; onboardingType?: OnboardingChoice }
  ) {
    if (body?.event !== 'onboarding_type_selected') {
      throw new BadRequestException('signup_completed is recorded by the server only');
    }
    if (body.onboardingType !== 'agents' && body.onboardingType !== 'scheduler') {
      throw new BadRequestException('onboardingType must be agents or scheduler');
    }
    return this._funnel.recordClientStage(
      org.id, body.onboardingType!, req.cookies
    );
  }

  @Get('/funnel')
  async getFunnelStage(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request
  ) {
    return this._funnel.getJourney(org.id, req.cookies);
  }

  /** An organization owner can explicitly remove their analytics attribution. */
  @Delete('/funnel')
  async deleteFunnelStage(@GetOrgFromRequest() org: Organization) {
    const membership = (org as Organization & { users?: { role: string }[] }).users?.[0];
    if (membership?.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Only the workspace owner can remove attribution');
    }
    await this._funnel.deleteJourney(org.id);
    return { deleted: true };
  }

  @Get('/:integration')
  async getIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string,
    @Query('refresh') refresh?: string
  ) {
    return this._integrationService.checkAnalytics(org, integration, date, refresh === 'true');
  }

  @Get('/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date', new ParseIntPipe({ optional: true })) date?: number
  ) {
    return this._postsService.checkPostAnalytics(org.id, postId, date ?? 0);
  }
}
