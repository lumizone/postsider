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
      select: { id: true, state: true, parentPostId: true, group: true },
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
            integration: { select: { name: true, providerIdentifier: true } },
          },
        },
        requestedBy: { select: { name: true, email: true } },
      },
    });
  }

  // Conditional update (status must still be PENDING) guards against two admins
  // resolving the same approval concurrently. Returns the affected row count.
  async resolve(
    id: string,
    approverId: string,
    status: ResolveStatus,
    note: string | null
  ) {
    const res = await this._approval.model.postApproval.updateMany({
      where: { id, status: 'PENDING' },
      data: { status, approverId, note, resolvedAt: new Date() },
    });
    return res.count;
  }
}
