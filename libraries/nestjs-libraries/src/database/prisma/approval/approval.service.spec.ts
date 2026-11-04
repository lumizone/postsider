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
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';

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
      {} as any,
      { deliver: jest.fn() } as any
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
      null,
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

describe('ApprovalService public webhook events', () => {
  it('emits approval.requested after the approval state is committed', async () => {
    const repo = {
      getPost: jest.fn().mockResolvedValue({
        state: 'DRAFT',
        parentPostId: null,
        integrationId: 'channel-1',
      }),
      openRequest: jest
        .fn()
        .mockResolvedValue({ approval: { id: 'approval-1' }, created: true }),
    };
    const posts = { setPostState: jest.fn().mockResolvedValue(undefined) };
    const notifications = {
      inAppNotification: jest.fn().mockResolvedValue(undefined),
      notifyApprovers: jest.fn().mockResolvedValue(undefined),
    };
    const delivery = { deliver: jest.fn().mockResolvedValue(undefined) };
    const service = new ApprovalService(
      repo as any,
      posts as any,
      notifications as any,
      {} as any,
      delivery as any
    );

    await service.requestApproval('org-1', 'post-1', 'user-1');

    expect(posts.setPostState).toHaveBeenCalledWith(
      'org-1',
      'post-1',
      'APPROVAL'
    );
    expect(delivery.deliver).toHaveBeenCalledWith(
      'org-1',
      'approval.requested',
      expect.objectContaining({
        approvalId: 'approval-1',
        postId: 'post-1',
        status: 'PENDING',
      })
    );
  });

  it('does not roll back an approval when webhook delivery fails', async () => {
    const repo = {
      getPost: jest.fn().mockResolvedValue({
        state: 'DRAFT',
        parentPostId: null,
        integrationId: 'channel-1',
      }),
      openRequest: jest
        .fn()
        .mockResolvedValue({ approval: { id: 'approval-1' }, created: true }),
    };
    const service = new ApprovalService(
      repo as any,
      { setPostState: jest.fn().mockResolvedValue(undefined) } as any,
      {
        inAppNotification: jest.fn().mockResolvedValue(undefined),
        notifyApprovers: jest.fn().mockResolvedValue(undefined),
      } as any,
      {} as any,
      {
        deliver: jest.fn().mockRejectedValue(new Error('callback down')),
      } as any
    );

    await expect(
      service.requestApproval('org-1', 'post-1', 'user-1')
    ).resolves.toEqual({ id: 'approval-1', created: true });
  });
});

