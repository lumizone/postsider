import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import {
  RequestApprovalDto,
  ResolveApprovalDto,
} from '@postsider/nestjs-libraries/dtos/approval/approval.dto';

@ApiTags('Approval')
@Controller('/approval')
export class ApprovalController {
  constructor(private _approval: ApprovalService) {}

  // The current user's role in the org is attached to org.users[0] by the auth
  // middleware (see AuthMiddleware -> req.org).
  private roleOf(org: Organization): string {
    return (org as any).users?.[0]?.role ?? 'USER';
  }

  @Post('/request')
  request(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: RequestApprovalDto
  ) {
    return this._approval.requestApproval(org.id, body.postId, user.id);
  }

  @Get('/pending')
  pending(@GetOrgFromRequest() org: Organization) {
    return this._approval.getPending(org.id);
  }

  @Put('/:id/approve')
  approve(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    return this._approval.approve(org.id, id, user.id, this.roleOf(org));
  }

  @Put('/:id/reject')
  reject(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: ResolveApprovalDto
  ) {
    return this._approval.reject(org.id, id, user.id, this.roleOf(org), body.note);
  }

  @Get('/post/:postId')
  forPost(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string
  ) {
    return this._approval.getForPost(org.id, postId);
  }

  // External-reviewer link (e.g. the agency's own client) — ADMIN/SUPERADMIN
  // only, same as approve/reject.
  @Post('/:id/guest-link')
  createGuestLink(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._approval.createGuestLink(org.id, id, this.roleOf(org));
  }

  @Delete('/:id/guest-link')
  revokeGuestLink(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._approval.revokeGuestLink(org.id, id, this.roleOf(org));
  }
}
