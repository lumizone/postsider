import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ApprovalRepository, type StageSnapshot } from './approval.repository';
import {
  assertCanApprove,
  assertPending,
  assertRequestable,
} from './approval.rules';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { PublicWebhookDeliveryService } from '@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-delivery.service';
import { PublicWebhookEvent } from '@postsider/nestjs-libraries/services/public-webhook-events';
import { PostApproval } from '@prisma/client';
import {
  currentActor,
  currentKeyPermissions,
} from '@postsider/nestjs-libraries/actor/actor-context';
import {
  PostActor,
  actorViewFromColumns,
} from '@postsider/nestjs-libraries/actor/post-actor';
import {
  approvalDecidedByView,
  toStageView,
  withStageView,
  type StageSummary,
} from './approval.projection';
import {
  PostIdentity,
  emptyPostIdentity,
} from '@postsider/nestjs-libraries/actor/post-identity';
import { hashGuestToken, newGuestToken } from './guest-token';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import { recordPostEvent } from '@postsider/nestjs-libraries/database/prisma/audit/post-audit';
import { ApprovalFlowService } from './approval-flow.service';
import {
  IMPLICIT_RULES,
  IMPLICIT_STAGE,
  canDecideStage,
  type Decider as StageDecider,
  type FlowRules,
  type StageDef,
} from './approval-stage.rules';
import {
  STRICT_RULES,
  alreadyResolved,
  originOf,
  resultOf,
  stageDefFromRow,
  verdictError,
  type DecideOpts,
  type Decider,
  type DecisionResult,
  type StageRow,
} from './approval-decision';
import { checkKeyPermission } from '@postsider/nestjs-libraries/policies/key-permissions';

export type { Decider, DecideOpts, DecisionResult } from './approval-decision';
export type ApprovalRequestResult = PostApproval & { created: boolean };
export type ApprovalRequestOpts = { flowId?: string | null; ruleIds?: string[] };

