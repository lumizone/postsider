import { Injectable, Optional } from '@nestjs/common';
import { PostApproval } from '@prisma/client';
import { actorToColumns, PostActor } from '@postsider/nestjs-libraries/actor/post-actor';
import { hashGuestToken } from '@postsider/nestjs-libraries/database/prisma/approval/guest-token';
import type {
  FlowRules,
  StageDef,
} from '@postsider/nestjs-libraries/database/prisma/approval/approval-stage.rules';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@postsider/nestjs-libraries/database/prisma/prisma.service';

type ResolveStatus = 'APPROVED' | 'REJECTED';

/** Snapshot of the flow an approval runs through, written together with the approval. */
export type StageSnapshot = { flowId: string; stages: StageDef[] };

export type StageDecisionWrite = {
  orgId: string;
  approvalId: string;
  /** The stage being decided; also the approval's expected `currentStage`. */
  position: number;
  /** False for the implicit stage (an approval without snapshot rows). */
  hasStageRow: boolean;
  decision: ResolveStatus;
  final: boolean;
  note: string | null;
  via: string;
  /** The verified decider; null for a guest. */
  actor: PostActor | null;
  guest?: { name: string; email: string } | null;
  /** Plaintext link token a guest decision consumes in the same transaction. */
  guestToken?: string | null;
};

class LostRace extends Error {}

const NOTE_MAX = 500;

function decidedColumns(actor: PostActor | null) {
  return {
    decidedByType: actor ? actor.type : null,
    decidedByApiKeyId: actor?.type === 'API_KEY' ? actor.apiKeyId : null,
    decidedByOAuthClientId:
      actor?.type === 'OAUTH_CLIENT' ? actor.oauthClientId : null,
  };
}

const CLEARED_STAGE_DECISION = {
  status: 'PENDING' as const,
  decidedByType: null,
  decidedByUserId: null,
  decidedByApiKeyId: null,
  decidedByOAuthClientId: null,
  decidedVia: null,
  note: null,
  decidedAt: null,
};

@Injectable()
export class ApprovalRepository {
  constructor(
    private _approval: PrismaRepository<
      | 'postApproval'
      | 'postApprovalStage'
      | 'approvalActionToken'
      | 'approvalFlow'
    >,
    private _post: PrismaRepository<'post'>,
    @Optional() private _tx?: PrismaTransaction
  ) {}

  getPost(orgId: string, postId: string) {
    return this._post.model.post.findFirst({
      where: { id: postId, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        state: true,
        parentPostId: true,
        group: true,
        integrationId: true,
        createdByType: true,
        createdByUserId: true,
        createdByApiKeyId: true,
        createdByOAuthClientId: true,
      },
    });
  }

  getApprovalByPost(orgId: string, postId: string) {
    // Scope by organization so one org can never read another org's approval.
    return this._approval.model.postApproval.findFirst({
      where: { postId, organizationId: orgId },
      include: { stages: { orderBy: { position: 'asc' } } },
    });
  }

  /** The approval with its stage snapshot rows (empty for the implicit stage). */
  getById(orgId: string, id: string) {
    return this._approval.model.postApproval.findFirst({
      where: { id, organizationId: orgId },
      include: {
        requestedBy: { select: { email: true, name: true } },
        stages: { orderBy: { position: 'asc' } },
      },
    });
  }

