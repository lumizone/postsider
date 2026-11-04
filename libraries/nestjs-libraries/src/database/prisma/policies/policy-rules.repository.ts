import { Injectable } from '@nestjs/common';
import { Prisma, PolicyRule } from '@prisma/client';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

const ORDER = [{ priority: 'asc' as const }, { createdAt: 'asc' as const }];

@Injectable()
export class PolicyRulesRepository {
  constructor(private _rule: PrismaRepository<'policyRule'>) {}

  listForOrg(orgId: string): Promise<PolicyRule[]> {
    return this._rule.model.policyRule.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: ORDER,
    });
  }

  listEnabled(orgId: string): Promise<PolicyRule[]> {
    return this._rule.model.policyRule.findMany({
      where: { organizationId: orgId, enabled: true, deletedAt: null },
      orderBy: ORDER,
    });
  }

  getById(orgId: string, id: string): Promise<PolicyRule | null> {
    return this._rule.model.policyRule.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  create(
    orgId: string,
    data: Omit<Prisma.PolicyRuleUncheckedCreateInput, 'organizationId'>
  ): Promise<PolicyRule> {
    return this._rule.model.policyRule.create({
      data: { ...data, organizationId: orgId },
    });
  }

  async update(
    orgId: string,
    id: string,
    data: Prisma.PolicyRuleUncheckedUpdateManyInput
  ): Promise<PolicyRule | null> {
    const res = await this._rule.model.policyRule.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data,
    });
    if (res.count === 0) return null;
    return this.getById(orgId, id);
  }

  async softDelete(orgId: string, id: string): Promise<boolean> {
    const res = await this._rule.model.policyRule.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date(), enabled: false },
    });
    return res.count > 0;
  }

  countEnabled(orgId: string): Promise<number> {
    return this._rule.model.policyRule.count({
      where: { organizationId: orgId, enabled: true, deletedAt: null },
    });
  }

  countNonDeleted(orgId: string): Promise<number> {
    return this._rule.model.policyRule.count({
      where: { organizationId: orgId, deletedAt: null },
    });
  }
}
