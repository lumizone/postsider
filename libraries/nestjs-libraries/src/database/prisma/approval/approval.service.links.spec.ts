jest.mock('./approval.repository', () => ({ ApprovalRepository: jest.fn() }));
jest.mock('./approval-link.service', () => ({ ApprovalLinkService: jest.fn() }));
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: jest.fn() })
);
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: jest.fn() })
);
jest.mock(
  '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository',
  () => ({ OrganizationRepository: jest.fn() })
);
jest.mock('@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-delivery.service', () => ({ PublicWebhookDeliveryService: jest.fn() }));

import { ApprovalService } from './approval.service';

describe('ApprovalService.onStageOpened with approver links', () => {
  const original = process.env.APPROVAL_EMAIL_LINKS;
  afterEach(() => {
    if (original === undefined) delete process.env.APPROVAL_EMAIL_LINKS;
    else process.env.APPROVAL_EMAIL_LINKS = original;
  });

  const build = (links?: { sendStageEmails: jest.Mock }) => {
    const notifications = {
      inAppNotification: jest.fn().mockResolvedValue(undefined),
      notifyApprovers: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ApprovalService(
      {} as any,
      {} as any,
      notifications as any,
      {} as any,
      {} as any,
      undefined,
      undefined,
      links as any
    );
    const open = () =>
      (service as any).onStageOpened(
        'org-1',
        { id: 'a1' },
        { position: 1, total: 1, name: 'Approval' },
        { integrationId: 'i1' }
      );
    return { notifications, open };
  };

  it('unset flag: plain approver email, no link service call', async () => {
    delete process.env.APPROVAL_EMAIL_LINKS;
    const links = { sendStageEmails: jest.fn() };
    const { notifications, open } = build(links);
    await open();
    expect(notifications.notifyApprovers).toHaveBeenCalledTimes(1);
    expect(notifications.inAppNotification).toHaveBeenCalledTimes(1);
    expect(links.sendStageEmails).not.toHaveBeenCalled();
  });

  it('flag true but not exactly "true" behaves as off', async () => {
    process.env.APPROVAL_EMAIL_LINKS = '1';
    const links = { sendStageEmails: jest.fn() };
    const { notifications, open } = build(links);
    await open();
    expect(links.sendStageEmails).not.toHaveBeenCalled();
    expect(notifications.notifyApprovers).toHaveBeenCalledTimes(1);
  });

  it('flag true: links replace the plain email, in-app notification stays', async () => {
    process.env.APPROVAL_EMAIL_LINKS = 'true';
    const links = { sendStageEmails: jest.fn().mockResolvedValue(true) };
    const { notifications, open } = build(links);
    await open();
    expect(links.sendStageEmails).toHaveBeenCalledWith(
      'org-1',
      { id: 'a1' },
      { position: 1, total: 1, name: 'Approval' }
    );
    expect(notifications.notifyApprovers).not.toHaveBeenCalled();
    expect(notifications.inAppNotification).toHaveBeenCalledTimes(1);
  });

  it('flag true but links could not be produced: falls back to the plain email', async () => {
    process.env.APPROVAL_EMAIL_LINKS = 'true';
    const links = { sendStageEmails: jest.fn().mockResolvedValue(false) };
    const { notifications, open } = build(links);
    await open();
    expect(notifications.notifyApprovers).toHaveBeenCalledTimes(1);
  });

  it('flag true without the link service injected: plain email', async () => {
    process.env.APPROVAL_EMAIL_LINKS = 'true';
    const { notifications, open } = build(undefined);
    await open();
    expect(notifications.notifyApprovers).toHaveBeenCalledTimes(1);
  });
});
