import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@postsider/nestjs-libraries/user/user.from.request';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { PolicyRulesService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-rules.service';
import { PolicyEvaluationService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-evaluation.service';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import {
  CreatePolicyRuleDto,
  UpdatePolicyRuleDto,
} from '@postsider/nestjs-libraries/dtos/policies/policy-rule.dto';
import { DashboardEvaluatePolicyDto } from '@postsider/nestjs-libraries/dtos/policies/dashboard-evaluate-policy.dto';
import { EvaluatePolicyDto } from '@postsider/nestjs-libraries/dtos/policies/evaluate-policy.dto';
import { checkKeyPermission, type KeyPermissions } from '@postsider/nestjs-libraries/policies/key-permissions';
import { actionForCreateType } from '@postsider/nestjs-libraries/policies/key-permission.guard';
import { policyInputTooLarge, sanitizeMatches, sanitizePolicyName } from '@postsider/nestjs-libraries/policies/policy-errors';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';
import { actorFromUser, type PostActor } from '@postsider/nestjs-libraries/actor/post-actor';

// The global ValidationPipe does not whitelist, so unknown body fields
// (organizationId, id, deletedAt, ...) survive validation. Only these are
// ever handed to the service. Same list as the public policies controller.
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

/** The dry run only ever sees these fields of the body (no asActor, no unknown keys). */
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

/**
 * @CheckPolicies grants everything when billing is off and answers 402 for a
 * USER when it is on, so the role is also checked here, before any read or write.
 */
function assertCanManagePolicies(org: Organization): void {
  const role = (org as any).users?.[0]?.role ?? 'USER';
  if (role !== 'ADMIN' && role !== 'SUPERADMIN') {
    throw new ForbiddenException('Only admins can manage policy rules');
  }
}

type AuditOp = 'policy.create' | 'policy.update' | 'policy.delete';

/**
 * Same two entries as the public controller: the hashed security entry and the
 * readable policy.changed resource entry. Names and flags only, never
 * conditionParams values. The actor is the dashboard user, passed explicitly for
 * clarity (the auth middleware also sets it in the async actor context). Best effort.
 */
async function auditPolicyChange(
  audit: AuditLogger,
  op: AuditOp,
  orgId: string,
  user: User,
  rule: { id: string; name: string; enabled?: boolean; effect?: string },
  changed?: string[]
) {
  try {
    await audit.logSecurityEvent(orgId, op, user.id, { ruleId: rule.id, name: rule.name });
  } catch {
    // never fails the request
  }
  try {
    await audit.logResourceEvent({
      organizationId: orgId,
      event: 'policy.changed',
      targetType: 'organization',
      targetId: orgId,
      actor: actorFromUser(user),
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

/**
 * Rules as returned to the dashboard. `name` stays raw for the admin edit form
 * only; `displayName` is the cleaned name (controls, bidi and zero-width
 * characters stripped, bounded). The frontend MUST render displayName in lists
 * and tooltips and put the raw name only in the edit input value.
 */
function withDisplayName<T extends { name: string }>(rule: T): T & { displayName: string } {
  return { ...rule, displayName: sanitizePolicyName(rule.name) };
}

const unknownApiKey = () =>
  new BadRequestException({ error: 'unknown_api_key', msg: 'Unknown API key for this organization.' });

// Dashboard policy management (Settings > Policies). Admin only. The
// organization always comes from the session, never from the body.
// Declare the literal /evaluate route before any /:id route.
@ApiTags('Policies')
@Controller('/policies')
export class PoliciesController {
  constructor(
    private _rules: PolicyRulesService,
    private _evaluation: PolicyEvaluationService,
    private _audit: AuditLogger,
    private _organizations: OrganizationService
  ) {}

  @Post('/evaluate')
  @HttpCode(200)
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async evaluate(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: DashboardEvaluatePolicyDto
  ) {
    assertCanManagePolicies(org);
    const draft = pickEvaluateBody(body);

    let actor: PostActor = actorFromUser(user);
    let keyPerms: KeyPermissions | null = null;
    const as = body.asActor;
    if (as?.type === 'API_KEY') {
      if (as.apiKeyId) {
        const keys = (await this._organizations.listApiKeys(org.id)) as Array<{
          id: string;
          allowedActions?: KeyPermissions['allowedActions'];
          allowedIntegrationIds?: string[];
        }>;
        const key = keys.find((k) => k.id === as.apiKeyId);
        if (!key) throw unknownApiKey();
        actor = { type: 'API_KEY', apiKeyId: key.id };
        keyPerms = {
          allowedActions: key.allowedActions ?? [],
          allowedIntegrationIds: key.allowedIntegrationIds ?? [],
        };
      } else {
        actor = { type: 'API_KEY', apiKeyId: null };
      }
    } else if (as?.type === 'OAUTH_CLIENT') {
      actor = { type: 'OAUTH_CLIENT', oauthClientId: null };
    } else if (as?.type === 'SYSTEM') {
      actor = { type: 'SYSTEM' };
    }

    let outcome;
    try {
      const targets = await this._evaluation.targetsFromDraftBody(org.id, draft, actor);
      outcome = await this._evaluation.evaluateTargets(org.id, targets, 'write');
    } catch (error) {
      if (error instanceof PolicyInputTooLargeError) throw policyInputTooLarge();
      throw error;
    }
    const keyCheck = checkKeyPermission(
      keyPerms,
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

  @Get('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async list(@GetOrgFromRequest() org: Organization) {
    assertCanManagePolicies(org);
    return { policies: (await this._rules.list(org.id)).map(withDisplayName) };
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async create(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: CreatePolicyRuleDto
  ) {
    assertCanManagePolicies(org);
    const row = await this._rules.create(org.id, pickRuleFields(body));
    await auditPolicyChange(this._audit, 'policy.create', org.id, user, row);
    return withDisplayName(row);
  }

  @Put('/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async update(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: UpdatePolicyRuleDto
  ) {
    assertCanManagePolicies(org);
    const fields = pickRuleFields(body);
    const row = await this._rules.update(org.id, id, fields);
    await auditPolicyChange(this._audit, 'policy.update', org.id, user, row, Object.keys(fields));
    return withDisplayName(row);
  }

  @Delete('/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async remove(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    assertCanManagePolicies(org);
    const existing = await this._rules.get(org.id, id);
    const result = await this._rules.remove(org.id, id);
    await auditPolicyChange(this._audit, 'policy.delete', org.id, user, { ...existing, id });
    return result;
  }
}
