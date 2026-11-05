import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  actorToColumns,
  actorViewFromColumns,
  type ActorView,
  type PostActor,
} from '@postsider/nestjs-libraries/actor/post-actor';
import {
  PolicyBlockedException,
  policyInputTooLarge,
} from '@postsider/nestjs-libraries/policies/policy-errors';
import { PolicyInputTooLargeError } from '@postsider/nestjs-libraries/policies/policy-text';
import type { PolicyMatch } from '@postsider/nestjs-libraries/policies/policy-types';
import { sanitizeMatches } from '@postsider/nestjs-libraries/policies/policy-errors';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import { PolicyApprovalRouter } from './policy-approval-router';
import {
  PolicyEvaluationService,
  type PolicyOutcome,
  type PolicyTarget,
} from './policy-evaluation.service';

type CreateBodyLike = Parameters<PolicyEvaluationService['targetsFromDraftBody']>[1];
type Effect = PolicyOutcome['effect'];
type Pre = {
  outcome: PolicyOutcome;
  approvalIntegrationIds: Set<string>;
  /** False when a draft report was skipped because the evaluation failed. */
  evaluated?: boolean;
};
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
    private _router: PolicyApprovalRouter,
    @Optional() private _approvals?: ApprovalService
  ) {}

  async preflightWrite(
    orgId: string,
    body: CreateBodyLike,
    actor: PostActor,
    opts: {
      editingPostId?: string;
      /**
       * Dashboard edits: one entry per `body.posts` element (same order) naming
       * the stored post it replaces, by value id or by thread group.
       */
      editing?: Array<{ postId?: string; group?: string } | undefined>;
    } = {}
  ): Promise<Pre> {
    let outcome: PolicyOutcome;
    try {
      const targets = await this._evaluation.targetsFromDraftBody(orgId, body, actor);
      if (opts.editingPostId) await this.markAsEdit(orgId, opts.editingPostId, targets);
      else if (opts.editing) {
        for (let i = 0; i < targets.length; i++) {
          const ref = opts.editing[i];
          if (!ref) continue;
          const postId = ref.postId ?? (await this.rootOfGroup(orgId, ref.group, targets[i].integrationId));
          if (postId) await this.markAsEdit(orgId, postId, [targets[i]]);
        }
      }
      outcome = await this._evaluation.evaluateTargets(orgId, targets, 'write');
    } catch (error) {
      // Drafts are report only: a failing evaluation skips the report and
      // never blocks saving. Scheduling and publishing fail closed.
      if (body.type === 'draft') {
        return { outcome: EMPTY_OUTCOME(), approvalIntegrationIds: new Set<string>(), evaluated: false };
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
   * `terminateWorkflow` asks the router to stop an already armed workflow. When a
   * draft report could not be evaluated, `policy` is omitted rather than ALLOW.
   */
  async finishCreate<T extends { postId: string; integration: string }>(
    orgId: string,
    created: T[],
    pre: Pre,
    opts: { terminateWorkflow?: boolean } = {}
  ): Promise<Array<T & { policy?: PolicyView; approvalRequested: boolean }>> {
    const out: Array<T & { policy?: PolicyView; approvalRequested: boolean }> = [];
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
      out.push(
        pre.evaluated === false
          ? { ...item, approvalRequested }
          : { ...item, policy, approvalRequested }
      );
    }
    return out;
  }

  async gateStatus(
    orgId: string,
    postId: string,
    status: 'draft' | 'schedule'
  ): Promise<{
    proceed: boolean;
    policy: PolicyOutcome;
    approvalRequested: boolean;
    /** False when a draft status report was skipped because the evaluation failed. */
    evaluated?: boolean;
  }> {
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
        return { proceed: true, policy: EMPTY_OUTCOME(), approvalRequested: false, evaluated: false };
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
   * Retry re-arms failed rows, so it is a schedule. Only rows the retry would
   * really re-arm are evaluated. Any BLOCK refuses the whole call before a row
   * is touched, which also stops a POLICY_BLOCKED row from being retried while
   * its rule still matches. Rows of channels that need approval are returned.
   */
  async gateRetry(
    orgId: string,
    group: string,
    opts: { includeUnknownOutcome: boolean }
  ): Promise<{
    policy: PolicyOutcome;
    approvalPostIds: Set<string>;
    evaluatedPostIds: Set<string>;
  }> {
    const approvalPostIds = new Set<string>();
    const evaluatedPostIds = new Set<string>();
    let outcome: PolicyOutcome;
    let candidates: Array<{ id: string; integrationId: string }>;
    try {
      const rows = await this._evaluation.topLevelRowsOfGroup(orgId, group);
      candidates = rows.filter(
        (r) =>
          r.state === 'ERROR' &&
          !(r.errorCategory === 'UNKNOWN_OUTCOME' && !opts.includeUnknownOutcome) &&
          !(r.releaseId && r.releaseId !== 'missing')
      );
      const targets: PolicyTarget[] = [];
      for (const row of candidates) {
        const target = await this._evaluation.targetFromStoredPost(orgId, row.id, {
          action: 'SCHEDULE',
          approved: false,
        });
        if (target) {
          targets.push(target);
          evaluatedPostIds.add(row.id);
        }
      }
      if (!targets.length) return { policy: EMPTY_OUTCOME(), approvalPostIds, evaluatedPostIds };
      outcome = await this._evaluation.evaluateTargets(orgId, targets, 'write');
    } catch (error) {
      // Retry re-arms publishing: an evaluation failure fails closed.
      return failClosed(error);
    }

    if (outcome.effect === 'BLOCK') {
      await this._evaluation.recordOutcome(orgId, outcome, 'write', {});
      throw new PolicyBlockedException(outcome);
    }
    const approvalChannels = new Set(
      outcome.channels.filter((c) => c.effect === 'REQUIRE_APPROVAL').map((c) => c.integrationId)
    );
    for (const row of candidates) {
      if (evaluatedPostIds.has(row.id) && approvalChannels.has(row.integrationId)) {
        approvalPostIds.add(row.id);
      }
    }
    if (outcome.effect !== 'ALLOW') await this._evaluation.recordOutcome(orgId, outcome, 'write', {});
    return {
      policy: {
        ...outcome,
        matched: sanitizeMatches(outcome.matched),
        channels: outcome.channels.map((c) => ({ ...c, matched: sanitizeMatches(c.matched) })),
      },
      approvalPostIds,
      evaluatedPostIds,
    };
  }

  /**
   * A dashboard drag to a new date: evaluated like a schedule against the NEW
   * date (max of that date and now). A post whose approval is APPROVED skips
   * REQUIRE_APPROVAL rules only. Fails closed on evaluation errors.
   */
  async gateReschedule(
    orgId: string,
    postId: string,
    date: string,
    actor: PostActor
  ): Promise<{ proceed: boolean; policy: PolicyOutcome; approvalRequested: boolean }> {
    const when = new Date(date);
    if (Number.isNaN(when.getTime())) {
      throw new BadRequestException({ msg: 'A valid date is required' });
    }
    let outcome: PolicyOutcome;
    try {
      const evaluate = async (approved: boolean) => {
        const target = await this._evaluation.targetFromStoredPost(orgId, postId, {
          action: 'SCHEDULE',
          approved,
        });
        if (!target) throw new NotFoundException({ msg: 'Post not found' });
        const now = (this._evaluation.clock ?? (() => new Date()))();
        target.scheduledAt = when.getTime() < now.getTime() ? now : when;
        const view = actorViewFromColumns(actorToColumns(actor, 'createdBy'), 'createdBy') as ActorView;
        target.actors = [view, ...target.actors.filter((a) => actorKey(a) !== actorKey(view))];
        return this._evaluation.evaluateTargets(orgId, [target], 'write');
      };
      outcome = await evaluate(false);
      if (outcome.effect === 'REQUIRE_APPROVAL' && this._approvals) {
        const approval = await this._approvals.getForPost(orgId, postId);
        // An approved post only skips REQUIRE_APPROVAL rules; BLOCK still applies.
        if (approval?.status === 'APPROVED') outcome = await evaluate(true);
      }
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      return failClosed(error);
    }

    if (outcome.effect === 'BLOCK') {
      await this._evaluation.recordOutcome(orgId, outcome, 'write', { postId });
      throw new PolicyBlockedException(outcome);
    }
    const exposed = (): PolicyOutcome => ({
      ...outcome,
      matched: sanitizeMatches(outcome.matched),
      channels: outcome.channels.map((c) => ({ ...c, matched: sanitizeMatches(c.matched) })),
    });
    if (outcome.effect === 'ALLOW') {
      return { proceed: true, policy: exposed(), approvalRequested: false };
    }
    const routed = await this._router.route(orgId, postId, { terminateWorkflow: true });
    await this._evaluation.recordOutcome(orgId, outcome, 'write', { postId });
    return { proceed: false, policy: exposed(), approvalRequested: routed.requested };
  }

  /** Root post of a thread group for one channel, scoped to the organization. */
  private async rootOfGroup(
    orgId: string,
    group: string | undefined,
    integrationId: string
  ): Promise<string | undefined> {
    if (!group) return undefined;
    const rows = await this._evaluation.topLevelRowsOfGroup(orgId, group);
    return (rows.find((r) => r.integrationId === integrationId) ?? rows[0])?.id;
  }

  /**
   * Parks one failed row in the approval queue. An ERROR row has no live
   * workflow, so nothing is terminated. An approval that is already open
   * counts as routed.
   */
  async routeRetry(orgId: string, postId: string): Promise<boolean> {
    const routed = await this._router.route(orgId, postId, {
      terminateWorkflow: false,
      onlyFromState: 'ERROR',
    });
    return routed.requested || routed.approvalId !== null;
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
