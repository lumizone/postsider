import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';
import { ApproverLinkDecisionDto } from '@postsider/nestjs-libraries/dtos/approval/approver-link.dto';
import {
  htmlToPolicyText,
  POLICY_MAX_INPUT_CHARS,
} from '@postsider/nestjs-libraries/policies/policy-text';
import { ApprovalService } from './approval.service';
import { ApprovalLinkRepository } from './approval-link.repository';
import {
  hashLinkToken,
  linkTtlHours,
  makeChallenge,
  newLinkToken,
  verifyChallenge,
} from './approval-link.crypto';
import { renderApproverEmail } from './approval-link.template';
import {
  IMPLICIT_RULES,
  IMPLICIT_STAGE,
  canDecideStage,
  eligibleMemberIds,
  type FlowRules,
  type StageDef,
  type StageVerdict,
} from './approval-stage.rules';
import {
  STRICT_RULES,
  originOf,
  stageDefFromRow,
  type StageRow,
} from './approval-decision';

export const MAX_FAILED_ATTEMPTS = 5;
const FAIL_WINDOW_SECONDS = 15 * 60;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const VIEW_TEXT_MAX = 5000;
const LINK_EMAIL_CONCURRENCY = 5;

type StageSummary = { position: number; total: number; name: string };
type Review = NonNullable<
  Awaited<ReturnType<ApprovalLinkRepository['getReview']>>
>;
type LiveToken = NonNullable<
  Awaited<ReturnType<ApprovalLinkRepository['getLiveToken']>>
>;

/** Every unknown, spent, expired, revoked or guessed token answers with this exact body. */
function linkInvalid() {
  return new NotFoundException({ error: 'link_invalid' });
}

function plainText(html: string | null | undefined, max: number): string {
  try {
    return htmlToPolicyText(String(html ?? '').slice(0, POLICY_MAX_INPUT_CHARS)).slice(
      0,
      max
    );
  } catch {
    return '';
  }
}

function mediaOf(image: string | null | undefined) {
  try {
    const parsed = JSON.parse(image || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m: any) =>
          m && typeof m.path === 'string' && /^https?:\/\//i.test(m.path)
      )
      .slice(0, 10)
      .map((m: any) => ({
        path: m.path as string,
        type: /\.(mp4|mov|webm|m4v)(\?|$)/i.test(m.path) ? 'video' : 'image',
      }));
  } catch {
    return [];
  }
}

@Injectable()
export class ApprovalLinkService {
  private readonly logger = new Logger(ApprovalLinkService.name);
  /** Test seam. */
  now: () => number = () => Date.now();

  constructor(
    private _links: ApprovalLinkRepository,
    private _notifications: NotificationService,
    private _organizations: OrganizationRepository,
    @Inject(forwardRef(() => ApprovalService))
    private _approvals: ApprovalService
  ) {}

  private secret(): string | null {
    const s = process.env.JWT_SECRET;
    return s && s.length > 0 ? s : null;
  }

  // --- Sending -----------------------------------------------------------

