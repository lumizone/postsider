import { Injectable } from '@nestjs/common';
import type { PostActor } from '@postsider/nestjs-libraries/actor/post-actor';
import {
  PolicyBlockedException,
  policyInputTooLarge,
} from '@postsider/nestjs-libraries/policies/policy-errors';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';
import type { PolicyMatch } from '@postsider/nestjs-libraries/policies/policy-types';
import { sanitizeMatches } from '@postsider/nestjs-libraries/policies/policy-errors';
import { PolicyApprovalRouter } from './policy-approval-router';
import {
  PolicyEvaluationService,
  type PolicyOutcome,
  type PolicyTarget,
} from './policy-evaluation.service';

type CreateBodyLike = Parameters<PolicyEvaluationService['targetsFromDraftBody']>[1];
type Effect = PolicyOutcome['effect'];
type Pre = { outcome: PolicyOutcome; approvalIntegrationIds: Set<string> };
type PolicyView = { effect: string; matched: PolicyMatch[] };

const EMPTY_OUTCOME = (): PolicyOutcome => ({ effect: 'ALLOW', matched: [], channels: [] });

const RANK: Record<Effect, number> = { ALLOW: 0, REQUIRE_APPROVAL: 1, BLOCK: 2 };

const actorKey = (a: PolicyTarget['actors'][number]) =>
  [a.type, a.userId, a.apiKeyId, a.oauthClientId].join('|');

/** Fail closed: content that cannot be evaluated is rejected, never allowed. */
const failClosed = (error: unknown): never => {
  if (error instanceof PolicyInputTooLargeError) throw policyInputTooLarge();
  throw error;
};

/**
 * Write-time policy gate for the public API create, edit and status routes.
 * Drafts are report only (ruling P3-R1): BLOCK never rejects them and nothing
 * is routed, because the publish-time guard still enforces the rule.
 */
@Injectable()
export class PostPolicyGateService {
  constructor(
    private _evaluation: PolicyEvaluationService,
    private _router: PolicyApprovalRouter
  ) {}

  async preflightWrite(
    orgId: string,
    body: CreateBodyLike,
    actor: PostActor,
    opts: { editingPostId?: string } = {}
  ): Promise<Pre> {
    let outcome: PolicyOutcome;
    try {
      const targets = await this._evaluation.targetsFromDraftBody(orgId, body, actor);
      if (opts.editingPostId) await this.markAsEdit(orgId, opts.editingPostId, targets);
      outcome = await this._evaluation.evaluateTargets(orgId, targets, 'write');
    } catch (error) {
      // Drafts are report only: a failing evaluation skips the report and
      // never blocks saving. Scheduling and publishing fail closed.
      if (body.type === 'draft') {
        return { outcome: EMPTY_OUTCOME(), approvalIntegrationIds: new Set<string>() };
      }
      return failClosed(error);
    }

    const approvalIntegrationIds = new Set<string>();
    if (body.type === 'draft') {
      if (outcome.effect !== 'ALLOW') await this._evaluation.recordOutcome(orgId, outcome, 'write', {});
      return { outcome, approvalIntegrationIds };
    }

    if (outcome.effect === 'BLOCK') {
      await this._evaluation.recordOutcome(orgId, outcome, 'write', {});
      throw new PolicyBlockedException(outcome);
    }
    for (const c of outcome.channels) {
      if (c.effect === 'REQUIRE_APPROVAL') approvalIntegrationIds.add(c.integrationId);
    }
    return { outcome, approvalIntegrationIds };
  }

