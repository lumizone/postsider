import { BadRequestException, Injectable } from '@nestjs/common';
import { ApprovalRepository } from './approval.repository';
import {
  assertCanApprove,
  assertPending,
  assertRequestable,
} from './approval.rules';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { randomBytes } from 'crypto';

const GUEST_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

@Injectable()
export class ApprovalService {
  constructor(
    private _repo: ApprovalRepository,
    private _posts: PostsService,
    private _notifications: NotificationService,
    private _organizations: OrganizationRepository
  ) {}

  /**
   * Public-API entry point (agency content-gen pipelines, n8n, etc.): no
   * session user exists to attribute the request to, so it's attributed to
   * the org's own SUPERADMIN (falling back to any ADMIN, then any member) —
   * "the org itself, via API" rather than a specific human.
   */
  async requestApprovalFromApi(orgId: string, postId: string) {
    const requestedById = await this.resolveApiRequester(orgId);
    return this.requestApproval(orgId, postId, requestedById);
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
      'A post has been submitted for approval and is waiting in the approval queue.',
      post?.integrationId
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
      orgId,
      approvalId,
      approverId,
      'APPROVED',
      null
    );
    if (!count) {
      throw new BadRequestException('This approval has already been resolved');
    }
    await this.onApproved(
      orgId,
      approval!.postId,
      (approval as any)?.requestedBy?.email
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
      orgId,
      approvalId,
      approverId,
      'REJECTED',
      note ?? null
    );
    if (!count) {
      throw new BadRequestException('This approval has already been resolved');
    }
    await this.onRejected(
      orgId,
      approval!.postId,
      note ?? null,
      (approval as any)?.requestedBy?.email
    );
    return { rejected: true, postId: approval!.postId };
  }

  // --- Guest (external reviewer) link ----------------------------------
  //
  // Lets an ADMIN/SUPERADMIN hand a specific pending approval to someone
  // WITHOUT a PostSider account (e.g. the agency's own client) — a common
  // agency ask: the client shouldn't need a paid seat just to say yes/no to
  // a post. No approval gets a link unless an admin explicitly creates one;
  // nothing here changes the normal in-app approve/reject flow.

  async createGuestLink(orgId: string, approvalId: string, role: string) {
    assertCanApprove(role);
    const approval = await this._repo.getById(orgId, approvalId);
    assertPending(approval);
    const token = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + GUEST_LINK_TTL_MS);
    const count = await this._repo.setGuestToken(
      orgId,
      approvalId,
      token,
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
      throw new BadRequestException('This review link is invalid or has expired.');
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
    note?: string
  ) {
    const approval = await this._repo.getByGuestToken(token);
    if (!approval) {
      throw new BadRequestException('This review link is invalid or has expired.');
    }
    const status = action === 'approve' ? 'APPROVED' : 'REJECTED';
    const count = await this._repo.resolveByGuestToken(
      token,
      status,
      note ?? null
    );
    if (!count) {
      // Lost a race with the admin resolving it in-app, or the link was
      // already used — never resolve the same request twice.
      throw new BadRequestException('This review link has already been used.');
    }
    const requesterEmail = (approval as any)?.requestedBy?.email;
    if (action === 'approve') {
      await this.onApproved(approval.organizationId, approval.post.id, requesterEmail);
    } else {
      await this.onRejected(
        approval.organizationId,
        approval.post.id,
        note ?? null,
        requesterEmail
      );
    }
    // `action + 'd'` produced "rejectd" for rejections (and only worked at all
    // for "approve"). Callers branch on this, so spell both keys out.
    return action === 'approve'
      ? { approved: true }
      : ({ rejected: true } as Record<string, boolean>);
  }

  private async onApproved(
    orgId: string,
    postId: string,
    requesterEmail?: string
  ) {
    // Flip the draft to a scheduled (QUEUE) post and start its workflow.
    // allowApprovalTransition=true: the caller chain (assertCanApprove +
    // assertPending, above) already authorized moving this specific post out
    // of APPROVAL — see changePostStatus's guard comment.
    await this._posts.changePostStatus(orgId, postId, 'schedule', true);
    await this._notifications.inAppNotification(
      orgId,
      'Post approved',
      'A post was approved and scheduled.'
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
      note ? `A post was rejected: ${note}` : 'A post was rejected.'
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
