import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  PublicPolicyEvaluationDto,
  PublicPolicyRuleDto,
} from '@postsider/nestjs-libraries/dtos/policies/public-policy.dto';
import { currentActor, currentKeyPermissions } from '@postsider/nestjs-libraries/actor/actor-context';
import { PolicyEvaluationService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-evaluation.service';
import { EvaluatePolicyDto } from '@postsider/nestjs-libraries/dtos/policies/evaluate-policy.dto';
import { checkKeyPermission } from '@postsider/nestjs-libraries/policies/key-permissions';
import { actionForCreateType } from '@postsider/nestjs-libraries/policies/key-permission.guard';
import { policyInputTooLarge, sanitizeMatches } from '@postsider/nestjs-libraries/policies/policy-errors';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';

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
  'approvalFlowId',
] as const;

function pickRuleFields<T extends object>(body: T): T {
  const picked: Record<string, unknown> = {};
  for (const key of RULE_FIELDS) {
    const value = (body as Record<string, unknown>)[key];
    // approvalFlowId null means "clear the flow"; every other field must not be null.
    if (value === null && key !== 'approvalFlowId') {
      throw new BadRequestException({ msg: `${key} must not be null`, field: key });
    }
    if (value !== undefined) picked[key] = value;
  }
  return picked as T;
}

/**
 * The global ValidationPipe does not whitelist, so the dry run body keeps any
 * unknown keys it was sent. Evaluation only ever sees these fields.
 */
function pickEvaluateBody(body: EvaluatePolicyDto) {
  return {
    type: body.type,
    ...(body.date === undefined ? {} : { date: body.date }),
    posts: body.posts.map((p) => ({
      integration: { id: p.integration.id },
      value: p.value.map((v) => ({
        content: v.content,
        ...(v.image === undefined ? {} : { image: v.image.map((i) => ({ path: i.path })) }),
      })),
      ...(p.firstComment === undefined ? {} : { firstComment: p.firstComment }),
    })),
  };
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
    private _audit: AuditLogger,
    private _evaluation: PolicyEvaluationService
  ) {}

  // Registered before the /policies/:id routes. It is a POST, so there is no
  // overlap today, but the order keeps it safe if a POST :id route is added.
  @Post('/policies/evaluate')
  @HttpCode(200)
  @RequirePublicApiScopes('posts:read')
  @ApiOperation({
    summary: 'Dry run the policy rules against a draft body',
    description:
      'Takes the same shape as a post create body (type, date, posts) and returns what the rules would decide for the calling credential, plus whether the credential key limits would allow the action (key.code is key_action_not_allowed or key_channel_not_allowed). Writes nothing: no post, approval, audit entry or idempotency record. Requires posts:read, not policies:read, so any credential that can read posts can probe the rule settings through it. Send the literal path /public/v1/policies/evaluate: an encoded spelling is not classified as a read and needs posts:write. A draft is reported but never blocked at write time, while a BLOCK rule still stops it at publish time. In this response channels is a list of objects with integrationId and effect, while the 422 policy_blocked body lists channel id strings. A post is evaluated at the moment it will go out, so a past date counts as now. Internal plugs (for example x-repost-post-users) post to other channels without any policy check.',
  })
  @ApiOkResponse({
    type: PublicPolicyEvaluationDto,
    description:
      'effect (ALLOW, REQUIRE_APPROVAL or BLOCK), matched rules, per channel effect, and key: { allowed, code? }',
  })
  @ApiBadRequestResponse({ description: 'Invalid body, or error policy_input_too_large' })
  @ApiNotFoundResponse({ description: 'A channel does not belong to this organization' })
  async evaluate(@GetOrgFromRequest() org: Organization, @Body() body: EvaluatePolicyDto) {
    const draft = pickEvaluateBody(body);
    let outcome;
    try {
      const targets = await this._evaluation.targetsFromDraftBody(org.id, draft, currentActor());
      outcome = await this._evaluation.evaluateTargets(org.id, targets, 'write');
    } catch (error) {
      if (error instanceof PolicyInputTooLargeError) throw policyInputTooLarge();
      throw error;
    }
    const keyCheck = checkKeyPermission(
      currentKeyPermissions(),
      actionForCreateType(draft.type),
      draft.posts.map((p) => p.integration.id)
    );
    return {
      effect: outcome.effect,
      matched: sanitizeMatches(outcome.matched),
      channels: outcome.channels.map((c) => ({ integrationId: c.integrationId, effect: c.effect })),
      key: keyCheck.allowed ? { allowed: true } : { allowed: false, code: keyCheck.code },
    };
  }

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
      'Conditions: ALWAYS, CONTAINS_LINK, CONTAINS_WORDS, OUTSIDE_WINDOW, DAILY_CAP_EXCEEDED, PUBLISH_NOW, HAS_VIDEO. Effects: REQUIRE_APPROVAL, BLOCK. An organization can have at most 50 enabled and 200 stored rules. Requires the policies:write scope, which is never granted implicitly. Do not give policies:write to a key that also publishes: a key that holds it can disable the rules that constrain it, and can add a BLOCK rule with condition ALWAYS that applies to USER and SYSTEM and so stops every post in the workspace at publish time. Every change is recorded as the policy.changed audit event with the key id.',
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
