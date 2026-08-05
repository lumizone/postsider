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
    // Distinguish pending-approval posts from plain drafts in the calendar and
    // filters. The State.APPROVAL enum was unused before — now it means "draft
    // that is waiting for approval" so calendars and lists can surface them.
    await this._posts.setPostState(orgId, postId, 'APPROVAL' as any);
    // In-app notification for everyone in the org (badge/dropdown) + email to
    // the org's approvers so a pending review doesn't sit unseen.
    await this._notifications.inAppNotification(
      orgId,
      'Approval requested',
      'A post has been submitted for approval.'
    );
    await this._notifications.notifyApprovers(
      orgId,
      'New post awaiting approval',
      'A post has been submitted for approval and is waiting in the approval queue.'
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
    // Also email the original requester so they know the post moved to the queue
    // without having to check the app.
    const requesterEmail = (approval as any)?.requestedBy?.email;
    if (requesterEmail) {
      try {
        await this._notifications.sendEmail(
          requesterEmail,
          'Post approved',
          'Your post has been approved and is now scheduled for publishing.'
        );
      } catch {} // non-critical
    }
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
    // Reset post state to DRAFT so the author can edit and resubmit.
    // (State.APPROVAL was set in requestApproval — rejection restores it.)
    await this._posts.setPostState(orgId, approval!.postId, 'DRAFT' as any);
    await this._notifications.inAppNotification(
      orgId,
      'Post rejected',
      note ? `A post was rejected: ${note}` : 'A post was rejected.'
    );
    // Email the original requester about the rejection + feedback.
    const requesterEmail = (approval as any)?.requestedBy?.email;
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
    return { rejected: true, postId: approval!.postId };
  }
}
