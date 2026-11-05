import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PolicyRule } from '@prisma/client';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { ApprovalFlowService } from '@postsider/nestjs-libraries/database/prisma/approval/approval-flow.service';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { PolicyRulesRepository } from '@postsider/nestjs-libraries/database/prisma/policies/policy-rules.repository';
import {
  CreatePolicyRuleDto,
  UpdatePolicyRuleDto,
} from '@postsider/nestjs-libraries/dtos/policies/policy-rule.dto';
import { validateConditionParams } from '@postsider/nestjs-libraries/policies/policy-params';
import type {
  PolicyConditionName,
  PolicyRuleInput,
} from '@postsider/nestjs-libraries/policies/policy-types';
import type { PostActorType } from '@postsider/nestjs-libraries/actor/post-actor';

export const MAX_ENABLED_RULES = 50;
export const MAX_STORED_RULES = 200;
const DEFAULT_PRIORITY = 100;

export type PublicPolicyRule = Omit<PolicyRule, 'deletedAt' | 'organizationId'>;

const limitReached = () =>
  new BadRequestException({
    error: 'policy_limit_reached',
    msg: 'An organization can have at most 50 enabled and 200 stored policy rules.',
  });

@Injectable()
export class PolicyRulesService {
  constructor(
    private _rules: PolicyRulesRepository,
    private _integrations: IntegrationService,
    private _organizations: OrganizationRepository,
    @Optional() private _flows?: ApprovalFlowService
  ) {}

  async list(orgId: string): Promise<PublicPolicyRule[]> {
    const rows = await this._rules.listForOrg(orgId);
    return rows.map((r) => this.toPublicRule(r));
  }

  async get(orgId: string, id: string): Promise<PublicPolicyRule> {
    return this.toPublicRule(await this.mustGet(orgId, id));
  }

  async create(orgId: string, dto: CreatePolicyRuleDto): Promise<PublicPolicyRule> {
    const appliesToActorTypes = dto.appliesToActorTypes ?? [];
    const appliesToApiKeyIds = dto.appliesToApiKeyIds ?? [];
    const appliesToIntegrationIds = dto.appliesToIntegrationIds ?? [];
    const appliesToProviders = this.normalizeProviders(dto.appliesToProviders ?? []);
    const enabled = dto.enabled ?? true;

    const conditionParams = this.checkParams(dto.condition, dto.conditionParams);
    const approvalFlowId = await this.checkFlow(orgId, dto.effect, dto.approvalFlowId);
    await this.checkFilters(
      orgId,
      { appliesToActorTypes, appliesToApiKeyIds, appliesToIntegrationIds },
      { integrationIds: appliesToIntegrationIds, apiKeyIds: appliesToApiKeyIds }
    );

    // Soft caps: count-then-write is not atomic, so concurrent requests may
    // overshoot by the number of requests in flight. Accepted for admin-only writes.
    if ((await this._rules.countNonDeleted(orgId)) >= MAX_STORED_RULES) throw limitReached();
    if (enabled && (await this._rules.countEnabled(orgId)) >= MAX_ENABLED_RULES) {
      throw limitReached();
    }

    const row = await this._rules.create(orgId, {
      name: dto.name,
      enabled,
      priority: dto.priority ?? DEFAULT_PRIORITY,
      appliesToActorTypes,
      appliesToApiKeyIds,
      appliesToIntegrationIds,
      appliesToProviders,
      condition: dto.condition,
      conditionParams: conditionParams as never,
      effect: dto.effect,
      ...(approvalFlowId ? { approvalFlowId } : {}),
    });
    return this.toPublicRule(row);
  }

