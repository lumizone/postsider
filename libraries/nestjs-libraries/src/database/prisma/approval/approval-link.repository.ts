import { Injectable, Optional } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import type { FlowRules } from './approval-stage.rules';

/**
 * Storage of the email approver link tokens (ApprovalActionToken). Only the
 * SHA-256 of a token is stored or queried; every method that works on a known
 * approval scopes by organization.
 */
@Injectable()
export class ApprovalLinkRepository {
  constructor(
    private _db: PrismaRepository<
      'approvalActionToken' | 'postApproval' | 'approvalFlow' | 'user'
    >,
    @Optional() private _tx?: PrismaTransaction
  ) {}

  /** Mints a token row; any earlier token of the same (approval, stage, user) is dropped. */
  async replaceToken(p: {
    orgId: string;
    approvalId: string;
    stagePosition: number;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    const where = {
      organizationId: p.orgId,
      approvalId: p.approvalId,
      stagePosition: p.stagePosition,
      userId: p.userId,
    };
    const data = { ...where, tokenHash: p.tokenHash, expiresAt: p.expiresAt };
    if (this._tx) {
      await this._tx.model.$transaction(async (tx) => {
        await tx.approvalActionToken.deleteMany({ where });
        await tx.approvalActionToken.create({ data });
      });
      return;
    }
    await this._db.model.approvalActionToken.deleteMany({ where });
    await this._db.model.approvalActionToken.create({ data });
  }

  /** The live (unused, unexpired) token row for a hash; the organization comes from the row. */
  getLiveToken(tokenHash: string, now: Date) {
    return this._db.model.approvalActionToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      select: {
        organizationId: true,
        approvalId: true,
        stagePosition: true,
        userId: true,
        expiresAt: true,
      },
    });
  }

  /** Single use: true only for the one caller that flipped `usedAt`. */
  async consumeToken(tokenHash: string, now: Date): Promise<boolean> {
    const res = await this._db.model.approvalActionToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    return res.count === 1;
  }

  /** A refused decision must not burn the link. */
  async restoreToken(tokenHash: string): Promise<void> {
    await this._db.model.approvalActionToken.updateMany({
      where: { tokenHash },
      data: { usedAt: null },
    });
  }

  async deleteToken(tokenHash: string): Promise<void> {
    await this._db.model.approvalActionToken.deleteMany({ where: { tokenHash } });
  }

  async deleteForApproval(orgId: string, approvalId: string): Promise<void> {
    await this._db.model.approvalActionToken.deleteMany({
      where: { organizationId: orgId, approvalId },
    });
  }

  /** Stage advanced: tokens of every other stage are dead. */
  async deleteOtherStages(
    orgId: string,
    approvalId: string,
    keepPosition: number
  ): Promise<void> {
    await this._db.model.approvalActionToken.deleteMany({
      where: {
        organizationId: orgId,
        approvalId,
        stagePosition: { not: keepPosition },
      },
    });
  }

  async getFlowRules(orgId: string, flowId: string): Promise<FlowRules | null> {
    const flow = await this._db.model.approvalFlow.findFirst({
      where: { id: flowId, organizationId: orgId },
      select: { preventSelfApproval: true, requireDistinctApprovers: true },
    });
    return flow
      ? {
          preventSelfApproval: flow.preventSelfApproval,
          requireDistinctApprovers: flow.requireDistinctApprovers,
        }
      : null;
  }

  async getUserName(userId: string): Promise<string | null> {
    const user = await this._db.model.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return user?.name ?? null;
  }

  /** Everything the review page and the decision checks need; explicit columns only. */
  getReview(orgId: string, approvalId: string) {
    return this._db.model.postApproval.findFirst({
      where: { id: approvalId, organizationId: orgId },
      select: {
        id: true,
        postId: true,
        status: true,
        flowId: true,
        currentStage: true,
        requestedById: true,
        requestedByType: true,
        requestedByUserId: true,
        requestedByApiKeyId: true,
        requestedByOAuthClientId: true,
        requestedBy: { select: { name: true } },
        stages: {
          orderBy: { position: 'asc' },
          select: {
            position: true,
            name: true,
            minRole: true,
            approverUserIds: true,
            allowAutomation: true,
            allowGuest: true,
            status: true,
            decidedByType: true,
            decidedByUserId: true,
            decidedByApiKeyId: true,
            decidedByOAuthClientId: true,
          },
        },
        post: {
          select: {
            content: true,
            image: true,
            publishDate: true,
            integrationId: true,
            createdByType: true,
            createdByUserId: true,
            createdByApiKeyId: true,
            createdByOAuthClientId: true,
            integration: {
              select: { name: true, providerIdentifier: true },
            },
          },
        },
      },
    });
  }
}
