import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';
import { RequirePublicApiScopes } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { AuditEventsService } from '@postsider/nestjs-libraries/database/prisma/audit/audit-events.service';
import {
  ListAuditEventsDto,
  resolveAuditPaging,
} from '@postsider/nestjs-libraries/dtos/audit/list-audit-events.dto';
import { PublicAuditEventsResponseDto } from '@postsider/nestjs-libraries/dtos/audit/public-audit-event.dto';

@ApiTags('Public API')
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Raw PostSider API key or Bearer OAuth access token',
})
@Controller('/public/v1')
@UseGuards(PublicApiScopeGuard)
export class PublicAuditController {
  constructor(private _auditEvents: AuditEventsService) {}

  @Get('/audit-events')
  @RequirePublicApiScopes('audit:read')
  @ApiOperation({
    summary: 'List audit events',
    description:
      'Newest first, cursor paginated. Events: post.created, post.updated, post.deleted, post.status_changed, post.approval_requested, post.approval_resolved, post.published, post.failed, post.retry_requested. Metadata never contains post content. Requires the audit:read scope, which is never granted implicitly.',
  })
  @ApiOkResponse({ type: PublicAuditEventsResponseDto })
  async list(
    @GetOrgFromRequest() org: Organization,
    @Query() query: ListAuditEventsDto
  ) {
    return this._auditEvents.list(org.id, {
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetIds: [query.targetId] } : {}),
      ...resolveAuditPaging(query),
    });
  }
}
