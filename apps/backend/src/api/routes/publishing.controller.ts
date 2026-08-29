import {
  Body,
  Controller,
  Get,
  HttpException,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';

@ApiTags('Publishing')
@Controller('/publishing')
export class PublishingController {
  constructor(private _postsService: PostsService) {}

  // Pause/resume are owner-only: only the org's SUPERADMIN can flip the kill
  // switch. Plain ADMIN/team members may READ the state but not touch it.
  // `Sections.ADMIN` via @CheckPolicies treats ADMIN and SUPERADMIN as
  // equivalent, so this is a manual role check (same pattern as
  // billing.controller's assertOwner).
  private assertOwner(org: Organization) {
    // @ts-ignore — role is attached to org.users[0] by the auth middleware.
    if (org.users?.[0]?.role !== 'SUPERADMIN') {
      throw new HttpException(
        'Only the account owner can manage publishing',
        403
      );
    }
  }

  @Get('/state')
  async getState(@GetOrgFromRequest() org: Organization) {
    const state = await this._postsService.getPublishingState(org.id);
    return {
      state: state?.publishingState ?? 'ACTIVE',
      pausedAt: state?.publishingPausedAt ?? null,
      pausedBy: state?.publishingPausedById ?? null,
      reason: state?.publishingPauseReason ?? null,
    };
  }

  @Post('/pause')
  async pause(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: { reason?: string }
  ) {
    this.assertOwner(org);
    const state = await this._postsService.pausePublishing(
      org.id,
      user.id,
      body?.reason
    );
    return {
      state: state?.publishingState ?? 'PAUSED',
      pausedAt: state?.publishingPausedAt ?? null,
      pausedBy: state?.publishingPausedById ?? null,
      reason: state?.publishingPauseReason ?? null,
    };
  }

  @Post('/resume')
  async resume(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { behavior?: 'to_draft' | 'auto_resume' }
  ) {
    this.assertOwner(org);
    const behavior =
      body?.behavior === 'auto_resume' ? 'auto_resume' : 'to_draft';
    const { state, heldPostsProcessed } =
      await this._postsService.resumePublishing(org.id, behavior);
    return {
      state: state?.publishingState ?? 'ACTIVE',
      heldPostsProcessed,
    };
  }
}
