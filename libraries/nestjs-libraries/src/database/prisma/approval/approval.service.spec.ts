jest.mock('./approval.repository', () => ({ ApprovalRepository: jest.fn() }));
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

import {
  assertCanApprove,
  assertPending,
  assertRequestable,
} from './approval.rules';
import { ApprovalService } from './approval.service';

describe('assertRequestable', () => {
  it('throws when the post does not exist', () => {
    expect(() => assertRequestable(null)).toThrow();
  });
  it('throws when the post is not a DRAFT', () => {
    expect(() =>
      assertRequestable({ state: 'QUEUE', parentPostId: null })
    ).toThrow();
  });
  it('throws for a child (thread) post', () => {
    expect(() =>
      assertRequestable({ state: 'DRAFT', parentPostId: 'x' })
    ).toThrow();
  });
  it('passes for a top-level DRAFT', () => {
    expect(() =>
      assertRequestable({ state: 'DRAFT', parentPostId: null })
    ).not.toThrow();
  });
});

describe('assertCanApprove', () => {
  it('forbids a regular USER', () => {
    expect(() => assertCanApprove('USER')).toThrow();
  });
  it('allows ADMIN and SUPERADMIN', () => {
    expect(() => assertCanApprove('ADMIN')).not.toThrow();
    expect(() => assertCanApprove('SUPERADMIN')).not.toThrow();
  });
});

describe('assertPending', () => {
  it('throws when the approval is missing', () => {
    expect(() => assertPending(null)).toThrow();
  });
  it('throws when already resolved', () => {
    expect(() => assertPending({ status: 'APPROVED' })).toThrow();
  });
  it('passes when still pending', () => {
    expect(() => assertPending({ status: 'PENDING' })).not.toThrow();
  });
});

describe('ApprovalService approval compensation', () => {
  const createService = () => {
    const schedulingError = new Error('workflow start failed');
    const guestTokenExpiresAt = new Date('2026-09-06T12:00:00.000Z');
    const repo = {
      getById: jest.fn().mockResolvedValue({
        id: 'approval-1',
        postId: 'post-1',
        status: 'PENDING',
        requestedBy: { email: 'author@example.com' },
      }),
      resolve: jest.fn().mockResolvedValue(1),
      revertApproved: jest.fn().mockResolvedValue(1),
      getByGuestToken: jest.fn().mockResolvedValue({
        id: 'approval-1',
        status: 'PENDING',
        organizationId: 'org-1',
        guestTokenExpiresAt,
        requestedBy: { email: 'author@example.com' },
        post: { id: 'post-1' },
      }),
      resolveByGuestToken: jest.fn().mockResolvedValue(1),
      revertGuestApproval: jest.fn().mockResolvedValue(1),
    };
    const posts = {
      changePostStatus: jest.fn().mockRejectedValue(schedulingError),
    };
    const notifications = {
      inAppNotification: jest.fn(),
      sendEmail: jest.fn(),
    };
    const service = new ApprovalService(
      repo as any,
      posts as any,
      notifications as any,
      {} as any
    );
    return {
      service,
      repo,
      posts,
      notifications,
      schedulingError,
      guestTokenExpiresAt,
    };
  };

  it('reverts an authenticated approval to pending when scheduling fails', async () => {
    const { service, repo, notifications, schedulingError } = createService();

    await expect(
      service.approve('org-1', 'approval-1', 'approver-1', 'ADMIN')
    ).rejects.toBe(schedulingError);

    expect(repo.resolve).toHaveBeenCalledWith(
      'org-1',
      'approval-1',
      'approver-1',
      'APPROVED',
      null
    );
    expect(repo.revertApproved).toHaveBeenCalledWith(
      'org-1',
      'approval-1',
      'approver-1'
    );
    expect(notifications.inAppNotification).not.toHaveBeenCalled();
  });

  it('reverts a guest approval and restores its token when scheduling fails', async () => {
    const {
      service,
      repo,
      notifications,
      schedulingError,
      guestTokenExpiresAt,
    } = createService();

    await expect(
      service.resolveGuestReview('guest-token', 'approve')
    ).rejects.toBe(schedulingError);

    expect(repo.resolveByGuestToken).toHaveBeenCalledWith(
      'guest-token',
      'APPROVED',
      null
    );
    expect(repo.revertGuestApproval).toHaveBeenCalledWith(
      'org-1',
      'approval-1',
      'guest-token',
      guestTokenExpiresAt
    );
    expect(notifications.inAppNotification).not.toHaveBeenCalled();
  });
});