  /**
   * Mints one single use token per eligible human approver of the stage and
   * emails each a personal link. Returns false when links cannot be produced
   * at all (so the caller falls back to the plain email); never throws, never
   * logs a token.
   */
  async sendStageEmails(
    orgId: string,
    approval: { id: string },
    stage: StageSummary
  ): Promise<boolean> {
    try {
      if (!this.secret() || !process.env.FRONTEND_URL) return false;
      const review = await this._links.getReview(orgId, approval.id);
      if (!review) return false;
      const { def, rules } = await this.stageOf(orgId, review, stage.position);
      // A stage advance kills the tokens of earlier stages.
      await this._links.deleteOtherStages(orgId, approval.id, stage.position);

      const org = await this._organizations.getAllUsersOrgs(orgId);
      const allUsers = ((org?.users ?? []) as any[]).filter((u) => u?.user?.id);
      const eligible = new Set(
        eligibleMemberIds(
          def,
          allUsers.map((u) => ({ userId: u.user.id, role: u.role }))
        )
      );
      // Same channel-assignment narrowing as the plain approver email: fewer
      // mailboxes hold a live credential. Narrowing applies to the eligible
      // members, so an assignee who cannot decide never hides a real approver.
      const users = await this._notifications.narrowToChannelAssignees(
        orgId,
        review.post?.integrationId,
        allUsers.filter((u) => eligible.has(u.user.id))
      );
      const origin = originOf(
        review,
        review.post,
        (review.stages ?? []) as unknown as StageRow[],
        stage.position
      );
      const ttlMs = linkTtlHours(process.env.APPROVAL_LINK_TTL_HOURS) * 3_600_000;
      const base = String(process.env.FRONTEND_URL).replace(/\/+$/, '');
      const stageLabel =
        stage.total > 1 ? `Stage ${stage.position} of ${stage.total}` : 'Approval';

      const targets = users.filter(
        (m: any) => eligible.has(m.user.id) && m.user.sendSuccessEmails !== false
      );
      let sent = 0;
      const sendTo = async (member: any) => {
        try {
          // role/disabled come from the members list already fetched above.
          if (member.disabled) return;
          const verdict = canDecideStage(
            def,
            rules,
            {
              kind: 'member',
              userId: member.user.id,
              role: member.role as 'USER' | 'ADMIN' | 'SUPERADMIN',
              disabled: !!member.disabled,
            },
            origin
          );
          // A link that could not be used (own post under a no self approval flow) is noise.
          if (!verdict.ok) return;

          const token = newLinkToken();
          const tokenHash = hashLinkToken(token);
          await this._links.replaceToken({
            orgId,
            approvalId: approval.id,
            stagePosition: stage.position,
            userId: member.user.id,
            tokenHash,
            expiresAt: new Date(this.now() + ttlMs),
          });
          try {
            const { subject, html } = renderApproverEmail({
              channelName: review.post?.integration?.name ?? 'Channel',
              stageName: def.name,
              stageLabel,
              requesterName: review.requestedBy?.name || 'A teammate',
              preview: plainText(review.post?.content, 200),
              approveUrl: `${base}/approve/${token}?intent=approve`,
              rejectUrl: `${base}/approve/${token}?intent=reject`,
            });
            await this._notifications.sendEmail(member.user.email, subject, html);
            sent += 1;
          } catch (error) {
            // An unsent email must not leave a live credential behind.
            await this._links.deleteToken(tokenHash).catch(() => undefined);
            throw error;
          }
        } catch (error) {
          this.logger.warn(
            `approver link email failed for approval ${approval.id}: ${
              (error as Error)?.name ?? 'Error'
            }`
          );
        }
      };
      // Small concurrency cap; each member keeps its own error isolation.
      for (let i = 0; i < targets.length; i += LINK_EMAIL_CONCURRENCY) {
        await Promise.all(targets.slice(i, i + LINK_EMAIL_CONCURRENCY).map(sendTo));
      }
      // Only a delivered link counts: otherwise the caller sends the plain email.
      return sent > 0;
    } catch (error) {
      this.logger.warn(
        `approver link emails not sent for approval ${approval.id}: ${
          (error as Error)?.name ?? 'Error'
        }`
      );
      return false;
    }
  }

  /**
   * Deletes every token of the approval. Called after a final decision made
   * through an email link. Other paths do not call it: a re-open drops the
   * tokens inside its own transaction (ApprovalRepository.openRequest), and a
   * decision made elsewhere leaves tokens that the link flow already refuses
   * (the approval is no longer PENDING at that stage) and that the daily
   * retention purge deletes 7 days after expiry or use.
   */
  async revokeForApproval(orgId: string, approvalId: string): Promise<void> {
    await this._links.deleteForApproval(orgId, approvalId);
  }

  // --- GET: review data, never mutates ----------------------------------

  async view(token: string) {
    const secret = this.secret();
    if (!secret) throw linkInvalid();
    const { row, hash } = await this.loadLive(token);
    const review = await this.loadReview(row);
    const { verdict, def } = await this.verdictFor(row, review);
    if (!verdict.ok && !this.isSelfBlock(verdict)) throw this.notAllowed();
    const total = review.stages?.length ? review.stages.length : 1;
    const approverName = await this._links.getUserName(row.userId);
    return {
      post: {
        text: plainText(review.post?.content, VIEW_TEXT_MAX),
        media: mediaOf(review.post?.image),
        publishDate: review.post?.publishDate ?? null,
      },
      channel: {
        name: review.post?.integration?.name ?? '',
        providerIdentifier: review.post?.integration?.providerIdentifier ?? '',
      },
      requester: { name: review.requestedBy?.name ?? '' },
      stage: { position: row.stagePosition, total, name: def.name },
      approver: { name: approverName ?? '' },
      selfApprovalBlocked: !verdict.ok,
      expiresAt: row.expiresAt,
      challenge: makeChallenge(hash, this.now(), secret),
    };
  }

  // --- POST: the decision ------------------------------------------------

