import { Injectable } from '@nestjs/common';
import { PostApproval } from '@prisma/client';
import { actorToColumns, PostActor } from '@postsider/nestjs-libraries/actor/post-actor';
import { hashGuestToken } from '@postsider/nestjs-libraries/database/prisma/approval/guest-token';
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
    actor: PostActor
  ): Promise<{ approval: PostApproval; created: boolean }> {
    const model = this._approval.model.postApproval;
    const requester = {
      requestedById,
      ...actorToColumns(actor, 'requestedBy'),
    };
    // A resolved approval starts a fresh round: any guest link from the prior
    // round pointed at now-stale content and must stop working.
    const reopened = await model.updateMany({
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
        note: null,
        guestName: null,
        guestEmail: null,
        resolvedAt: null,
        guestToken: null,
        guestTokenHash: null,
        guestTokenExpiresAt: null,
      },
    });
    if (reopened.count === 1) {
      const approval = await model.findFirst({
        where: { postId, organizationId: orgId },
      });
      return { approval: approval!, created: true };
    }
    try {
      const approval = await model.create({
        data: {
          postId,
          organizationId: orgId,
          status: 'PENDING',
          ...requester,
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
