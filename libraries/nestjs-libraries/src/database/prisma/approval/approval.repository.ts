import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

type ResolveStatus = 'APPROVED' | 'REJECTED';

@Injectable()
export class ApprovalRepository {
  constructor(
    private _approval: PrismaRepository<'postApproval'>,
    private _post: PrismaRepository<'post'>
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
      },
    });
  }

  getApprovalByPost(orgId: string, postId: string) {
    // Scope by organization so one org can never read another org's approval.
    return this._approval.model.postApproval.findFirst({
      where: { postId, organizationId: orgId },
    });
  }

  getById(orgId: string, id: string) {
    return this._approval.model.postApproval.findFirst({
      where: { id, organizationId: orgId },
      include: { requestedBy: { select: { email: true, name: true } } },
    });
  }

  // Upsert so a previously rejected post can be re-submitted without piling up
  // duplicate rows (postId is unique).
  upsertRequest(orgId: string, postId: string, requestedById: string) {
    return this._approval.model.postApproval.upsert({
      where: { postId },
      update: {
        status: 'PENDING',
        requestedById,
        approverId: null,
        note: null,
        requestedAt: new Date(),
        resolvedAt: null,
        // A resubmit is a fresh round — any link from a prior round pointed
        // at now-stale content/decision and must stop working.
        guestToken: null,
        guestTokenExpiresAt: null,
      },
      create: { postId, organizationId: orgId, requestedById, status: 'PENDING' },
    });
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
            integration: { select: { id: true, name: true, providerIdentifier: true } },
          },
        },
        requestedBy: { select: { name: true, email: true } },
      },
    });
  }

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
      data: { status, approverId, note, resolvedAt: new Date() },
    });
    return res.count;
  }

  // --- Guest (external reviewer) link ---------------------------------

  async setGuestToken(
    orgId: string,
    id: string,
    token: string,
    expiresAt: Date
  ) {
    const res = await this._approval.model.postApproval.updateMany({
      where: { id, organizationId: orgId },
      data: { guestToken: token, guestTokenExpiresAt: expiresAt },
    });
    return res.count;
  }

  async revokeGuestToken(orgId: string, id: string) {
    const res = await this._approval.model.postApproval.updateMany({
      where: { id, organizationId: orgId },
      data: { guestToken: null, guestTokenExpiresAt: null },
    });
    return res.count;
  }

  /** Public lookup — no org context, gated entirely by the unguessable token. */
  getByGuestToken(token: string) {
    return this._approval.model.postApproval.findFirst({
      where: {
        guestToken: token,
        status: 'PENDING',
        guestTokenExpiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        note: true,
        organizationId: true,
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
   * Atomically checks token + PENDING + not-expired, resolves, and consumes
   * the token (cleared in the same update) — single-use, no separate step
   * that could race between "check" and "consume".
   */
  async resolveByGuestToken(
    token: string,
    status: ResolveStatus,
    note: string | null
  ) {
    const res = await this._approval.model.postApproval.updateMany({
      where: {
        guestToken: token,
        status: 'PENDING',
        guestTokenExpiresAt: { gt: new Date() },
      },
      data: {
        status,
        approverId: null,
        note,
        resolvedAt: new Date(),
        guestToken: null,
        guestTokenExpiresAt: null,
      },
    });
    return res.count;
  }
}
