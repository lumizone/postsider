import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@postsider/nestjs-libraries/database/prisma/prisma.service';

const WITH_STAGES = {
  stages: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.ApprovalFlowInclude;

export type FlowWithStages = Prisma.ApprovalFlowGetPayload<{ include: typeof WITH_STAGES }>;

export type FlowStageWrite = {
  position: number;
  name: string;
  minRole: 'ADMIN' | 'SUPERADMIN';
  approverUserIds: string[];
  allowAutomation: boolean;
  allowGuest: boolean;
};

export type FlowCreateData = {
  name: string;
  isDefault: boolean;
  preventSelfApproval: boolean;
  requireDistinctApprovers: boolean;
  stages: FlowStageWrite[];
};

export type FlowUpdateData = Partial<Omit<FlowCreateData, 'stages'>> & {
  stages?: FlowStageWrite[];
};

/** Every query carries organizationId; archived flows (deletedAt set) are never returned. */
@Injectable()
export class ApprovalFlowRepository {
  constructor(
    private _flow: PrismaRepository<'approvalFlow'>,
    private _rule: PrismaRepository<'policyRule'>,
    private _transaction: PrismaTransaction
  ) {}

  listLive(orgId: string): Promise<FlowWithStages[]> {
    return this._flow.model.approvalFlow.findMany({
      where: { organizationId: orgId, deletedAt: null },
      include: WITH_STAGES,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  getLive(orgId: string, id: string): Promise<FlowWithStages | null> {
    return this._flow.model.approvalFlow.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      include: WITH_STAGES,
    });
  }

  getDefault(orgId: string): Promise<FlowWithStages | null> {
    return this._flow.model.approvalFlow.findFirst({
      where: { organizationId: orgId, deletedAt: null, isDefault: true },
      include: WITH_STAGES,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
  }

  countLive(orgId: string): Promise<number> {
    return this._flow.model.approvalFlow.count({
      where: { organizationId: orgId, deletedAt: null },
    });
  }

  create(orgId: string, data: FlowCreateData): Promise<FlowWithStages> {
    return this._transaction.model.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.approvalFlow.updateMany({
          where: { organizationId: orgId, deletedAt: null, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.approvalFlow.create({
        data: {
          organizationId: orgId,
          name: data.name,
          isDefault: data.isDefault,
          preventSelfApproval: data.preventSelfApproval,
          requireDistinctApprovers: data.requireDistinctApprovers,
          stages: { create: data.stages },
        },
        include: WITH_STAGES,
      });
    });
  }

  /** Returns null when the flow is not live in this organization. A supplied stages list replaces the old one. */
  update(orgId: string, id: string, data: FlowUpdateData): Promise<FlowWithStages | null> {
    const { stages, ...fields } = data;
    return this._transaction.model.$transaction(async (tx) => {
      if (fields.isDefault === true) {
        await tx.approvalFlow.updateMany({
          where: { organizationId: orgId, deletedAt: null, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      // updateMany with an empty data object matches nothing useful, so a stages-only
      // update still touches updatedAt explicitly.
      const res = await tx.approvalFlow.updateMany({
        where: { id, organizationId: orgId, deletedAt: null },
        data: { ...fields, updatedAt: new Date() },
      });
      if (res.count === 0) return null;
      if (stages) {
        await tx.approvalFlowStage.deleteMany({ where: { flowId: id } });
        await tx.approvalFlowStage.createMany({
          data: stages.map((s) => ({ ...s, flowId: id })),
        });
      }
      return tx.approvalFlow.findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
        include: WITH_STAGES,
      });
    });
  }

  async archive(orgId: string, id: string): Promise<boolean> {
    const res = await this._flow.model.approvalFlow.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date(), isDefault: false },
    });
    return res.count > 0;
  }

  async hasEnabledRuleReference(orgId: string, flowId: string): Promise<boolean> {
    const count = await this._rule.model.policyRule.count({
      where: { organizationId: orgId, approvalFlowId: flowId, enabled: true, deletedAt: null },
    });
    return count > 0;
  }

  /** Rules (of this organization, not deleted) that point to a live flow of this organization. */
  findRuleFlowIds(
    orgId: string,
    ruleIds: string[]
  ): Promise<Array<{ id: string; approvalFlowId: string | null }>> {
    return this._rule.model.policyRule.findMany({
      where: {
        id: { in: ruleIds },
        organizationId: orgId,
        deletedAt: null,
        approvalFlowId: { not: null },
        approvalFlow: { is: { organizationId: orgId, deletedAt: null } },
      },
      select: { id: true, approvalFlowId: true },
    });
  }
}
