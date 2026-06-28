import { BadRequestException, Injectable } from '@nestjs/common';
import { ApprovalRepository } from './approval.repository';
import {
  assertCanApprove,
  assertPending,
  assertRequestable,
} from './approval.rules';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';

@Injectable()
export class ApprovalService {
  constructor(
    private _repo: ApprovalRepository,
    private _posts: PostsService,
    private _notifications: NotificationService
  ) {}

  async requestApproval(orgId: string, postId: string, requestedById: string) {
    const post = await this._repo.getPost(orgId, postId);
    assertRequestable(post);
    const approval = await this._repo.upsertRequest(orgId, postId, requestedById);
    await this._notifications.inAppNotification(
      orgId,
      'Approval requested',
      'A post has been submitted for approval.'
    );
    return approval;
  }

  getPending(orgId: string) {
    return this._repo.getPending(orgId);
  }

  getForPost(orgId: string, postId: string) {
    return this._repo.getApprovalByPost(orgId, postId);
  }

  async approve(
    orgId: string,
    approvalId: string,
    approverId: string,
    role: string
  ) {
    assertCanApprove(role);
    const approval = await this._repo.getById(orgId, approvalId);
    assertPending(approval);
    const count = await this._repo.resolve(
      approvalId,
      approverId,
      'APPROVED',
      null
    );
    if (!count) {
      throw new BadRequestException('This approval has already been resolved');
    }
    // Flip the draft to a scheduled (QUEUE) post and start its workflow.
    await this._posts.changePostStatus(orgId, approval!.postId, 'schedule');
    await this._notifications.inAppNotification(
      orgId,
      'Post approved',
      'A post was approved and scheduled.'
    );
    return { approved: true, postId: approval!.postId };
  }

  async reject(
    orgId: string,
    approvalId: string,
    approverId: string,
    role: string,
    note?: string
  ) {
    assertCanApprove(role);
    const approval = await this._repo.getById(orgId, approvalId);
    assertPending(approval);
    const count = await this._repo.resolve(
      approvalId,
      approverId,
      'REJECTED',
      note ?? null
    );
    if (!count) {
      throw new BadRequestException('This approval has already been resolved');
    }
    // The post stays a DRAFT so the author can edit and resubmit.
    await this._notifications.inAppNotification(
      orgId,
      'Post rejected',
      note ? `A post was rejected: ${note}` : 'A post was rejected.'
    );
    return { rejected: true, postId: approval!.postId };
  }
}