describe('ApprovalService attribution and idempotent request', () => {
  const build = (opening: { approval: any; created: boolean }, postState = 'DRAFT') => {
    const repo = {
      getPost: jest.fn().mockResolvedValue({
        state: postState,
        parentPostId: null,
        integrationId: 'channel-1',
      }),
      openRequest: jest.fn().mockResolvedValue(opening),
      resolveByGuestToken: jest.fn().mockResolvedValue(1),
      getByGuestToken: jest.fn().mockResolvedValue({
        id: 'approval-1',
        organizationId: 'org-1',
        guestTokenExpiresAt: new Date(),
        requestedBy: { email: 'a@b.co' },
        post: { id: 'post-1' },
      }),
      resolve: jest.fn().mockResolvedValue(1),
      getById: jest.fn().mockResolvedValue({
        id: 'approval-1',
        postId: 'post-1',
        status: 'PENDING',
      }),
    };
    const posts = {
      setPostState: jest.fn().mockResolvedValue(undefined),
      changePostStatus: jest.fn().mockResolvedValue(undefined),
    };
    const notifications = {
      inAppNotification: jest.fn().mockResolvedValue(undefined),
      notifyApprovers: jest.fn().mockResolvedValue(undefined),
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    const organizations = {
      getAllUsersOrgs: jest.fn().mockResolvedValue({
        users: [
          { role: 'USER', user: { id: 'u-plain' } },
          { role: 'SUPERADMIN', user: { id: 'u-super' } },
        ],
      }),
    };
    const delivery = { deliver: jest.fn().mockResolvedValue(undefined) };
    const service = new ApprovalService(
      repo as any,
      posts as any,
      notifications as any,
      organizations as any,
      delivery as any
    );
    return { service, repo, posts, notifications, delivery };
  };

  it('passes the OAuth actor (with the authorizing user) to openRequest', async () => {
    const { service, repo } = build({ approval: { id: 'a1' }, created: true });
    const actor = { type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u7' } as const;
    await runWithActor(actor, () => service.requestApproval('org-1', 'post-1', 'u7'));
    expect(repo.openRequest).toHaveBeenCalledWith('org-1', 'post-1', 'u7', actor);
  });

  it('API request keeps the SUPERADMIN for routing but attributes the API key', async () => {
    const { service, repo } = build({ approval: { id: 'a1' }, created: true });
    const actor = { type: 'API_KEY', apiKeyId: 'k1' } as const;
    await runWithActor(actor, () => service.requestApprovalFromApi('org-1', 'post-1'));
    expect(repo.openRequest).toHaveBeenCalledWith('org-1', 'post-1', 'u-super', actor);
  });

  it('a retried request on an open approval has no side effects', async () => {
    const { service, posts, notifications, delivery } = build(
      { approval: { id: 'a1', status: 'PENDING' }, created: false },
      'APPROVAL'
    );
    const result = await service.requestApproval('org-1', 'post-1', 'u1');
    expect(result).toMatchObject({ id: 'a1', created: false });
    expect(posts.setPostState).not.toHaveBeenCalled();
    expect(notifications.inAppNotification).not.toHaveBeenCalled();
    expect(notifications.notifyApprovers).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('heals a DRAFT post under a pending approval without notifying', async () => {
    const { service, posts, notifications, delivery } = build(
      { approval: { id: 'a1', status: 'PENDING' }, created: false },
      'DRAFT'
    );
    await service.requestApproval('org-1', 'post-1', 'u1');
    expect(posts.setPostState).toHaveBeenCalledTimes(1);
    expect(posts.setPostState).toHaveBeenCalledWith('org-1', 'post-1', 'APPROVAL');
    expect(notifications.inAppNotification).not.toHaveBeenCalled();
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('a new request runs every side effect once', async () => {
    const { service, posts, notifications, delivery } = build({
      approval: { id: 'a1', status: 'PENDING' },
      created: true,
    });
    const result = await service.requestApproval('org-1', 'post-1', 'u1');
    expect(result.created).toBe(true);
    expect(posts.setPostState).toHaveBeenCalledTimes(1);
    expect(notifications.inAppNotification).toHaveBeenCalledTimes(1);
    expect(notifications.notifyApprovers).toHaveBeenCalledTimes(1);
    expect(delivery.deliver).toHaveBeenCalledTimes(1);
  });

  it('forwards the guest identity to resolveByGuestToken', async () => {
    const { service, repo } = build({ approval: { id: 'a1' }, created: true });
    const guest = { name: 'Ann', email: 'a@b.co' };
    await service.resolveGuestReview('tok', 'reject', 'no', guest);
    expect(repo.resolveByGuestToken).toHaveBeenCalledWith('tok', 'REJECTED', 'no', guest);
  });

  it('approve still resolves and emits the webhook', async () => {
    const { service, repo, delivery } = build({ approval: { id: 'a1' }, created: true });
    await service.approve('org-1', 'approval-1', 'u9', 'ADMIN');
    expect(repo.resolve).toHaveBeenCalledWith('org-1', 'approval-1', 'u9', 'APPROVED', null);
    expect(delivery.deliver).toHaveBeenCalledWith('org-1', 'approval.resolved', expect.objectContaining({ status: 'APPROVED' }));
  });
});
