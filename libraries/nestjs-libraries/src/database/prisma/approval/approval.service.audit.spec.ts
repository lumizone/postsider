jest.mock('./approval.repository', () => ({ ApprovalRepository: jest.fn() }));
jest.mock('@postsider/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: jest.fn() }));
jest.mock('@postsider/nestjs-libraries/database/prisma/notifications/notification.service', () => ({
  NotificationService: jest.fn(),
}));
jest.mock('@postsider/nestjs-libraries/database/prisma/organizations/organization.repository', () => ({
  OrganizationRepository: jest.fn(),
}));

import { ApprovalService } from './approval.service';

function build(created: boolean) {
  const repo: any = {
    getPost: jest.fn().mockResolvedValue({ id: 'p1', state: 'DRAFT', parentPostId: null, integrationId: 'c1' }),
    openRequest: jest.fn().mockResolvedValue({ approval: { id: 'ap1', status: 'PENDING' }, created }),
    getById: jest.fn().mockResolvedValue({ id: 'ap1', postId: 'p1', status: 'PENDING' }),
    decideStageTx: jest.fn().mockResolvedValue(true),
    revertFinal: jest.fn().mockResolvedValue(1),
    getByGuestToken: jest.fn().mockResolvedValue({
      id: 'ap1',
      organizationId: 'o1',
      post: { id: 'p1' },
      guestTokenExpiresAt: new Date(),
    }),
  };
  const posts: any = {
    setPostState: jest.fn().mockResolvedValue(undefined),
    changePostStatus: jest.fn().mockResolvedValue(undefined),
  };
  const notifications: any = {
    inAppNotification: jest.fn().mockResolvedValue(undefined),
    notifyApprovers: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { logResourceEvent: jest.fn().mockResolvedValue(undefined) };
  const svc = new ApprovalService(
    repo,
    posts,
    notifications,
    { getUserOrgLink: jest.fn().mockResolvedValue({ role: 'ADMIN', disabled: false }) } as any,
    { deliver: jest.fn().mockResolvedValue(undefined) } as any,
    audit as any
  );
  return { svc, audit };
}

describe('ApprovalService audit hooks', () => {
  it('emits nothing for a retried request on an open approval', async () => {
    const { svc, audit } = build(false);
    await svc.requestApproval('o1', 'p1', 'u1');
    expect(audit.logResourceEvent).not.toHaveBeenCalled();
  });

  it('emits approval_requested once when created', async () => {
    const { svc, audit } = build(true);
    await svc.requestApproval('o1', 'p1', 'u1');
    expect(audit.logResourceEvent).toHaveBeenCalledTimes(1);
    expect(audit.logResourceEvent.mock.calls[0][0]).toMatchObject({
      organizationId: 'o1',
      event: 'post.approval_requested',
      targetType: 'post',
      targetId: 'p1',
      metadata: { approvalId: 'ap1' },
    });
  });

  it('emits approval_resolved on approve and reject', async () => {
    const { svc, audit } = build(true);
    await svc.approve('o1', 'ap1', 'u2', 'ADMIN');
    await svc.reject('o1', 'ap1', 'u2', 'ADMIN', 'no');
    expect(audit.logResourceEvent.mock.calls.map((c: any) => c[0].metadata)).toEqual([
      { approvalId: 'ap1', decision: 'APPROVED', via: 'DASHBOARD', stage: 1, stageCount: 1, final: true },
      { approvalId: 'ap1', decision: 'REJECTED', via: 'DASHBOARD', stage: 1, stageCount: 1, final: true },
    ]);
    expect(audit.logResourceEvent.mock.calls[0][0].event).toBe('post.approval_resolved');
  });

  it('guest resolve emits with actor null and by guest', async () => {
    const { svc, audit } = build(true);
    await svc.resolveGuestReview('tok', 'approve');
    const e = audit.logResourceEvent.mock.calls[0][0];
    expect(e.actor).toBeNull();
    expect(e).toMatchObject({
      organizationId: 'o1',
      event: 'post.approval_resolved',
      targetId: 'p1',
      metadata: { approvalId: 'ap1', decision: 'APPROVED', by: 'guest', via: 'GUEST', final: true },
    });
  });

  it('a rejecting audit writer does not break approval', async () => {
    const { svc, audit } = build(true);
    audit.logResourceEvent.mockRejectedValue(new Error('x'));
    await expect(svc.approve('o1', 'ap1', 'u2', 'ADMIN')).resolves.toEqual({ approved: true, postId: 'p1' });
  });
});
