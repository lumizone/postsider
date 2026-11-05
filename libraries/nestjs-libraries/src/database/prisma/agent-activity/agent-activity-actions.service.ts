import { BadRequestException, HttpException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import { ApprovalRepository } from '@postsider/nestjs-libraries/database/prisma/approval/approval.repository';
import { assertCanApprove } from '@postsider/nestjs-libraries/database/prisma/approval/approval.rules';
import { PostsService, type RetryFailedResult } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { PostPolicyGateService } from '@postsider/nestjs-libraries/database/prisma/policies/post-policy-gate.service';
import type { BulkApprovalsDto } from '@postsider/nestjs-libraries/dtos/agent-activity/agent-activity-actions.dto';

export type BulkItemResult = {
  approvalId: string;
  postId: string | null;
  status: 'done' | 'skipped' | 'failed';
  reason?: 'already_resolved' | 'not_found' | 'error';
  message?: string;
};

const MESSAGE_CAP = 200;

/**
 * Dashboard actions of the Agent Control Center. Authorization is enforced here
 * (not only by the route guard) so a USER-role member can never touch an approval.
 */
@Injectable()
export class AgentActivityActionsService {
  private readonly _logger = new Logger(AgentActivityActionsService.name);

  constructor(
    private _approval: ApprovalService,
    private _approvalRepo: ApprovalRepository,
    private _posts: PostsService,
    private _policyGate: PostPolicyGateService
  ) {}

  async bulkResolve(
    orgId: string,
    userId: string,
    role: string,
    body: BulkApprovalsDto
  ): Promise<{
    results: BulkItemResult[];
    summary: { done: number; skipped: number; failed: number };
  }> {
    // First, before any lookup: a non-approver touches nothing.
    assertCanApprove(role);
    const results: BulkItemResult[] = [];
    for (const approvalId of body.approvalIds) {
      results.push(await this.resolveOne(orgId, userId, role, approvalId, body));
    }
    const summary = { done: 0, skipped: 0, failed: 0 };
    for (const r of results) summary[r.status] += 1;
    return { results, summary };
  }

  private async resolveOne(
    orgId: string,
    userId: string,
    role: string,
    approvalId: string,
    body: BulkApprovalsDto
  ): Promise<BulkItemResult> {
    let postId: string | null = null;
    try {
      const approval = await this._approvalRepo.getById(orgId, approvalId);
      if (!approval) return { approvalId, postId: null, status: 'skipped', reason: 'not_found' };
      postId = approval.postId ?? null;
      if (body.action === 'approve') {
        await this._approval.approve(orgId, approvalId, userId, role);
      } else {
        await this._approval.reject(orgId, approvalId, userId, role, body.note?.trim() || undefined);
      }
      return { approvalId, postId, status: 'done' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { approvalId, postId, status: 'skipped', reason: 'not_found' };
      }
      if (error instanceof BadRequestException) {
        const message = String(error.message ?? '');
        if (message.includes('already been resolved')) {
          return { approvalId, postId, status: 'skipped', reason: 'already_resolved' };
        }
        return { approvalId, postId, status: 'failed', reason: 'error', message: message.slice(0, MESSAGE_CAP) };
      }
      if (error instanceof HttpException) {
        return {
          approvalId,
          postId,
          status: 'failed',
          reason: 'error',
          message: String(error.message ?? '').slice(0, MESSAGE_CAP),
        };
      }
      this._logger.error(`Bulk approval ${approvalId} failed: ${error instanceof Error ? error.message : String(error)}`);
      return { approvalId, postId, status: 'failed', reason: 'error', message: 'Unexpected error' };
    }
  }

  /**
   * Mirrors the Phase 3 public retry-failed handler: the policy gate runs first
   * (BLOCK -> 422, oversized input -> 400, both before any row is touched), then
   * the retry runs with the gate's sets. An unknown_outcome row is only re-armed
   * when includeUnknownOutcome is true.
   */
  async retryFailed(
    orgId: string,
    role: string,
    group: string,
    opts: { includeUnknownOutcome: boolean }
  ): Promise<{ group: string; results: RetryFailedResult[]; policy: unknown }> {
    // Own role check: the route guard grants everything when billing is off.
    assertCanApprove(role);
    const includeUnknownOutcome = opts.includeUnknownOutcome === true;
    const gated = await this._policyGate.gateRetry(orgId, group, { includeUnknownOutcome });
    const result = await this._posts.retryFailedByGroup(orgId, group, {
      includeUnknownOutcome,
      approvalPostIds: gated.approvalPostIds,
      evaluatedPostIds: gated.evaluatedPostIds,
      routeToApproval: async (postId: string) =>
        gated.approvalPostIds.has(postId) ? this._policyGate.routeRetry(orgId, postId) : false,
    });
    return {
      ...result,
      policy: { effect: gated.policy.effect, matched: gated.policy.matched },
    };
  }
}
