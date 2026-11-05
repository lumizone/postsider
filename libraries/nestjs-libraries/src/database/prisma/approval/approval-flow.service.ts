import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import {
  ApprovalFlowRepository,
  type FlowStageWrite,
  type FlowUpdateData,
  type FlowWithStages,
} from '@postsider/nestjs-libraries/database/prisma/approval/approval-flow.repository';
import type {
  FlowRules,
  StageDef,
} from '@postsider/nestjs-libraries/database/prisma/approval/approval-stage.rules';
import type {
  ApprovalFlowStageDto,
  CreateApprovalFlowDto,
  UpdateApprovalFlowDto,
} from '@postsider/nestjs-libraries/dtos/approval/approval-flow.dto';

export type { FlowWithStages };

export const MAX_LIVE_FLOWS = 20;

export type PublicApprovalFlow = {
  id: string;
  name: string;
  isDefault: boolean;
  preventSelfApproval: boolean;
  requireDistinctApprovers: boolean;
  createdAt: Date;
  updatedAt: Date;
  stages: StageDef[];
};

export type FlowSnapshot = {
  flowId: string;
  stageCount: number;
  stages: StageDef[];
  rules: FlowRules;
};

const invalid = (msg: string) => new BadRequestException({ error: 'approval_flow_invalid', msg });
const limitReached = () =>
  new BadRequestException({
    error: 'approval_flow_limit_reached',
    msg: 'An organization can have at most 20 approval flows.',
  });
const notFound = () =>
  new NotFoundException({ error: 'approval_flow_not_found', msg: 'Approval flow not found.' });
const inUse = () =>
  new ConflictException({
    error: 'flow_in_use',
    msg: 'An enabled policy rule still uses this approval flow. Disable or change that rule first.',
  });

function toStageDef(s: {
  position: number;
  name: string;
  minRole: string;
  approverUserIds: string[];
  allowAutomation: boolean;
  allowGuest: boolean;
}): StageDef {
  return {
    position: s.position,
    name: s.name,
    minRole: s.minRole === 'SUPERADMIN' ? 'SUPERADMIN' : 'ADMIN',
    approverUserIds: [...s.approverUserIds],
    allowAutomation: s.allowAutomation,
    allowGuest: s.allowGuest,
  };
}

function sortedStages(flow: FlowWithStages): StageDef[] {
  return [...flow.stages].sort((a, b) => a.position - b.position).map(toStageDef);
}

function ordered(flow: FlowWithStages): FlowWithStages {
  return { ...flow, stages: [...flow.stages].sort((a, b) => a.position - b.position) };
}

/** Never exposes organizationId, deletedAt or stage row ids. */
function toPublic(flow: FlowWithStages): PublicApprovalFlow {
  return {
    id: flow.id,
    name: flow.name,
    isDefault: flow.isDefault,
    preventSelfApproval: flow.preventSelfApproval,
    requireDistinctApprovers: flow.requireDistinctApprovers,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
    stages: sortedStages(flow),
  };
}

@Injectable()
export class ApprovalFlowService {
  constructor(
    private _flows: ApprovalFlowRepository,
    private _organizations: OrganizationRepository
  ) {}

  async list(orgId: string): Promise<PublicApprovalFlow[]> {
    return (await this._flows.listLive(orgId)).map(toPublic);
  }

  async get(orgId: string, id: string): Promise<PublicApprovalFlow> {
    return toPublic(await this.mustGet(orgId, id));
  }

  async create(orgId: string, dto: CreateApprovalFlowDto): Promise<PublicApprovalFlow> {
    const stages = await this.prepareStages(orgId, dto.stages);
    // Soft cap: count-then-write is not atomic, so concurrent creates may overshoot slightly.
    if ((await this._flows.countLive(orgId)) >= MAX_LIVE_FLOWS) throw limitReached();
    const row = await this._flows.create(orgId, {
      name: dto.name.trim(),
      isDefault: dto.isDefault ?? false,
      preventSelfApproval: dto.preventSelfApproval ?? true,
      requireDistinctApprovers: dto.requireDistinctApprovers ?? true,
      stages,
    });
    return toPublic(row);
  }