  /**
   * The self-approval flags of the flow an approval runs through. Archived
   * flows are still read: archiving never changes an approval in progress.
   */
  async getFlowRules(orgId: string, flowId: string): Promise<FlowRules | null> {
    const flow = await this._approval.model.approvalFlow.findFirst({
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

  /**
   * Opens (or re-opens) the single approval row of a post. Idempotent: a
   * retried request on a PENDING approval changes nothing and reports
   * `created: false`. Concurrent first requests are settled by the unique
   * postId constraint (P2002), so exactly one caller sees `created: true`.
   */
  async openRequest(
    orgId: string,
    postId: string,
    requestedById: string,
    actor: PostActor,
    snapshot?: StageSnapshot
  ): Promise<{ approval: PostApproval; created: boolean }> {
    const model = this._approval.model.postApproval;
    const requester = {
      requestedById,
      ...actorToColumns(actor, 'requestedBy'),
    };
    // A flow based approval is written with its flowId first: until its stage
    // rows exist the decision engine fails closed instead of treating the
    // approval as the (more permissive) implicit stage.
    const progress = {
      flowId: snapshot?.flowId ?? null,
      stageCount: snapshot ? snapshot.stages.length : 1,
      currentStage: 1,
    };
    const stageRows = (snapshot?.stages ?? []).map((st) => ({
      position: st.position,
      name: st.name,
      minRole: st.minRole,
      approverUserIds: [...st.approverUserIds],
      allowAutomation: st.allowAutomation,
      allowGuest: st.allowGuest,
    }));
    // A resolved approval starts a fresh round: any guest link from the prior
    // round pointed at now-stale content and must stop working.
    // The whole re-open is one transaction: a failure half way must never
    // leave a PENDING approval without its stage rows (the engine would then
    // fail closed on a flow based approval forever).
    const reopen = async (client: {
      postApproval: any;
      postApprovalStage: any;
      approvalActionToken: any;
    }): Promise<PostApproval | null> => {
      const reopened = await client.postApproval.updateMany({
        where: {
          postId,
          organizationId: orgId,
          status: { in: ['APPROVED', 'REJECTED'] },
        },
        data: {
          status: 'PENDING',
          ...requester,
          requestedAt: new Date(),
          approverId: null,
          decidedByType: null,
          decidedByApiKeyId: null,
          decidedByOAuthClientId: null,
          decidedVia: null,
          note: null,
          guestName: null,
          guestEmail: null,
          resolvedAt: null,
          guestToken: null,
          guestTokenHash: null,
          guestTokenExpiresAt: null,
          ...progress,
        },
      });
      if (reopened.count !== 1) return null;
      const approval = await client.postApproval.findFirst({
        where: { postId, organizationId: orgId },
      });
      // The new round starts from the then current flow: old stage rows and
      // any unused decision tokens of the previous round are dropped.
      await client.postApprovalStage.deleteMany({
        where: { approvalId: approval!.id, approval: { organizationId: orgId } },
      });
      await client.approvalActionToken.deleteMany({
        where: { approvalId: approval!.id, organizationId: orgId },
      });
      if (stageRows.length > 0) {
        await client.postApprovalStage.createMany({
          data: stageRows.map((r) => ({ ...r, approvalId: approval!.id })),
        });
      }
      return approval as PostApproval;
    };
    const reopenedApproval = this._tx
      ? await this._tx.model.$transaction((tx) => reopen(tx as any))
      : await reopen(this._approval.model as any);
    if (reopenedApproval) {
      return { approval: reopenedApproval, created: true };
    }
    try {
      const approval = await model.create({
        data: {
          postId,
          organizationId: orgId,
          status: 'PENDING',
          ...requester,
          ...progress,
          ...(stageRows.length > 0 ? { stages: { create: stageRows } } : {}),
        },
      });
      return { approval, created: true };
    } catch (error) {
      if ((error as { code?: string })?.code !== 'P2002') {
        throw error;
      }
      const approval = await model.findFirst({
        where: { postId, organizationId: orgId },
      });
      return { approval: approval!, created: false };
    }
  }

  getPending(orgId: string) {
    return this._approval.model.postApproval.findMany({
      where: { organizationId: orgId, status: 'PENDING' },
      orderBy: { requestedAt: 'desc' },
      include: {
        post: {
          select: {
            id: true,
            content: true,
            group: true,
            state: true,
            image: true,
            settings: true,
            publishDate: true,
            integration: {
              select: {
                id: true,
                name: true,
                providerIdentifier: true,
                picture: true,
              },
            },
          },
        },
        requestedBy: { select: { name: true, email: true } },
        stages: { orderBy: { position: 'asc' } },
      },
    });
  }

  // Explicit column list of the public API reads: the guest token columns and
  // the internal requester id are never selected, so they cannot leak.
  private static readonly PUBLIC_SELECT = {
    id: true,
    postId: true,
    status: true,
    note: true,
    requestedAt: true,
    resolvedAt: true,
    requestedByType: true,
    requestedByUserId: true,
    requestedByApiKeyId: true,
    requestedByOAuthClientId: true,
    approverId: true,
    decidedByType: true,
    decidedByApiKeyId: true,
    decidedByOAuthClientId: true,
    guestName: true,
    guestEmail: true,
    flowId: true,
    currentStage: true,
    stages: {
      orderBy: { position: 'asc' as const },
      select: {
        position: true,
        name: true,
        status: true,
        decidedByType: true,
        decidedByUserId: true,
        decidedByApiKeyId: true,
        decidedByOAuthClientId: true,
        decidedVia: true,
        decidedAt: true,
      },
    },
  };

  private static publicPost(withContent: boolean) {
    return {
      select: {
        ...(withContent ? { content: true } : {}),
        integration: {
          select: { id: true, name: true, providerIdentifier: true },
        },
      },
    };
  }

  private async attachFlows<T extends { flowId: string | null }>(
    orgId: string,
    rows: T[]
  ): Promise<Array<T & { flow: { id: string; name: string } | null }>> {
    const ids = [...new Set(rows.map((r) => r.flowId).filter((v): v is string => !!v))];
    const flows = ids.length
      ? await this._approval.model.approvalFlow.findMany({
          where: { organizationId: orgId, id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const byId = new Map(flows.map((f) => [f.id, f]));
    return rows.map((r) => ({ ...r, flow: r.flowId ? (byId.get(r.flowId) ?? null) : null }));
  }

  /**
   * Public API list: newest first by (requestedAt, id) with a keyset cursor.
   * Returns up to `take` rows; the service asks for limit + 1 to detect a next page.
   */
  async listForPublicApi(
    orgId: string,
    q: {
      status?: 'PENDING' | 'APPROVED' | 'REJECTED';
      since?: Date;
      cursor?: { requestedAt: Date; id: string };
      take: number;
    }
  ) {
    const rows = await this._approval.model.postApproval.findMany({
      where: {
        organizationId: orgId,
        ...(q.status ? { status: q.status } : {}),
        ...(q.since ? { requestedAt: { gte: q.since } } : {}),
        ...(q.cursor
          ? {
              AND: [
                {
                  OR: [
                    { requestedAt: { lt: q.cursor.requestedAt } },
                    { requestedAt: q.cursor.requestedAt, id: { lt: q.cursor.id } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: q.take,
      select: {
        ...ApprovalRepository.PUBLIC_SELECT,
        post: ApprovalRepository.publicPost(false),
      },
    });
    return this.attachFlows(orgId, rows);
  }

  /** One approval for the public API, with the post text (for the preview). */
  async getForPublicApi(orgId: string, id: string) {
    const row = await this._approval.model.postApproval.findFirst({
      where: { id, organizationId: orgId },
      select: {
        ...ApprovalRepository.PUBLIC_SELECT,
        post: ApprovalRepository.publicPost(true),
      },
    });
    if (!row) return null;
    return (await this.attachFlows(orgId, [row]))[0];
  }

  /**
   * One decision, one transaction. The stage row (when there is one) is
   * claimed with a conditional update on `status PENDING`; the approval row is
   * then moved on (next stage, or final) only while it is still PENDING at the
   * same stage. Anything that does not match rolls the whole transaction back
   * and reports `false`: that caller lost the race and must not act. A guest
   * decision also consumes its link token (hash match, unexpired) in the same
   * statement, so a link is single use.
   */
  async decideStageTx(p: StageDecisionWrite): Promise<boolean> {
    if (!this._tx) {
      throw new Error('PrismaTransaction is not available');
    }
    const now = new Date();
    const note = p.note;
    try {
      await this._tx.model.$transaction(async (tx) => {
        if (p.hasStageRow) {
          const staged = await tx.postApprovalStage.updateMany({
            where: {
              approvalId: p.approvalId,
              position: p.position,
              status: 'PENDING',
              approval: { organizationId: p.orgId },
            },
            data: {
              status: p.decision,
              decidedByType: p.actor ? p.actor.type : null,
              decidedByUserId: p.actor?.type === 'USER' ? p.actor.userId : null,
              decidedByApiKeyId:
                p.actor?.type === 'API_KEY' ? p.actor.apiKeyId : null,
              decidedByOAuthClientId:
                p.actor?.type === 'OAUTH_CLIENT' ? p.actor.oauthClientId : null,
              decidedVia: p.via,
              note: note === null ? null : note.slice(0, NOTE_MAX),
              decidedAt: now,
            },
          });
          if (staged.count !== 1) throw new LostRace();
        }
        const guestWhere = p.guestToken
          ? {
              guestTokenHash: hashGuestToken(p.guestToken),
              guestTokenExpiresAt: { gt: now },
            }
          : {};
        const consumeToken = p.guestToken
          ? { guestToken: null, guestTokenHash: null, guestTokenExpiresAt: null }
          : {};
        const approvalRes = await tx.postApproval.updateMany({
          where: {
            id: p.approvalId,
            organizationId: p.orgId,
            status: 'PENDING',
            currentStage: p.position,
            ...guestWhere,
          },
          data: p.final
            ? {
                status: p.decision,
                approverId: p.actor?.type === 'USER' ? p.actor.userId : null,
                ...decidedColumns(p.actor),
                decidedVia: p.via,
                note,
                resolvedAt: now,
                guestName: p.guest?.name ?? null,
                guestEmail: p.guest?.email ?? null,
                ...consumeToken,
              }
            : { currentStage: p.position + 1, ...consumeToken },
        });
        if (approvalRes.count !== 1) throw new LostRace();
      });
      return true;
    } catch (error) {
      if (error instanceof LostRace) return false;
      throw error;
    }
  }

  /**
   * Undo a final approval whose scheduling failed: the approval goes back to
   * PENDING (a guest link, when given, is restored) and the last stage row
   * back to PENDING. Only an APPROVED approval is touched.
   */
  async revertFinal(
    orgId: string,
    approvalId: string,
    position: number,
    hasStageRow: boolean,
    restoreGuest?: { tokenHash: string; expiresAt: Date }
  ): Promise<number> {
    if (!this._tx) {
      throw new Error('PrismaTransaction is not available');
    }
    return this._tx.model.$transaction(async (tx) => {
      const res = await tx.postApproval.updateMany({
        where: { id: approvalId, organizationId: orgId, status: 'APPROVED' },
        data: {
          status: 'PENDING',
          approverId: null,
          decidedByType: null,
          decidedByApiKeyId: null,
          decidedByOAuthClientId: null,
          decidedVia: null,
          note: null,
          resolvedAt: null,
          guestName: null,
          guestEmail: null,
          ...(restoreGuest
            ? {
                guestToken: null,
                guestTokenHash: restoreGuest.tokenHash,
                guestTokenExpiresAt: restoreGuest.expiresAt,
              }
            : {}),
        },
      });
      if (res.count === 1 && hasStageRow) {
        await tx.postApprovalStage.updateMany({
          where: {
            approvalId,
            position,
            status: 'APPROVED',
            approval: { organizationId: orgId },
          },
          data: CLEARED_STAGE_DECISION,
        });
      }
      return res.count;
    });
  }

  // --- Legacy single-stage primitives ---------------------------------
  // @deprecated The decision engine (ApprovalService.decide) uses
  // decideStageTx and revertFinal. `resolve`, `revertApproved`,
  // `resolveByGuestToken` and `revertGuestApproval` know nothing about stages
  // and must not be used for new code; they stay only for their specs and for
  // rollback compatibility and can be deleted in a follow up.

  // Conditional update (status must still be PENDING) guards against two admins
  // resolving the same approval concurrently. Returns the affected row count.
  async resolve(
    organizationId: string,
    id: string,
    approverId: string | null,
    status: ResolveStatus,
    note: string | null
  ) {
    const res = await this._approval.model.postApproval.updateMany({
      where: { id, organizationId, status: 'PENDING' },
      data: {
        status,
        approverId,
        decidedByType: approverId ? 'USER' : null,
        note,
        resolvedAt: new Date(),
      },
    });
    return res.count;
  }

  async revertApproved(organizationId: string, id: string, approverId: string) {
    const res = await this._approval.model.postApproval.updateMany({
      where: { id, organizationId, status: 'APPROVED', approverId },
      data: {
        status: 'PENDING',
        approverId: null,
        decidedByType: null,
        note: null,
        resolvedAt: null,
      },
    });
    return res.count;
  }

  // --- Guest (external reviewer) link ---------------------------------

  /** `tokenHash` is the SHA-256 hex of the token; the plaintext is never stored. */
  async setGuestToken(
    orgId: string,
    id: string,
    tokenHash: string,
    expiresAt: Date
  ) {
    const res = await this._approval.model.postApproval.updateMany({
      where: { id, organizationId: orgId },
      data: {
        guestTokenHash: tokenHash,
        guestToken: null,
        guestTokenExpiresAt: expiresAt,
      },
    });
    return res.count;
  }

  async revokeGuestToken(orgId: string, id: string) {
    const res = await this._approval.model.postApproval.updateMany({
      where: { id, organizationId: orgId },
      data: { guestTokenHash: null, guestToken: null, guestTokenExpiresAt: null },
    });
    return res.count;
  }

  /**
   * Public lookup, no org context, gated entirely by the unguessable token.
   * The presented token is hashed here; the plaintext column is never queried.
   */
  getByGuestToken(token: string) {
    return this._approval.model.postApproval.findFirst({
      where: {
        guestTokenHash: hashGuestToken(token),
        status: 'PENDING',
        guestTokenExpiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        note: true,
        organizationId: true,
        guestTokenExpiresAt: true,
        organization: { select: { name: true, logo: true } },
        requestedBy: { select: { email: true } },
        post: {
          select: {
            id: true,
            content: true,
            image: true,
            publishDate: true,
            integration: {
              select: { name: true, providerIdentifier: true, picture: true },
            },
          },
        },
      },
    });
  }

  /**
   * Atomically checks token hash + PENDING + not-expired, resolves, and
   * consumes the token (cleared in the same update): single use, no separate
   * step that could race between "check" and "consume".
   */
  async resolveByGuestToken(
    token: string,
    status: ResolveStatus,
    note: string | null,
    guest: { name: string; email: string } | null = null
  ) {
    const res = await this._approval.model.postApproval.updateMany({
      where: {
        guestTokenHash: hashGuestToken(token),
        status: 'PENDING',
        guestTokenExpiresAt: { gt: new Date() },
      },
      data: {
        status,
        approverId: null,
        decidedByType: null,
        guestName: guest?.name ?? null,
        guestEmail: guest?.email ?? null,
        note,
        resolvedAt: new Date(),
        guestToken: null,
        guestTokenHash: null,
        guestTokenExpiresAt: null,
      },
    });
    return res.count;
  }

  /** `tokenHash` is the stored hash to put back (see `hashGuestToken`). */
  async revertGuestApproval(
    organizationId: string,
    id: string,
    tokenHash: string,
    expiresAt: Date
  ) {
    const res = await this._approval.model.postApproval.updateMany({
      where: {
        id,
        organizationId,
        status: 'APPROVED',
        approverId: null,
        guestTokenHash: null,
      },
      data: {
        status: 'PENDING',
        note: null,
        resolvedAt: null,
        guestName: null,
        guestEmail: null,
        guestToken: null,
        guestTokenHash: tokenHash,
        guestTokenExpiresAt: expiresAt,
      },
    });
    return res.count;
  }
}