  /**
   * Routes the created posts of approval channels and decorates every element.
   * `terminateWorkflow` is true on the edit path, where the post may already be
   * armed in QUEUE.
   */
  async finishCreate<T extends { postId: string; integration: string }>(
    orgId: string,
    created: T[],
    pre: Pre,
    opts: { terminateWorkflow?: boolean } = {}
  ): Promise<Array<T & { policy: PolicyView; approvalRequested: boolean }>> {
    const out: Array<T & { policy: PolicyView; approvalRequested: boolean }> = [];
    for (const item of created) {
      const policy = this.viewFor(pre.outcome, item.integration);
      let approvalRequested = false;
      if (pre.approvalIntegrationIds.has(item.integration)) {
        const routed = await this._router.route(orgId, item.postId, {
          terminateWorkflow: !!opts.terminateWorkflow,
        });
        approvalRequested = routed.requested;
        await this._evaluation.recordOutcome(
          orgId,
          {
            effect: 'REQUIRE_APPROVAL',
            matched: policy.matched,
            channels: [
              { integrationId: item.integration, effect: 'REQUIRE_APPROVAL', matched: policy.matched },
            ],
          },
          'write',
          { postId: item.postId }
        );
      }
      out.push({ ...item, policy, approvalRequested });
    }
    return out;
  }

  async gateStatus(
    orgId: string,
    postId: string,
    status: 'draft' | 'schedule'
  ): Promise<{ proceed: boolean; policy: PolicyOutcome; approvalRequested: boolean }> {
    const action = status === 'draft' ? 'DRAFT' : 'SCHEDULE';
    let outcome: PolicyOutcome;
    try {
      const target = await this._evaluation.targetFromStoredPost(orgId, postId, {
        action,
        approved: false,
      });
      if (!target) {
        // The service reports the missing post itself.
        return { proceed: true, policy: EMPTY_OUTCOME(), approvalRequested: false };
      }
      outcome = await this._evaluation.evaluateTargets(orgId, [target], 'write');
    } catch (error) {
      // Disarming (status draft) is never blocked by a policy evaluation failure.
      if (status === 'draft') {
        return { proceed: true, policy: EMPTY_OUTCOME(), approvalRequested: false };
      }
      return failClosed(error);
    }
    const exposed = (): PolicyOutcome => ({
      ...outcome,
      matched: sanitizeMatches(outcome.matched),
      channels: outcome.channels.map((c) => ({ ...c, matched: sanitizeMatches(c.matched) })),
    });

    if (status === 'draft' || outcome.effect === 'ALLOW') {
      if (outcome.effect !== 'ALLOW' && status === 'draft') {
        await this._evaluation.recordOutcome(orgId, outcome, 'write', { postId });
      }
      return { proceed: true, policy: exposed(), approvalRequested: false };
    }
    if (outcome.effect === 'BLOCK') {
      await this._evaluation.recordOutcome(orgId, outcome, 'write', { postId });
      throw new PolicyBlockedException(outcome);
    }
    const routed = await this._router.route(orgId, postId, { terminateWorkflow: true });
    await this._evaluation.recordOutcome(orgId, outcome, 'write', { postId });
    return { proceed: false, policy: exposed(), approvalRequested: routed.requested };
  }

  /**
   * An edit must not count the post toward its own daily cap, and the original
   * author still counts as an actor, so an automation post edited by a human
   * keeps its rules.
   */
  private async markAsEdit(orgId: string, postId: string, targets: PolicyTarget[]) {
    const stored = await this._evaluation.targetFromStoredPost(orgId, postId, {
      action: targets[0]?.action ?? 'SCHEDULE',
      approved: false,
    });
    for (const t of targets) {
      t.excludePostId = postId;
      for (const a of stored?.actors ?? []) {
        if (!t.actors.some((x) => actorKey(x) === actorKey(a))) t.actors.push(a);
      }
    }
  }

  /** Worst effect and the union of matches for the channel of one created post. */
  private viewFor(outcome: PolicyOutcome, integrationId: string): PolicyView {
    let effect: Effect = 'ALLOW';
    const matched: PolicyMatch[] = [];
    for (const c of outcome.channels) {
      if (c.integrationId !== integrationId) continue;
      if (RANK[c.effect] > RANK[effect]) effect = c.effect;
      for (const m of c.matched) if (!matched.some((x) => x.ruleId === m.ruleId)) matched.push(m);
    }
    return { effect, matched: sanitizeMatches(matched) };
  }
}