  async decide(token: string, body: unknown) {
    const secret = this.secret();
    if (!secret) throw linkInvalid();
    const { row, hash } = await this.loadLive(token);

    const dto = plainToInstance(
      ApproverLinkDecisionDto,
      body && typeof body === 'object' && !Array.isArray(body) ? body : {}
    );
    if (validateSync(dto).length > 0) {
      await this.recordFailure(hash);
      throw new BadRequestException({ error: 'invalid_request' });
    }
    if (verifyChallenge(dto.challenge, hash, this.now(), secret) !== 'ok') {
      await this.recordFailure(hash);
      // Same body as an unknown link: no oracle on the challenge state.
      throw linkInvalid();
    }

    const review = await this.loadReview(row);
    const { verdict, link } = await this.verdictFor(row, review);
    if (!verdict.ok) {
      throw this.isSelfBlock(verdict) ? this.selfBlocked() : this.notAllowed();
    }

    // Single use: the first caller wins, everyone else sees a dead link.
    if (!(await this._links.consumeToken(hash, new Date(this.now())))) {
      throw linkInvalid();
    }

    let result;
    try {
      const actor = { type: 'USER' as const, userId: row.userId };
      result = await runWithActor(actor, () =>
        this._approvals.decide(
          row.organizationId,
          row.approvalId,
          {
            actor,
            userId: row.userId,
            role: link.role,
            via: 'EMAIL_LINK',
          },
          dto.decision,
          { note: dto.note ?? null, expectStage: row.stagePosition }
        )
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        // Decided by someone else: the link stays spent.
        throw error;
      }
      // A refused (or failed) decision must not burn the link.
      await this._links.restoreToken(hash).catch(() => undefined);
      throw this.mapEngineError(error);
    }

    if (!result.changed) {
      throw new ConflictException({
        error: 'approval_already_resolved',
        status: result.status,
      });
    }
    if (result.final) {
      await this.revokeForApproval(row.organizationId, row.approvalId).catch(
        () => undefined
      );
    }
    return {
      status: result.status,
      final: result.final,
      stage: result.stage,
    };
  }

  // --- helpers -----------------------------------------------------------

  private async loadLive(token: string): Promise<{ row: LiveToken; hash: string }> {
    if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) throw linkInvalid();
    const hash = hashLinkToken(token);
    const row = await this._links.getLiveToken(hash, new Date(this.now()));
    if (!row) throw linkInvalid();
    return { row, hash };
  }

  /** The approval of a live token, still pending and still at the token's stage. */
  private async loadReview(row: LiveToken): Promise<Review> {
    const review = await this._links.getReview(row.organizationId, row.approvalId);
    if (!review) throw linkInvalid();
    if (
      review.status !== 'PENDING' ||
      (review.currentStage ?? 1) !== row.stagePosition
    ) {
      throw new ConflictException({
        error: 'approval_already_resolved',
        status: review.status,
      });
    }
    return review;
  }

  private async stageOf(
    orgId: string,
    review: Review,
    position: number
  ): Promise<{ def: StageDef; rules: FlowRules }> {
    const rows = (review.stages ?? []) as unknown as StageRow[];
    if (rows.length === 0) {
      if (review.flowId) {
        // Inconsistent flow based approval: fail closed like the engine.
        throw new ConflictException({ error: 'approval_stage_invalid' });
      }
      return { def: IMPLICIT_STAGE, rules: IMPLICIT_RULES };
    }
    const found = rows.find((r) => r.position === position);
    if (!found) throw new ConflictException({ error: 'approval_stage_invalid' });
    const rules =
      (review.flowId
        ? await this._links.getFlowRules(orgId, review.flowId)
        : null) ?? STRICT_RULES;
    return { def: stageDefFromRow(found), rules };
  }

  /** Re-reads membership and applies the stage rules to the member the token names. */
  private async verdictFor(row: LiveToken, review: Review) {
    const link = await this._organizations.getUserOrgLink(
      row.organizationId,
      row.userId
    );
    const { def, rules } = await this.stageOf(
      row.organizationId,
      review,
      row.stagePosition
    );
    if (!link) {
      return {
        def,
        link: { role: 'USER', disabled: false },
        verdict: { ok: false, reason: 'role' } as StageVerdict,
      };
    }
    const verdict = canDecideStage(
      def,
      rules,
      {
        kind: 'member',
        userId: row.userId,
        role: link.role as 'USER' | 'ADMIN' | 'SUPERADMIN',
        disabled: link.disabled,
      },
      originOf(
        review,
        review.post,
        (review.stages ?? []) as unknown as StageRow[],
        row.stagePosition
      )
    );
    return { def, link, verdict };
  }

  private isSelfBlock(verdict: StageVerdict): boolean {
    return (
      !verdict.ok &&
      (verdict.reason === 'self_approval' || verdict.reason === 'not_distinct')
    );
  }

  private notAllowed() {
    return new ForbiddenException({ error: 'link_not_allowed' });
  }

  private selfBlocked() {
    return new ForbiddenException({ error: 'self_approval_blocked' });
  }

  private mapEngineError(error: unknown) {
    if (error instanceof ForbiddenException) {
      const code = (error.getResponse() as any)?.error;
      return code === 'self_approval_blocked'
        ? this.selfBlocked()
        : this.notAllowed();
    }
    return error;
  }

  /** Five failed attempts revoke the token. A Redis outage fails closed. */
  private async recordFailure(hash: string): Promise<void> {
    try {
      const key = `approver-link:fail:${hash.slice(0, 12)}`;
      const count = await ioRedis.incr(key);
      if (count === 1) await ioRedis.expire(key, FAIL_WINDOW_SECONDS);
      if (count >= MAX_FAILED_ATTEMPTS) await this._links.deleteToken(hash);
    } catch {
      await this._links.deleteToken(hash).catch(() => undefined);
    }
  }
}
