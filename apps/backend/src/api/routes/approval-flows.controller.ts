import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { ApprovalFlowService } from '@postsider/nestjs-libraries/database/prisma/approval/approval-flow.service';
import {
  CreateApprovalFlowDto,
  UpdateApprovalFlowDto,
  pickApprovalFlowFields,
} from '@postsider/nestjs-libraries/dtos/approval/approval-flow.dto';

/**
 * @CheckPolicies grants everything when billing is off and answers 402 for a
 * USER when it is on, so the role is also checked here, before any read or write.
 */
function assertCanManageFlows(org: Organization): void {
  const role = (org as any).users?.[0]?.role ?? 'USER';
  if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
    throw new ForbiddenException('Only admins can manage approval flows');
  }
}

// Dashboard approval flow management (Settings > Approval flows). Admin only.
// The organization always comes from the session, never from the body.
@ApiTags('Approval flows')
@Controller('/approval-flows')
export class ApprovalFlowsController {
  constructor(private _flows: ApprovalFlowService) {}

  @Get('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async list(@GetOrgFromRequest() org: Organization) {
    assertCanManageFlows(org);
    return { flows: await this._flows.list(org.id) };
  }

  @Get('/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async get(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    assertCanManageFlows(org);
    return this._flows.get(org.id, id);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async create(@GetOrgFromRequest() org: Organization, @Body() body: CreateApprovalFlowDto) {
    assertCanManageFlows(org);
    return this._flows.create(org.id, pickApprovalFlowFields(body));
  }

  @Put('/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateApprovalFlowDto
  ) {
    assertCanManageFlows(org);
    return this._flows.update(org.id, id, pickApprovalFlowFields(body));
  }

  @Delete('/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async remove(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    assertCanManageFlows(org);
    return this._flows.archive(org.id, id);
  }
}
