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
jest.mock('@postsider/nestjs-libraries/database/prisma/webhooks/public-webhook-delivery.service', () => ({ PublicWebhookDeliveryService: jest.fn() }));

import { ApprovalService } from './approval.service';
import { hashGuestToken } from './guest-token';

describe('ApprovalService guest links (hashed storage)', () => {
  const expiresAt = new Date('2026-11-12T00:00:00Z');
  const build = () => {
    const repo = {
      getById: jest.fn().mockResolvedValue({ id: 'a1', postId: 'p1', status: 'PENDING' }),
      setGuestToken: jest.fn().mockResolvedValue(1),
      getByGuestToken: jest.fn().mockResolvedValue({
        id: 'a1',
        organizationId: 'org-1',
        guestTokenExpiresAt: expiresAt,
        requestedBy: { email: 'a@b.co' },
        post: { id: 'p1', content: 'c', image: '[]', publishDate: new Date(), integration: { name: 'x' } },
        organization: { name: 'o', logo: null },
      }),
      resolveByGuestToken: jest.fn().mockResolvedValue(1),
      revertGuestApproval: jest.fn().mockResolvedValue(1),
    };
    const posts = { changePostStatus: jest.fn().mockResolvedValue(undefined) };
    const notifications = {
      inAppNotification: jest.fn().mockResolvedValue(undefined),
      sendEmail: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ApprovalService(
      repo as any,
      posts as any,
      notifications as any,
      {} as any,
      { deliver: jest.fn().mockResolvedValue(undefined) } as any
    );
    return { service, repo, posts };
  };

  it('createGuestLink returns the plaintext once and stores only its hash', async () => {
    const { service, repo } = build();
    const out = await service.createGuestLink('org-1', 'a1', 'ADMIN');
    expect(typeof out.token).toBe('string');
    expect(out.token.length).toBeGreaterThanOrEqual(32);
    const [orgId, id, stored, exp] = repo.setGuestToken.mock.calls[0];
    expect([orgId, id]).toEqual(['org-1', 'a1']);
    expect(stored).toBe(hashGuestToken(out.token));
    expect(stored).not.toBe(out.token);
    expect(exp).toBeInstanceOf(Date);
    expect(out.expiresAt).toBe(exp);
  });

  it('refuses to mint a link for a non-admin', async () => {
    const { service, repo } = build();
    await expect(service.createGuestLink('org-1', 'a1', 'USER')).rejects.toBeDefined();
    expect(repo.setGuestToken).not.toHaveBeenCalled();
  });

  it('a token issued before the migration (hash of its plaintext) resolves through the same hash function', async () => {
    const { service, repo } = build();
    // The migration backfilled guestTokenHash = sha256(plaintext); the repository
    // looks up hashGuestToken(presented). Both sides use the one function.
    await service.getForGuestReview('legacy-plain-token');
    expect(repo.getByGuestToken).toHaveBeenCalledWith('legacy-plain-token');
    // Repository-level proof lives in approval.repository.guest.spec.ts.
    expect(hashGuestToken('legacy-plain-token')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('getForGuestReview returns no token material', async () => {
    const { service } = build();
    const out = await service.getForGuestReview('tok');
    expect(JSON.stringify(out)).not.toMatch(/guestToken|requestedBy|organizationId/);
  });

  it('resolveGuestReview consumes once and a second use fails', async () => {
    const { service, repo } = build();
    await expect(service.resolveGuestReview('tok', 'approve')).resolves.toEqual({ approved: true });
    repo.resolveByGuestToken.mockResolvedValue(0);
    await expect(service.resolveGuestReview('tok', 'approve')).rejects.toThrow(/already been used/);
  });

  it('on a scheduling failure restores the link through the hash', async () => {
    const { service, repo, posts } = build();
    posts.changePostStatus.mockRejectedValue(new Error('boom'));
    await expect(service.resolveGuestReview('tok', 'approve')).rejects.toThrow('boom');
    expect(repo.revertGuestApproval).toHaveBeenCalledWith('org-1', 'a1', hashGuestToken('tok'), expiresAt);
  });
});