  async update(orgId: string, id: string, dto: UpdatePolicyRuleDto): Promise<PublicPolicyRule> {
    const existing = await this.mustGet(orgId, id);
    for (const [key, value] of Object.entries(dto)) {
      // approvalFlowId is the one field where null means "clear".
      if (value === null && key !== 'approvalFlowId') {
        throw new BadRequestException({ msg: `${key} must not be null`, field: key });
      }
    }
    const data: Record<string, unknown> = {};

    for (const key of [
      'name',
      'enabled',
      'priority',
      'appliesToActorTypes',
      'appliesToApiKeyIds',
      'appliesToIntegrationIds',
      'effect',
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    if (dto.appliesToProviders !== undefined) {
      data.appliesToProviders = this.normalizeProviders(dto.appliesToProviders);
    }

    // A flow only belongs to a REQUIRE_APPROVAL rule: a rule moved to BLOCK
    // loses it, and a rule that is switched back on must still point to a live flow.
    const effectiveEffect = dto.effect ?? existing.effect;
    if (dto.approvalFlowId !== undefined) {
      data.approvalFlowId = await this.checkFlow(orgId, effectiveEffect, dto.approvalFlowId);
    } else if (effectiveEffect !== 'REQUIRE_APPROVAL' && existing.approvalFlowId) {
      data.approvalFlowId = null;
    } else if (dto.enabled === true && !existing.enabled && existing.approvalFlowId) {
      await this.checkFlow(orgId, effectiveEffect, existing.approvalFlowId);
    }

    const condition = (dto.condition ?? existing.condition) as PolicyConditionName;
    if (dto.condition !== undefined || dto.conditionParams !== undefined) {
      // A new condition never inherits the old condition's params.
      const rawParams =
        dto.conditionParams !== undefined
          ? dto.conditionParams
          : dto.condition !== undefined && dto.condition !== existing.condition
          ? undefined
          : existing.conditionParams;
      data.condition = condition;
      data.conditionParams = this.checkParams(condition, rawParams);
    }

    // Ownership is only checked for ids this request adds, so a rule that names
    // a since-deleted channel or revoked key can still be edited or disabled.
    const added = (next: string[] | undefined, old: string[]) =>
      (next ?? []).filter((x) => !old.includes(x));
    await this.checkFilters(
      orgId,
      {
        appliesToActorTypes: (dto.appliesToActorTypes ?? existing.appliesToActorTypes) as PostActorType[],
        appliesToApiKeyIds: dto.appliesToApiKeyIds ?? existing.appliesToApiKeyIds,
        appliesToIntegrationIds: dto.appliesToIntegrationIds ?? existing.appliesToIntegrationIds,
      },
      {
        integrationIds: added(dto.appliesToIntegrationIds, existing.appliesToIntegrationIds),
        apiKeyIds: added(dto.appliesToApiKeyIds, existing.appliesToApiKeyIds),
      }
    );

    if (
      dto.enabled === true &&
      !existing.enabled &&
      (await this._rules.countEnabled(orgId)) >= MAX_ENABLED_RULES
    ) {
      throw limitReached();
    }

    const row = await this._rules.update(orgId, id, data as never);
    if (!row) throw new NotFoundException({ msg: 'Policy rule not found' });
    return this.toPublicRule(row);
  }

  async remove(orgId: string, id: string): Promise<{ id: string; deleted: true }> {
    const deleted = await this._rules.softDelete(orgId, id);
    if (!deleted) throw new NotFoundException({ msg: 'Policy rule not found' });
    return { id, deleted: true };
  }

  toRuleInputs(rows: PolicyRule[]): PolicyRuleInput[] {
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      priority: r.priority,
      createdAt: r.createdAt,
      appliesToActorTypes: r.appliesToActorTypes as PostActorType[],
      appliesToApiKeyIds: r.appliesToApiKeyIds,
      appliesToIntegrationIds: r.appliesToIntegrationIds,
      appliesToProviders: r.appliesToProviders,
      condition: r.condition as PolicyConditionName,
      conditionParams: r.conditionParams,
      effect: r.effect as PolicyRuleInput['effect'],
    }));
  }

  toPublicRule(row: PolicyRule): PublicPolicyRule {
    const { deletedAt: _deletedAt, organizationId: _organizationId, ...rest } = row;
    return rest;
  }

  private async mustGet(orgId: string, id: string): Promise<PolicyRule> {
    const row = await this._rules.getById(orgId, id);
    if (!row) throw new NotFoundException({ msg: 'Policy rule not found' });
    return row;
  }

  /**
   * Returns the flow id to store (null clears). A flow is accepted only for a
   * REQUIRE_APPROVAL rule and only when it is a live flow of this organization;
   * an unknown, foreign or archived id answers the same error.
   */
  private async checkFlow(
    orgId: string,
    effect: string,
    flowId: string | null | undefined
  ): Promise<string | null> {
    if (flowId === null || flowId === undefined) return null;
    const invalid = (msg: string) =>
      new BadRequestException({ error: 'approval_flow_invalid', msg, field: 'approvalFlowId' });
    if (effect !== 'REQUIRE_APPROVAL') {
      throw invalid('An approval flow can only be set on a rule whose effect is REQUIRE_APPROVAL.');
    }
    const flow = this._flows ? await this._flows.getById(orgId, flowId) : null;
    if (!flow) throw invalid('Unknown approval flow for this organization.');
    return flowId;
  }

  private normalizeProviders(providers: string[]): string[] {
    return [...new Set(providers.map((p) => p.trim().toLowerCase()).filter((p) => p.length > 0))];
  }

  private checkParams(condition: PolicyConditionName, params: unknown): unknown {
    const result = validateConditionParams(condition, params);
    if (!result.ok) {
      const field =
        result.field === 'conditionParams' ? 'conditionParams' : `conditionParams.${result.field}`;
      throw new BadRequestException({ msg: result.message, field });
    }
    return result.value;
  }

  private async checkFilters(
    orgId: string,
    f: {
      appliesToActorTypes: PostActorType[];
      appliesToApiKeyIds: string[];
      appliesToIntegrationIds: string[];
    },
    toVerify: { integrationIds: string[]; apiKeyIds: string[] }
  ) {
    if (
      f.appliesToApiKeyIds.length > 0 &&
      f.appliesToActorTypes.length > 0 &&
      !f.appliesToActorTypes.includes('API_KEY')
    ) {
      throw new BadRequestException({
        msg: 'appliesToApiKeyIds requires appliesToActorTypes to be empty or include API_KEY',
        field: 'appliesToApiKeyIds',
      });
    }

    if (toVerify.integrationIds.length > 0) {
      const own = new Set((await this._integrations.getIntegrationsList(orgId)).map((i) => i.id));
      const foreign = toVerify.integrationIds.filter((id) => !own.has(id));
      if (foreign.length > 0) {
        throw new BadRequestException({
          msg: `Unknown channel id(s) for this organization: ${foreign.join(', ')}`,
          field: 'appliesToIntegrationIds',
        });
      }
    }

    if (toVerify.apiKeyIds.length > 0) {
      const own = new Set(
        ((await this._organizations.listApiKeys(orgId)) as Array<{ id: string }>).map((k) => k.id)
      );
      const foreign = toVerify.apiKeyIds.filter((id) => !own.has(id));
      if (foreign.length > 0) {
        throw new BadRequestException({
          msg: `Unknown API key id(s) for this organization: ${foreign.join(', ')}`,
          field: 'appliesToApiKeyIds',
        });
      }
    }
  }
}