  async update(orgId: string, id: string, dto: UpdateApprovalFlowDto): Promise<PublicApprovalFlow> {
    await this.mustGet(orgId, id);
    const data: FlowUpdateData = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.preventSelfApproval !== undefined) data.preventSelfApproval = dto.preventSelfApproval;
    if (dto.requireDistinctApprovers !== undefined) {
      data.requireDistinctApprovers = dto.requireDistinctApprovers;
    }
    if (dto.stages !== undefined) data.stages = await this.prepareStages(orgId, dto.stages);
    const row = await this._flows.update(orgId, id, data);
    if (!row) throw notFound();
    return toPublic(row);
  }

  async archive(orgId: string, id: string): Promise<{ id: string; archived: true }> {
    await this.mustGet(orgId, id);
    if (await this._flows.hasEnabledRuleReference(orgId, id)) throw inUse();
    if (!(await this._flows.archive(orgId, id))) throw notFound();
    return { id, archived: true };
  }

  async getDefault(orgId: string): Promise<FlowWithStages | null> {
    const flow = await this._flows.getDefault(orgId);
    return flow ? ordered(flow) : null;
  }

  async getById(orgId: string, id: string): Promise<FlowWithStages | null> {
    const flow = await this._flows.getLive(orgId, id);
    return flow ? ordered(flow) : null;
  }

  /**
   * The flow of the first rule id (in the given order) whose rule points to a
   * live flow; otherwise the organization default; otherwise null.
   */
  async resolveFlowForRules(orgId: string, ruleIds: string[]): Promise<FlowWithStages | null> {
    if (ruleIds.length > 0) {
      const rows = await this._flows.findRuleFlowIds(orgId, ruleIds);
      const flowByRule = new Map(rows.map((r) => [r.id, r.approvalFlowId]));
      for (const ruleId of ruleIds) {
        const flowId = flowByRule.get(ruleId);
        if (!flowId) continue;
        const flow = await this._flows.getLive(orgId, flowId);
        if (flow) return ordered(flow);
      }
    }
    return this.getDefault(orgId);
  }

  /** Pure: what an approval stores when it is requested, so later edits never change it. */
  snapshot(flow: FlowWithStages): FlowSnapshot {
    const stages = sortedStages(flow);
    return {
      flowId: flow.id,
      stageCount: stages.length,
      stages,
      rules: {
        preventSelfApproval: flow.preventSelfApproval,
        requireDistinctApprovers: flow.requireDistinctApprovers,
      },
    };
  }

  private async mustGet(orgId: string, id: string): Promise<FlowWithStages> {
    const row = await this._flows.getLive(orgId, id);
    if (!row) throw notFound();
    return row;
  }

  /** Positions come from array order. Every named approver must be a member of the organization. */
  private async prepareStages(
    orgId: string,
    stages: ApprovalFlowStageDto[]
  ): Promise<FlowStageWrite[]> {
    const named = new Set(stages.flatMap((s) => s.approverUserIds ?? []));
    if (named.size > 0) {
      const org = await this._organizations.getAllUsersOrgs(orgId);
      const members = new Set((org?.users ?? []).map((u) => u.user.id));
      for (const userId of named) {
        if (!members.has(userId)) {
          throw invalid('Every approver must be a member of this organization.');
        }
      }
    }
    return stages.map((s, i) => ({
      position: i + 1,
      name: s.name.trim(),
      minRole: s.minRole,
      approverUserIds: [...(s.approverUserIds ?? [])],
      allowAutomation: s.allowAutomation ?? false,
      allowGuest: s.allowGuest ?? false,
    }));
  }
}
