import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { AgentActivityActionsService } from '@postsider/nestjs-libraries/database/prisma/agent-activity/agent-activity-actions.service';
import { BulkApprovalsDto, RetryFailedDto } from '@postsider/nestjs-libraries/dtos/agent-activity/agent-activity-actions.dto';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { AgentActivityService } from '@postsider/nestjs-libraries/database/prisma/agent-activity/agent-activity.service';
import { ListAgentActivityDto } from '@postsider/nestjs-libraries/dtos/agent-activity/list-agent-activity.dto';

// Read-only dashboard routes for the Agent Control Center. Every member of the
// organization may read, so there is no @CheckPolicies here. The organization
// always comes from the session, never from the query.
// Declare literal routes (/summary, /filters) before the /groups/:group route.
@ApiTags('Agent activity')
@Controller('/agent-activity')
export class AgentActivityController {
  constructor(
    private _activity: AgentActivityService,
    private _actions: AgentActivityActionsService
  ) {}

  @Get('/summary')
  summary(
    @GetOrgFromRequest() org: Organization,
    @Query('timezone') timezone?: string
  ) {
    return this._activity.summary(org.id, {
      timezone,
      orgDefaultTimezone: (org as any).defaultTimezone,
    });
  }

  @Get('/filters')
  filters(@GetOrgFromRequest() org: Organization) {
    return this._activity.filters(org.id);
  }

  @Get('/')
  list(
    @GetOrgFromRequest() org: Organization,
    @Query() query: ListAgentActivityDto
  ) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    // IsISO8601 also accepts week and ordinal forms that Date cannot parse
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new BadRequestException('Invalid date');
    }
    return this._activity.list(org.id, {
      bucket: query.bucket ?? 'attention',
      scope: query.scope ?? 'relevant',
      integrationIds: query.integrationIds,
      actor: query.actor,
      agentName: query.agentName,
      source: query.source,
      from,
      to,
      limit: query.limit ?? 25,
      cursor: query.cursor,
    });
  }

  @Get('/groups/:group')
  detail(@GetOrgFromRequest() org: Organization, @Param('group') group: string) {
    return this._activity.detail(org.id, group);
  }

  // Writes: admin/approver only. The service re-checks the role (403, nothing
  // touched) so a direct call by a USER-role member cannot resolve approvals.
  @Post('/approvals/bulk')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  bulkApprovals(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: BulkApprovalsDto
  ) {
    return this._actions.bulkResolve(
      org.id,
      user.id,
      (org as any).users?.[0]?.role ?? 'USER',
      body
    );
  }

  @Post('/groups/:group/retry-failed')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  retryFailed(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string,
    @Body() body: RetryFailedDto
  ) {
    return this._actions.retryFailed(org.id, (org as any).users?.[0]?.role ?? 'USER', group, {
      includeUnknownOutcome: body?.includeUnknownOutcome === true,
    });
  }
}
