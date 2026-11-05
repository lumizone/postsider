import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
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
  constructor(private _activity: AgentActivityService) {}

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
}
