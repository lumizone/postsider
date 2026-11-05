import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { PublicApiScopeGuard } from '@postsider/backend/services/auth/public-api-scope.guard';
import { RequirePublicApiScopes } from '@postsider/backend/services/auth/public-api-scope.decorator';
import { ApprovalFlowService } from '@postsider/nestjs-libraries/database/prisma/approval/approval-flow.service';
import {
  CreateApprovalFlowDto,
  UpdateApprovalFlowDto,
  pickApprovalFlowFields,
} from '@postsider/nestjs-libraries/dtos/approval/approval-flow.dto';

@ApiTags('Public API Approval flows')
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Raw PostSider API key or Bearer OAuth access token',
})
@Controller('/public/v1')
@UseGuards(PublicApiScopeGuard)
export class PublicApprovalFlowsController {
  constructor(private _flows: ApprovalFlowService) {}

  @Get('/approval-flows')
  @RequirePublicApiScopes('policies:read')
  @ApiOperation({
    summary: 'List approval flows',
    description:
      'Flows of the organization with their stages ordered by position. Requires the policies:read scope, which is never granted implicitly.',
  })
  @ApiOkResponse({ description: 'flows: the live approval flows' })
  async list(@GetOrgFromRequest() org: Organization) {
    return { flows: await this._flows.list(org.id) };
  }

  @Get('/approval-flows/:id')
  @RequirePublicApiScopes('policies:read')
  @ApiOperation({
    summary: 'Get an approval flow',
    description: 'Requires the policies:read scope, which is never granted implicitly.',
  })
  @ApiOkResponse({ description: 'The flow with its ordered stages' })
  @ApiNotFoundResponse({ description: 'Unknown flow id for this organization' })
  async get(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._flows.get(org.id, id);
  }

  @Post('/approval-flows')
  @RequirePublicApiScopes('policies:write')
  @ApiOperation({
    summary: 'Create an approval flow',
    description:
      'A flow has 1 to 5 stages, decided in array order. An organization can have at most 20 flows. Every approverUserIds entry must be a member of the organization. Requires the policies:write scope, which is never granted implicitly. Do not give policies:write to a key that also publishes: who approves is governance.',
  })
  @ApiCreatedResponse({ description: 'The created flow' })
  @ApiBadRequestResponse({
    description: 'Invalid flow, or error approval_flow_invalid or approval_flow_limit_reached',
  })
  async create(@GetOrgFromRequest() org: Organization, @Body() body: CreateApprovalFlowDto) {
    return this._flows.create(org.id, pickApprovalFlowFields(body));
  }

  @Put('/approval-flows/:id')
  @RequirePublicApiScopes('policies:write')
  @ApiOperation({
    summary: 'Update an approval flow',
    description:
      'Send only the fields to change. A supplied stages array replaces the whole list. Approvals already in progress keep the stages they started with. Requires the policies:write scope.',
  })
  @ApiOkResponse({ description: 'The updated flow' })
  @ApiNotFoundResponse({ description: 'Unknown flow id for this organization' })
  @ApiBadRequestResponse({ description: 'Invalid flow, or error approval_flow_invalid' })
  async update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdateApprovalFlowDto
  ) {
    return this._flows.update(org.id, id, pickApprovalFlowFields(body));
  }

  @Delete('/approval-flows/:id')
  @RequirePublicApiScopes('policies:write')
  @ApiOperation({
    summary: 'Archive an approval flow',
    description:
      'Soft delete. Answers 409 flow_in_use while an enabled policy rule still references the flow. Requires the policies:write scope.',
  })
  @ApiOkResponse({ description: '{ id, archived: true }' })
  @ApiNotFoundResponse({ description: 'Unknown flow id for this organization' })
  @ApiConflictResponse({ description: 'error flow_in_use' })
  async remove(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._flows.archive(org.id, id);
  }
}
