import { Injectable } from '@nestjs/common';
import { NotificationsRepository } from '@postsider/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@postsider/nestjs-libraries/services/email.service';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import { organizationId } from '@postsider/nestjs-libraries/temporal/temporal.search.attribute';
import { ChannelAssignmentService } from '@postsider/nestjs-libraries/database/prisma/channel-assignment/channel-assignment.service';

export type NotificationType = 'success' | 'fail' | 'info';

/**
 * Fallback destination for events whose producer passes no link.
 *
 * The publish-failure notifications are raised from inside a Temporal
 * workflow, and workflow code must never be edited in place (running
 * executions replay against it), so the link is filled in here — in activity
 * /service code — instead. Without it the two most actionable notifications
 * in the product ("we could not publish, the channel needs reconnecting")
 * were the only ones with no way to act on them.
 */
const DEFAULT_EVENT_LINKS: Record<string, string> = {
  postFailedReconnect: '/calendar',
  postFailedDisabled: '/calendar',
};

@Injectable()
export class NotificationService {
  constructor(
    private _notificationRepository: NotificationsRepository,
    private _emailService: EmailService,
    private _organizationRepository: OrganizationRepository,
    private _temporalService: TemporalService,
    private _channelAssignments: ChannelAssignmentService
  ) {}

  getMainPageCount(organizationId: string, userId: string) {
    return this._notificationRepository.getMainPageCount(
      organizationId,
      userId
    );
  }

  getNotificationsPaginated(organizationId: string, page: number) {
    return this._notificationRepository.getNotificationsPaginated(
      organizationId,
      page
    );
  }

  getNotificationsPageForUser(
    organizationId: string,
    userId: string,
    page: number
  ) {
    return this._notificationRepository.getNotificationsPageForUser(
      organizationId,
      userId,
      page
    );
  }

  clearNotifications(organizationId: string) {
    return this._notificationRepository.clearNotifications(organizationId);
  }

  getNotifications(organizationId: string, userId: string) {
    return this._notificationRepository.getNotifications(
      organizationId,
      userId
    );
  }

  async inAppNotification(
    orgId: string,
    subject: string,
    message: string,
    sendEmail = false,
    digest = false,
    type: NotificationType = 'success',
    link?: string,
    // Structured twin of `message`, so the dashboard can show it in the
    // customer's language. The email still uses the English `message`.
    event?: { key: string; params?: Record<string, string> }
  ) {
    const fallback = event?.key ? DEFAULT_EVENT_LINKS[event.key] : undefined;
    await this._notificationRepository.createNotification(
      orgId,
      message,
      link || (fallback ? `${process.env.FRONTEND_URL}${fallback}` : undefined),
      event
    );
    if (!sendEmail) {
      return;
    }

    if (digest) {
      try {
        await this._temporalService.client
          .getRawClient()
          ?.workflow.signalWithStart('digestEmailWorkflow', {
            workflowId: 'digest_email_workflow_' + orgId,
            signal: 'email',
            signalArgs: [
              [
                {
                  title: subject,
                  message,
                  type,
                },
              ],
            ],
            taskQueue: 'main',
            workflowIdConflictPolicy: 'USE_EXISTING',
            args: [{ organizationId: orgId }],
            typedSearchAttributes: new TypedSearchAttributes([
              {
                key: organizationId,
                value: orgId,
              },
            ]),
          });
      } catch (err) {}

      return;
    }

    await this.sendEmailsToOrg(orgId, subject, message, type);
  }

  /**
   * Email only the org's approvers (ADMIN/SUPERADMIN) — used when a new post
   * lands in the approval queue so the right people get pinged.
   *
   * When `integrationId` is given and that channel has explicit
   * ChannelAssignment rows, only ASSIGNED approvers are emailed — an agency
   * with 50 client channels and 10 staff no longer pings everyone for every
   * client's approval request. No assignments for that channel (the
   * default) falls back to every org approver, unchanged.
   */
  async notifyApprovers(
    orgId: string,
    subject: string,
    message: string,
    integrationId?: string
  ) {
    const userOrg = await this._organizationRepository.getAllUsersOrgs(orgId);
    let approvers = (userOrg?.users || []).filter(
      (u: any) => u.role === 'ADMIN' || u.role === 'SUPERADMIN'
    );
    if (integrationId) {
      const assigned = await this._channelAssignments.listForIntegration(
        orgId,
        integrationId
      );
      if (assigned.length > 0) {
        const assignedIds = new Set(assigned.map((a) => a.userId));
        const scoped = approvers.filter((a: any) => assignedIds.has(a.user.id));
        // Only narrow if at least one assigned user is ALSO an approver —
        // otherwise a channel assigned to non-admin staff would silently
        // notify nobody about a request only an admin can actually resolve.
        if (scoped.length > 0) approvers = scoped;
      }
    }
    for (const member of approvers) {
      if (member?.user?.sendSuccessEmails === false) continue;
      await this.sendEmail(member.user.email, subject, message);
    }
  }

  async sendEmailsToOrg(
    orgId: string,
    subject: string,
    message: string,
    type?: NotificationType
  ) {
    const userOrg = await this._organizationRepository.getAllUsersOrgs(orgId);
    for (const user of userOrg?.users || []) {
      // 'info' type is always sent regardless of preferences
      if (type !== 'info') {
        // Filter users based on their email preferences
        if (type === 'success' && !user.user.sendSuccessEmails) {
          continue;
        }
        if (type === 'fail' && !user.user.sendFailureEmails) {
          continue;
        }
      }
      await this.sendEmail(user.user.email, subject, message);
    }
  }

  async sendEmail(to: string, subject: string, html: string, replyTo?: string) {
    await this._emailService.sendEmail(to, subject, html, 'top', replyTo);
  }

  hasEmailProvider() {
    return this._emailService.hasProvider();
  }
}
