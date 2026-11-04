import { Injectable } from '@nestjs/common';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import {
  PublishFailure,
  sanitizeFailureMessage,
} from '@postsider/nestjs-libraries/integrations/publish-error.classifier';
import { sanitizeMatches } from '@postsider/nestjs-libraries/policies/policy-errors';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';
import { PolicyApprovalRouter } from './policy-approval-router';
import {
  PolicyEvaluationService,
  type PolicyOutcome,
} from './policy-evaluation.service';

export type PublishPolicyDecision =
  | { kind: 'allow' }
  | { kind: 'blocked'; failure: PublishFailure }
  | { kind: 'approval_requested' }
  | { kind: 'error'; failure: PublishFailure };

const MAX_MESSAGE_CHARS = 500;
const MAX_NAMES = 5;

const blocked = (message: string): PublishPolicyDecision => ({
  kind: 'blocked',
  failure: {
    category: 'POLICY_BLOCKED',
    retryable: false,
    autoRetry: 'none',
    message: message.slice(0, MAX_MESSAGE_CHARS),
  },
});

/**
 * Last line of defence: evaluates the stored post again right before the
 * provider call (inside the publishPostById activity). It never throws; any
 * failure to evaluate fails closed. It never uses changePostStatus, because
 * that would terminate the workflow that is calling it.
 */
@Injectable()
export class PublishPolicyGuard {
  constructor(
    private _evaluation: PolicyEvaluationService,
    private _router: PolicyApprovalRouter,
    private _approvals: ApprovalService
  ) {}

  async checkBeforePublish(orgId: string, postId: string): Promise<PublishPolicyDecision> {
    try {
      let outcome = await this._evaluate(orgId, postId, false);
      if (!outcome) return this._error('the stored post could not be loaded');

      if (outcome.effect === 'REQUIRE_APPROVAL') {
        const approval = await this._approvals.getForPost(orgId, postId);
        if (approval?.status === 'APPROVED') {
          // An approved post only skips REQUIRE_APPROVAL rules; BLOCK rules still apply.
          outcome = await this._evaluate(orgId, postId, true);
          if (!outcome) return this._error('the stored post could not be loaded');
        }
      }

      if (outcome.effect === 'ALLOW') return { kind: 'allow' };

      await this._record(orgId, postId, outcome);
      if (outcome.effect === 'BLOCK') return this._blockedFor(outcome);

      await this._router.route(orgId, postId, { terminateWorkflow: false });
      return { kind: 'approval_requested' };
    } catch (error) {
      if (error instanceof PolicyInputTooLargeError) {
        return blocked('Blocked by policy: the post is too large to check against the workspace policies.');
      }
      return this._error(error);
    }
  }

  private async _evaluate(
    orgId: string,
    postId: string,
    approved: boolean
  ): Promise<PolicyOutcome | null> {
    const target = await this._evaluation.targetFromStoredPost(orgId, postId, {
      action: 'SCHEDULE',
      approved,
    });
    if (!target) return null;
    return this._evaluation.evaluateTargets(orgId, [target], 'publish');
  }

  /** Audit is best effort and never changes the decision. */
  private async _record(orgId: string, postId: string, outcome: PolicyOutcome) {
    try {
      await this._evaluation.recordOutcome(orgId, outcome, 'publish', { postId });
    } catch {
      // ignored on purpose
    }
  }

  private _blockedFor(outcome: PolicyOutcome): PublishPolicyDecision {
    const names = sanitizeMatches(outcome.matched.filter((m) => m.effect === 'BLOCK'))
      .slice(0, MAX_NAMES)
      .map((m) => m.name)
      .filter(Boolean);
    return blocked(`Blocked by policy: ${names.length ? names.join(', ') : 'a workspace rule'}.`);
  }

  private _error(cause: unknown): PublishPolicyDecision {
    const detail =
      typeof cause === 'string' ? cause : sanitizeFailureMessage((cause as any)?.message, 'internal error');
    return {
      kind: 'error',
      failure: {
        category: 'UNKNOWN',
        retryable: true,
        autoRetry: 'none',
        message: sanitizeFailureMessage(`Policy check could not run: ${detail}`, 'Policy check could not run.'),
      },
    };
  }
}