const GUEST_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class ApprovalService {
  constructor(
    private _repo: ApprovalRepository,
    private _posts: PostsService,
    private _notifications: NotificationService,
    private _organizations: OrganizationRepository,
    private _publicWebhookDelivery: PublicWebhookDeliveryService,
    @Optional() private _audit?: AuditLogger,
    @Optional() private _flows?: ApprovalFlowService
  ) {}

  /**
   * Public-API entry point (agency content-gen pipelines, n8n, etc.): no
   * session user exists to attribute the request to, so it's attributed to
   * the org's own SUPERADMIN (falling back to any ADMIN, then any member) —
   * "the org itself, via API" rather than a specific human.
   */
  async requestApprovalFromApi(
    orgId: string,
    postId: string,
    opts: ApprovalRequestOpts = {}
  ): Promise<ApprovalRequestResult> {
    const requestedById = await this.resolveApiRequester(orgId);
    return this.requestApproval(
      orgId,
      postId,
      requestedById,
      currentActor(),
      opts
    );
  }

  private async resolveApiRequester(orgId: string): Promise<string> {
    const org = await this._organizations.getAllUsersOrgs(orgId);
    const users = (org?.users || []) as Array<{
      role: string;
      user: { id: string };
    }>;
    const chosen =
      users.find((u) => u.role === 'SUPERADMIN') ||
      users.find((u) => u.role === 'ADMIN') ||
      users[0];
    if (!chosen) {
      throw new BadRequestException(
        'Organization has no users to attribute this approval request to'
      );
    }
    return chosen.user.id;
  }

  /**
   * The flow an approval will run through: the explicit flow, else the flow of
   * the first matching rule that has one, else the organization default, else
   * none (the implicit single stage). Archived flows are ignored.
   */
  private async resolveSnapshot(
    orgId: string,
    opts: ApprovalRequestOpts
  ): Promise<StageSnapshot | undefined> {
    if (!this._flows) return undefined;
    const explicit = opts.flowId
      ? await this._flows.getById(orgId, opts.flowId)
      : null;
    const flow =
      explicit ?? (await this._flows.resolveFlowForRules(orgId, opts.ruleIds ?? []));
    if (!flow) return undefined;
    const snap = this._flows.snapshot(flow);
    return snap.stages.length > 0
      ? { flowId: snap.flowId, stages: snap.stages }
      : undefined;
  }

  async requestApproval(
    orgId: string,
    postId: string,
    requestedById: string,
    actor: PostActor = currentActor(),
    opts: ApprovalRequestOpts = {}
  ): Promise<ApprovalRequestResult> {
    const post = await this._repo.getPost(orgId, postId);
    assertRequestable(post);
    // Read the flow before the approval is written, so the stage rows are
    // stored together with it (a flow based approval never exists without them).
    const snapshot = await this.resolveSnapshot(orgId, opts);
    const { approval, created } = snapshot
      ? await this._repo.openRequest(orgId, postId, requestedById, actor, snapshot)
      : await this._repo.openRequest(orgId, postId, requestedById, actor);
    if (!created) {
      // Retried request on an already open approval: change nothing and send
      // nothing. Only heal a post that fell back to DRAFT while still pending.
      if (post?.state === 'DRAFT' && approval.status === 'PENDING') {
        await this._posts.setPostState(orgId, postId, 'APPROVAL' as any);
      }
      return { ...approval, created: false };
    }
    // Distinguish pending-approval posts from plain drafts in the calendar and
    // filters. The State.APPROVAL enum was unused before — now it means "draft
    // that is waiting for approval" so calendars and lists can surface them.
    await this._posts.setPostState(orgId, postId, 'APPROVAL' as any);
    const first: StageSummary = snapshot
      ? {
          position: 1,
          total: snapshot.stages.length,
          name: snapshot.stages[0].name,
        }
      : { position: 1, total: 1, name: IMPLICIT_STAGE.name };
    // In-app notification for everyone in the org (badge/dropdown) + email to
    // the org's approvers so a pending review doesn't sit unseen.
    await this.onStageOpened(orgId, approval, first, {
      integrationId: post?.integrationId ?? null,
    });
    await this.emitWebhook(
      orgId,
      'approval.requested',
      { approvalId: approval.id, postId, status: 'PENDING' },
      approval,
      first
    );
    await recordPostEvent(this._audit, {
      organizationId: orgId,
      event: 'post.approval_requested',
      targetType: 'post',
      targetId: postId,
      actor,
      metadata: { approvalId: approval.id },
    });
    return { ...approval, created: true };
  }

  /**
   * Extension point: a stage became the open one (the first stage right after
   * the request, later stages after the previous one was approved). Default:
   * the in-app notification and the plain approver email. The email approver
   * links feature overrides the email part.
   */
  protected async onStageOpened(
    orgId: string,
    approval: Pick<PostApproval, 'id'>,
    stage: StageSummary,
    ctx: { integrationId?: string | null } = {}
  ): Promise<void> {
    await this._notifications.inAppNotification(
      orgId,
      'Approval requested',
      'A post has been submitted for approval.',
      false,
      false,
      'info',
      `${process.env.FRONTEND_URL}/approval`,
      { key: 'approvalRequested' }
    );
    const later = stage.position > 1;
    await this._notifications.notifyApprovers(
      orgId,
      later
        ? `Post awaiting approval (stage ${stage.position} of ${stage.total})`
        : 'New post awaiting approval',
      later
        ? `A post passed an earlier approval stage and is now waiting at stage ${stage.position} of ${stage.total} in the approval queue.`
        : 'A post has been submitted for approval and is waiting in the approval queue.',
      ctx.integrationId ?? undefined
    );
  }

  async getPending(orgId: string) {
    const rows = await this._repo.getPending(orgId);
    return rows.map((row) => withStageView(row));
  }

  /** The approval row plus `stage` and `stages`; `status` keeps meaning "all stages approved". */
  async getForPost(orgId: string, postId: string) {
    const row = await this._repo.getApprovalByPost(orgId, postId);
    return row ? withStageView(row) : row;
  }

  getStageView(approval: Record<string, any>) {
    return toStageView(approval);
  }

  // --- Decision engine ---------------------------------------------------
  //
  // One method decides a stage for every entry point (dashboard, public API,
  // email link, guest link, bulk). It never trusts the caller's claimed role:
  // members are re-read from the database, the stage snapshot of the approval
  // is the rule book, and the write is a conditional transaction, so two
  // concurrent decisions produce exactly one winner.

  async decide(
    orgId: string,
    approvalId: string,
    decider: Decider,
    decision: 'approve' | 'reject',
    opts: DecideOpts = {}
  ): Promise<DecisionResult> {
    const wanted = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    const approval = await this._repo.getById(orgId, approvalId);
    if (!approval) throw new NotFoundException('Approval not found');
    if (approval.status !== 'PENDING') return alreadyResolved(approval, wanted);

    const rows = (approval.stages ?? []) as unknown as StageRow[];
    const hasRow = rows.length > 0;
    if (!hasRow && approval.flowId) {
      // A flow based approval without its stage rows is inconsistent: do not
      // fall back to the more permissive implicit stage.
      throw new ConflictException({ error: 'approval_stage_invalid' });
    }
    const total = hasRow ? rows.length : 1;
    const position = approval.currentStage ?? 1;
    const row = hasRow ? rows.find((r) => r.position === position) : undefined;
    if (hasRow && !row) {
      throw new ConflictException({ error: 'approval_stage_invalid' });
    }
    const stage: StageDef = row ? stageDefFromRow(row) : IMPLICIT_STAGE;
    const rules: FlowRules = hasRow
      ? ((approval.flowId
          ? await this._repo.getFlowRules(orgId, approval.flowId)
          : null) ?? STRICT_RULES)
      : IMPLICIT_RULES;

    const post = await this._repo.getPost(orgId, approval.postId);
    if (!post) throw new NotFoundException('Post not found');

    const stageDecider = await this.toStageDecider(orgId, decider);
    const verdict = canDecideStage(
      stage,
      rules,
      stageDecider,
      originOf(approval, post, rows, position)
    );
    if (!verdict.ok) throw verdictError(verdict);
    if (stageDecider.kind === 'automation') {
      // Approving schedules the post: the key needs that action on the channel.
      this.assertKeyMaySchedule(post.integrationId);
    }
    if (opts.expectStage !== undefined && opts.expectStage !== position) {
      return this.lostRace(orgId, approvalId, wanted, opts.expectStage);
    }

    const note = opts.note ?? null;
    const final = decision === 'reject' || position >= total;
    const won = await this._repo.decideStageTx({
      orgId,
      approvalId,
      position,
      hasStageRow: hasRow,
      decision: wanted,
      final,
      note,
      via: decider.via,
      actor: decider.via === 'GUEST' ? null : decider.actor,
      guest: decider.guest ?? null,
      guestToken: decider.via === 'GUEST' ? (opts.guestToken ?? null) : null,
    });
    if (!won) return this.lostRace(orgId, approvalId, wanted, position);

    const requesterEmail = (approval as any)?.requestedBy?.email as
      | string
      | undefined;
    const base = {
      approvalId,
      postId: approval.postId,
      changed: true,
      stage: { position, total },
      final,
    };

    if (decision === 'reject') {
      await this.onRejected(orgId, approval.postId, note, requesterEmail);
    } else if (!final) {
      const next = rows.find((r) => r.position === position + 1);
      await this.openNextStage(orgId, approval, {
        position: position + 1,
        total,
        name: next?.name ?? IMPLICIT_STAGE.name,
      }, post.integrationId ?? null);
    } else {
      const restore =
        decider.via === 'GUEST' && opts.guestToken && approval.guestTokenExpiresAt
          ? {
              tokenHash: hashGuestToken(opts.guestToken),
              expiresAt: approval.guestTokenExpiresAt,
            }
          : undefined;
      await this.scheduleApprovedPost(orgId, approval.postId, () =>
        this._repo.revertFinal(orgId, approvalId, position, hasRow, restore)
      );
      await this.notifyApproved(orgId, approval.postId, requesterEmail);
    }

    if (final) {
      const fresh = await this.reread(orgId, approvalId, approval);
      await this.emitWebhook(
        orgId,
        'approval.resolved',
        { approvalId, postId: approval.postId, status: wanted, note },
        fresh,
        fresh ? toStageView(fresh).stage : { position, total, name: stage.name }
      );
    }
    await recordPostEvent(this._audit, {
      organizationId: orgId,
      event: 'post.approval_resolved',
      targetType: 'post',
      targetId: approval.postId,
      actor: decider.via === 'GUEST' ? null : decider.actor ?? undefined,
      metadata: {
        approvalId,
        decision: wanted,
        via: decider.via,
        stage: position,
        stageCount: total,
        final,
        ...(decider.via === 'GUEST' ? { by: 'guest' } : {}),
      },
    });
    return { ...base, status: final ? wanted : 'PENDING' };
  }

  private async toStageDecider(
    orgId: string,
    decider: Decider
  ): Promise<StageDecider> {
    if (decider.via === 'GUEST') return { kind: 'guest' };
    const actor = decider.actor;
    if (actor?.type === 'USER') {
      const link = await this._organizations.getUserOrgLink(orgId, actor.userId);
      if (!link) {
        throw new ForbiddenException({
          error: 'not_allowed_for_stage',
          reason: 'not_member',
          msg: 'You are not allowed to decide this approval stage.',
        });
      }
      return {
        kind: 'member',
        userId: actor.userId,
        role: link.role as 'USER' | 'ADMIN' | 'SUPERADMIN',
        disabled: link.disabled,
      };
    }
    if (actor?.type === 'API_KEY' || actor?.type === 'OAUTH_CLIENT') {
      return { kind: 'automation', actor };
    }
    throw new ForbiddenException({
      error: 'not_allowed_for_stage',
      reason: 'unsupported_actor',
      msg: 'This caller cannot decide approvals.',
    });
  }

  private assertKeyMaySchedule(integrationId: string | null | undefined) {
    const check = checkKeyPermission(currentKeyPermissions(), 'SCHEDULE', [
      integrationId ?? '',
    ]);
    if (check.allowed) return;
    if (check.code === 'key_action_not_allowed') {
      throw new HttpException(
        {
          error: check.code,
          msg: 'This API key may not schedule.',
          action: check.action,
          allowedActions: check.allowedActions,
        },
        403
      );
    }
    throw new HttpException(
      {
        error: check.code,
        msg: 'This API key may not post to this channel.',
        integrationId: check.integrationId,
        allowedIntegrationIds: check.allowedIntegrationIds,
      },
      403
    );
  }

  /**
   * The conditional write matched nothing: another decision won. Report what
   * the winner left behind: the same decision is `changed: false`, a different
   * one is a 409. Nothing is applied twice.
   */
  private async lostRace(
    orgId: string,
    approvalId: string,
    wanted: 'APPROVED' | 'REJECTED',
    position: number
  ): Promise<DecisionResult> {
    const fresh = await this._repo.getById(orgId, approvalId);
    if (!fresh) throw new NotFoundException('Approval not found');
    if (fresh.status !== 'PENDING') return alreadyResolved(fresh, wanted);
    const row = ((fresh.stages ?? []) as unknown as StageRow[]).find(
      (r) => r.position === position
    );
    if (row && row.status !== 'PENDING' && row.status !== wanted) {
      throw new ConflictException({
        error: 'approval_already_resolved',
        status: fresh.status,
      });
    }
    return resultOf(fresh, false);
  }

  /** A committed approval must not report failure because a notification failed. */
  private async openNextStage(
    orgId: string,
    approval: Record<string, any>,
    stage: StageSummary,
    integrationId: string | null
  ) {
    try {
      await this.onStageOpened(orgId, approval as PostApproval, stage, {
        integrationId,
      });
    } catch {
      // secondary; the decision is already stored
    }
  }

  // The dashboard keeps its historic contract: any approval that is already
  // resolved answers 400, the admin check comes first.
  async approve(
    orgId: string,
    approvalId: string,
    approverId: string,
    role: string
  ) {
    assertCanApprove(role);
    const result = await this.decideFromDashboard(
      orgId,
      approvalId,
      approverId,
      'approve'
    );
    return { approved: true, postId: result.postId };
  }

  async reject(
    orgId: string,
    approvalId: string,
    approverId: string,
    role: string,
    note?: string
  ) {
    assertCanApprove(role);
    const result = await this.decideFromDashboard(
      orgId,
      approvalId,
      approverId,
      'reject',
      note
    );
    return { rejected: true, postId: result.postId };
  }

  private async decideFromDashboard(
    orgId: string,
    approvalId: string,
    approverId: string,
    decision: 'approve' | 'reject',
    note?: string
  ): Promise<DecisionResult> {
    let result: DecisionResult;
    try {
      result = await this.decide(
        orgId,
        approvalId,
        { actor: { type: 'USER', userId: approverId }, via: 'DASHBOARD' },
        decision,
        { note: note ?? null }
      );
    } catch (error) {
      if (this.isAlreadyResolved(error)) {
        throw new BadRequestException('This approval has already been resolved');
      }
      throw error;
    }
    if (!result.changed) {
      throw new BadRequestException('This approval has already been resolved');
    }
    return result;
  }

  private isAlreadyResolved(error: unknown): boolean {
    return (
      error instanceof ConflictException &&
      (error.getResponse() as { error?: string })?.error ===
        'approval_already_resolved'
    );
  }

  // --- Guest (external reviewer) link ----------------------------------
  //
  // Lets an ADMIN/SUPERADMIN hand a specific pending approval to someone
  // WITHOUT a PostSider account (e.g. the agency's own client) — a common
  // agency ask: the client shouldn't need a paid seat just to say yes/no to
  // a post. No approval gets a link unless an admin explicitly creates one;
  // nothing here changes the normal in-app approve/reject flow. A flow stage
  // accepts a guest only when it says so (`allowGuest`), which also stops an
  // admin minting a link to approve what a flow forbids them to approve.

  async createGuestLink(orgId: string, approvalId: string, role: string) {
    assertCanApprove(role);
    const approval = await this._repo.getById(orgId, approvalId);
    assertPending(approval);
    const rows = (approval!.stages ?? []) as unknown as StageRow[];
    const current = rows.find((r) => r.position === (approval!.currentStage ?? 1));
    const allowGuest = rows.length > 0 ? !!current?.allowGuest : IMPLICIT_STAGE.allowGuest;
    if (!allowGuest) {
      throw new BadRequestException({
        error: 'guest_not_allowed_for_stage',
        msg: 'The current approval stage does not accept guest reviewers.',
      });
    }
    // The plaintext is returned to the caller once; only its hash is stored.
    const token = newGuestToken();
    const expiresAt = new Date(Date.now() + GUEST_LINK_TTL_MS);
    const count = await this._repo.setGuestToken(
      orgId,
      approvalId,
      hashGuestToken(token),
      expiresAt
    );
    if (!count) {
      throw new BadRequestException('Approval not found');
    }
    return { token, expiresAt };
  }

  async revokeGuestLink(orgId: string, approvalId: string, role: string) {
    assertCanApprove(role);
    await this._repo.revokeGuestToken(orgId, approvalId);
    return { revoked: true };
  }

  /** Public — no org/user context, gated entirely by the unguessable token. */
  async getForGuestReview(token: string) {
    const approval = await this._repo.getByGuestToken(token);
    if (!approval) {
      throw new BadRequestException(
        'This review link is invalid or has expired.'
      );
    }
    // Strip internal fields (org id, requester identity) the review UI has
    // no need for — the DB row carries more than a guest should ever see.
    return {
      content: approval.post.content,
      image: approval.post.image,
      publishDate: approval.post.publishDate,
      channel: approval.post.integration,
      branding: approval.organization,
    };
  }

  async resolveGuestReview(
    token: string,
    action: 'approve' | 'reject',
    note?: string,
    guest?: { name: string; email: string } | null
  ) {
    const approval = await this._repo.getByGuestToken(token);
    if (!approval) {
      throw new BadRequestException(
        'This review link is invalid or has expired.'
      );
    }
    const used = () =>
      new BadRequestException('This review link has already been used.');
    let result: DecisionResult;
    try {
      result = await this.decide(
        approval.organizationId,
        approval.id,
        { actor: null, via: 'GUEST', guest: guest ?? null },
        action,
        { note: note ?? null, guestToken: token }
      );
    } catch (error) {
      // Lost a race with the admin resolving it in-app: never twice.
      if (this.isAlreadyResolved(error)) throw used();
      throw error;
    }
    if (!result.changed) throw used();
    // `action + 'd'` produced "rejectd" for rejections (and only worked at all
    // for "approve"). Callers branch on this, so spell both keys out.
    return action === 'approve'
      ? { approved: true }
      : ({ rejected: true } as Record<string, boolean>);
  }

  private async scheduleApprovedPost(
    orgId: string,
    postId: string,
    revert: () => Promise<number>
  ) {
    try {
      await this._posts.changePostStatus(orgId, postId, 'schedule', true);
    } catch (error) {
      const reverted = await revert();
      if (!reverted) {
        throw new Error(
          'Failed to restore pending approval after scheduling failed'
        );
      }
      throw error;
    }
  }

  private async notifyApproved(
    orgId: string,
    postId: string,
    requesterEmail?: string
  ) {
    await this._notifications.inAppNotification(
      orgId,
      'Post approved',
      'A post was approved and scheduled.',
      false,
      false,
      'success',
      `${process.env.FRONTEND_URL}/approval`,
      { key: 'approvalApproved' }
    );
    if (requesterEmail) {
      try {
        await this._notifications.sendEmail(
          requesterEmail,
          'Post approved',
          'Your post has been approved and is now scheduled for publishing.'
        );
      } catch {} // non-critical
    }
  }

  /** Org scoped re-read so decidedBy reflects the resolved row; best effort. */
  private async reread(
    orgId: string,
    approvalId: string,
    fallback: Record<string, any> | null | undefined
  ): Promise<Record<string, any> | null | undefined> {
    try {
      return (await this._repo.getById(orgId, approvalId)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  private async emitWebhook(
    organizationId: string,
    event: PublicWebhookEvent,
    data: Record<string, unknown>,
    approvalRow?: Record<string, any> | null,
    stage?: StageSummary
  ) {
    try {
      const postId = typeof data.postId === 'string' ? data.postId : null;
      let identity: PostIdentity = emptyPostIdentity();
      if (postId) {
        try {
          identity = await this._posts.getPostIdentity(organizationId, postId);
        } catch {
          // identity is best effort and must never block an event
        }
      }
      let approval: Record<string, unknown> = {
        requestedBy: null,
        decidedBy: null,
        stage: stage ?? null,
      };
      try {
        approval = {
          requestedBy: actorViewFromColumns(approvalRow, 'requestedBy'),
          decidedBy: approvalRow ? approvalDecidedByView(approvalRow) : null,
          stage: stage ?? null,
        };
      } catch {
        // keep the empty shape
      }
      await this._publicWebhookDelivery.deliver(organizationId, event, {
        ...data,
        actor: identity.actor,
        provenance: identity.provenance,
        approval,
      });
    } catch {
      // User callbacks are secondary and must never roll back approval state.
    }
  }

  private async onRejected(
    orgId: string,
    postId: string,
    note: string | null,
    requesterEmail?: string
  ) {
    // Reset post state to DRAFT so the author can edit and resubmit.
    // (State.APPROVAL was set in requestApproval — rejection restores it.)
    await this._posts.setPostState(orgId, postId, 'DRAFT' as any);
    await this._notifications.inAppNotification(
      orgId,
      'Post rejected',
      note ? `A post was rejected: ${note}` : 'A post was rejected.',
      false,
      false,
      'info',
      `${process.env.FRONTEND_URL}/approval`,
      {
        key: note ? 'approvalRejectedNote' : 'approvalRejected',
        ...(note ? { params: { note } } : {}),
      }
    );
    if (requesterEmail) {
      try {
        await this._notifications.sendEmail(
          requesterEmail,
          'Post rejected',
          note
            ? `Your post was rejected with feedback: "${note}". You can edit and resubmit it.`
            : 'Your post was rejected. You can edit and resubmit it.'
        );
      } catch {} // non-critical
    }
  }
}
