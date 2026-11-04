import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { PolicyRulesService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-rules.service';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import {
  CreatePolicyRuleDto,
  UpdatePolicyRuleDto,
} from '@postsider/nestjs-libraries/dtos/policies/policy-rule.dto';
import {
  PublicPoliciesResponseDto,
  PublicPolicyDeletedDto,
  PublicPolicyRuleDto,
} from '@postsider/nestjs-libraries/dtos/policies/public-policy.dto';
import { currentActor } from '@postsider/nestjs-libraries/actor/actor-context';

// The global ValidationPipe does not whitelist, so unknown body fields
// (organizationId, id, deletedAt, ...) survive validation. Only these are
// ever handed to the service.
const RULE_FIELDS = [
  'name',
  'enabled',
  'priority',
  'appliesToActorTypes',
  'appliesToApiKeyIds',
  'appliesToIntegrationIds',
  'appliesToProviders',
  'condition',
  'conditionParams',
  'effect',
] as const;

function pickRuleFields<T extends object>(body: T): T {
  const picked: Record<string, unknown> = {};
  for (const key of RULE_FIELDS) {
    const value = (body as Record<string, unknown>)[key];
    if (value === null) {
      throw new BadRequestException({ msg: `${key} must not be null`, field: key });
    }
    if (value !== undefined) picked[key] = value;
  }
  return picked as T;
}

function auditActorUserId(): string | null {
  const actor = currentActor();
  if (actor.type === 'USER') return actor.userId;
  if (actor.type === 'OAUTH_CLIENT') return actor.userId ?? null;
  return null;
}

/**
 * Policy changes leave two entries: the hashed security entry and a readable
 * resource entry (actor and key id recorded) visible in /audit-events. Metadata
 * holds names and flags only, never conditionParams values. Best effort.
 */
async function auditPolicyChange(
  audit: AuditLogger,
  op: 'policy.create' | 'policy.update' | 'policy.delete',
  orgId: string,
  rule: { id: string; name: string; enabled?: boolean; effect?: string },
  changed?: string[]
) {
  try {
    await audit.logSecurityEvent(orgId, op, auditActorUserId(), {
      policyId: rule.id,
      name: rule.name,
    });
  } catch {
    // never fails the request
  }
  try {
    await audit.logResourceEvent({
      organizationId: orgId,
      event: 'policy.changed',
      targetType: 'organization',
      targetId: orgId,
      metadata: {
        operation: op,
        policyId: rule.id,
        name: rule.name,
        ...(rule.enabled === undefined ? {} : { enabled: rule.enabled }),
        ...(rule.effect === undefined ? {} : { effect: rule.effect }),
        ...(changed ? { changed: changed.join(',') } : {}),
      },
    });
  } catch {
    // never fails the request
  }
}

@ApiTags('Public API Policies')
@ApiHeader({
  name: 'Authorization',
  required: true,
  description: 'Raw PostSider API key or Bearer OAuth access token',
})
@Controller('/public/v1')
@UseGuards(PublicApiScopeGuard)
export class PublicPoliciesController {
  constructor(
    private _rules: PolicyRulesService,
    private _audit: AuditLogger
  ) {}

  @Get('/policies')
  @RequirePublicApiScopes('policies:read')
  @ApiOperation({
    summary: 'List policy rules',
    description:
      'Rules of the organization ordered by priority (lower runs first). Requires the policies:read scope, which is never granted implicitly.',
  })
  @ApiOkResponse({ type: PublicPoliciesResponseDto })
  async list(@GetOrgFromRequest() org: Organization) {
    const rows = await this._rules.list(org.id);
    return { policies: rows };
  }

  @Get('/policies/:id')
  @RequirePublicApiScopes('policies:read')
  @ApiOperation({
    summary: 'Get a policy rule',
    description: 'Requires the policies:read scope, which is never granted implicitly.',
  })
  @ApiOkResponse({ type: PublicPolicyRuleDto })
  @ApiNotFoundResponse({ description: 'Unknown rule id for this organization' })
  async get(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._rules.get(org.id, id);
  }

  @Post('/policies')
  @RequirePublicApiScopes('policies:write')
  @ApiOperation({
    summary: 'Create a policy rule',
    description:
      'Conditions: ALWAYS, CONTAINS_LINK, CONTAINS_WORDS, OUTSIDE_WINDOW, DAILY_CAP_EXCEEDED, PUBLISH_NOW, HAS_VIDEO. Effects: REQUIRE_APPROVAL, BLOCK. An organization can have at most 50 enabled and 200 stored rules. Requires the policies:write scope, which is never granted implicitly.',
  })
  @ApiCreatedResponse({ type: PublicPolicyRuleDto })
  @ApiBadRequestResponse({
    description:
      'Invalid rule, or error policy_limit_reached when the organization is at its rule limit',
  })
  async create(@GetOrgFromRequest() org: Organization, @Body() body: CreatePolicyRuleDto) {
    const row = await this._rules.create(org.id, pickRuleFields(body));
    await auditPolicyChange(this._audit, 'policy.create', org.id, row);
    return row;
  }

  @Put('/policies/:id')
  @RequirePublicApiScopes('policies:write')
  @ApiOperation({
    summary: 'Update a policy rule',
    description:
      'Send only the fields to change. Requires the policies:write scope, which is never granted implicitly.',
  })
  @ApiOkResponse({ type: PublicPolicyRuleDto })
  @ApiNotFoundResponse({ description: 'Unknown rule id for this organization' })
  @ApiBadRequestResponse({
    description:
      'Invalid rule, or error policy_limit_reached when enabling would exceed the enabled rule limit',
  })
  async update(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpdatePolicyRuleDto
  ) {
    const fields = pickRuleFields(body);
    const row = await this._rules.update(org.id, id, fields);
    await auditPolicyChange(this._audit, 'policy.update', org.id, row, Object.keys(fields));
    return row;
  }

  @Delete('/policies/:id')
  @RequirePublicApiScopes('policies:write')
  @ApiOperation({
    summary: 'Delete a policy rule',
    description: 'Requires the policies:write scope, which is never granted implicitly.',
  })
  @ApiOkResponse({ type: PublicPolicyDeletedDto })
  @ApiNotFoundResponse({ description: 'Unknown rule id for this organization' })
  async remove(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    const existing = await this._rules.get(org.id, id);
    const result = await this._rules.remove(org.id, id);
    await auditPolicyChange(this._audit, 'policy.delete', org.id, { ...existing, id });
    return result;
  }
}
