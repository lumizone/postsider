jest.mock('./approval.repository', () => ({ ApprovalRepository: jest.fn() }));
jest.mock('@postsider/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: jest.fn() }));
jest.mock('@postsider/nestjs-libraries/database/prisma/notifications/notification.service', () => ({
  NotificationService: jest.fn(),
}));
jest.mock('@postsider/nestjs-libraries/database/prisma/organizations/organization.repository', () => ({
  OrganizationRepository: jest.fn(),
}));

import { ApprovalService } from './approval.service';

const IDENT = {
  actor: { createdBy: { type: 'API_KEY', apiKeyId: 'k1' }, lastModifiedBy: null },
  provenance: { agentName: 'bot', workflowId: null, runId: null, externalRef: null, source: null },
};

function build(rows: { open?: any; resolved?: any; guest?: any }) {
  const repo: any = {
    getPost: jest.fn().mockResolvedValue({ state: 'DRAFT', parentPostId: null, integrationId: 'c1' }),
    openRequest: jest.fn().mockResolvedValue({ approval: rows.open, created: true }),
    getById: jest.fn()
      .mockResolvedValueOnce({ id: 'ap1', postId: 'p1', status: 'PENDING' })
      .mockResolvedValue(rows.resolved),
    decideStageTx: jest.fn().mockResolvedValue(true),
    revertFinal: jest.fn().mockResolvedValue(1),
    getByGuestToken: jest.fn().mockResolvedValue({
      id: 'ap1', organizationId: 'o1', post: { id: 'p1' }, guestTokenExpiresAt: new Date(),
    }),
  };
  const posts: any = {
    setPostState: jest.fn().mockResolvedValue(undefined),
    changePostStatus: jest.fn().mockResolvedValue(undefined),
    getPostIdentity: jest.fn().mockResolvedValue(IDENT),
  };
  const notifications: any = {
    inAppNotification: jest.fn().mockResolvedValue(undefined),
    notifyApprovers: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
  };
  const deliver = jest.fn().mockResolvedValue(undefined);
  const organizations: any = {
    getUserOrgLink: jest.fn().mockResolvedValue({ role: 'ADMIN', disabled: false }),
  };
  const svc = new ApprovalService(repo, posts, notifications, organizations, { deliver } as any);
  return { svc, deliver, posts, repo };
}

describe('ApprovalService webhook identity', () => {
  it('approval.requested carries actor, provenance and requestedBy', async () => {
    const { svc, deliver } = build({
      open: { id: 'ap1', status: 'PENDING', requestedByType: 'API_KEY', requestedByApiKeyId: 'k1' },
    });
    await svc.requestApproval('o1', 'p1', 'u1');
    expect(deliver).toHaveBeenCalledWith('o1', 'approval.requested', {
      approvalId: 'ap1', postId: 'p1', status: 'PENDING',
      actor: IDENT.actor, provenance: IDENT.provenance,
      approval: {
        requestedBy: { type: 'API_KEY', apiKeyId: 'k1' },
        decidedBy: null,
        stage: { position: 1, total: 1, name: 'Approval' },
      },
    });
  });

  it('in-app approve reports decidedBy USER and keeps original keys', async () => {
    const { svc, deliver } = build({
      resolved: {
        id: 'ap1', postId: 'p1', requestedByType: 'API_KEY', requestedByApiKeyId: 'k1',
        decidedByType: 'USER', approverId: 'u9',
      },
    });
    await svc.approve('o1', 'ap1', 'u9', 'ADMIN');
    expect(deliver.mock.calls[0][1]).toBe('approval.resolved');
    expect(deliver.mock.calls[0][2]).toMatchObject({
      approvalId: 'ap1', postId: 'p1', status: 'APPROVED', note: null,
      approval: { requestedBy: { type: 'API_KEY', apiKeyId: 'k1' }, decidedBy: { type: 'USER', userId: 'u9' } },
    });
  });

  it('guest resolve reports decidedBy GUEST', async () => {
    const { svc, deliver, repo } = build({
      resolved: { id: 'ap1', postId: 'p1', guestName: 'Ann', guestEmail: 'ann@x.test', decidedByType: null },
    });
    repo.getById
      .mockReset()
      .mockResolvedValueOnce({ id: 'ap1', postId: 'p1', status: 'PENDING' })
      .mockResolvedValue({
        id: 'ap1', postId: 'p1', status: 'REJECTED', guestName: 'Ann', guestEmail: 'ann@x.test', decidedByType: null,
      });
    await svc.resolveGuestReview('tok', 'reject', 'no', { name: 'Ann', email: 'ann@x.test' });
    expect(deliver.mock.calls[0][2]).toMatchObject({
      status: 'REJECTED', note: 'no',
      approval: { decidedBy: { type: 'GUEST', guestName: 'Ann', guestEmail: 'ann@x.test' } },
    });
    expect(JSON.stringify(deliver.mock.calls[0][2])).not.toContain('tok');
  });

  it('delivers an all-null identity when the lookup fails', async () => {
    const { svc, deliver, posts } = build({ open: { id: 'ap1', status: 'PENDING' } });
    posts.getPostIdentity.mockRejectedValue(new Error('x'));
    await svc.requestApproval('o1', 'p1', 'u1');
    expect(deliver.mock.calls[0][2]).toMatchObject({
      actor: { createdBy: null, lastModifiedBy: null },
      approval: { requestedBy: null, decidedBy: null },
    });
  });
});
