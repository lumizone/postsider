import { ReportService } from './report.service';

describe('ReportService', () => {
  it('aggregates delivery, latest-per-post engagement and top posts, scoped to one customer', async () => {
    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', name: 'Acme' }) },
      organization: { findFirst: jest.fn().mockResolvedValue({ name: 'Agency Co', logo: 'https://x/logo.png' }) },
      integration: { findMany: jest.fn().mockResolvedValue([
        { id: 'i1', name: 'Instagram', providerIdentifier: 'instagram', disabled: false },
        { id: 'i2', name: 'X', providerIdentifier: 'x', disabled: true },
      ]) },
      post: { findMany: jest.fn().mockResolvedValue([
        { id: 'p1', content: 'Hello', releaseURL: 'https://x/1', publishDate: new Date('2026-08-01'), integration: { name: 'Instagram' } },
        { id: 'p2', content: 'World', releaseURL: null, publishDate: new Date('2026-08-02'), integration: { name: 'Instagram' } },
      ]) },
      postAnalytics: { findMany: jest.fn().mockResolvedValue([
        { postId: 'p1', metric: 'Reach', value: 100, measuredAt: new Date('2026-08-03') },
        { postId: 'p1', metric: 'Reach', value: 150, measuredAt: new Date('2026-08-04') },
        { postId: 'p1', metric: 'Likes', value: 20, measuredAt: new Date('2026-08-04') },
        { postId: 'p2', metric: 'Reach', value: 50, measuredAt: new Date('2026-08-04') },
      ]) },
    };

    const result = await new ReportService(prisma as never).buildReport('org-1', 'c1', 30);

    expect(result.branding).toEqual({ name: 'Agency Co', logo: 'https://x/logo.png' });
    expect(result.customer).toEqual({ id: 'c1', name: 'Acme' });
    expect(result.delivery).toMatchObject({ channels: 2, activeChannels: 1, published: 2 });
    // Reach = latest p1 (150) + latest p2 (50); Likes = 20.
    expect(result.engagement).toEqual([
      { metric: 'Reach', total: 200 },
      { metric: 'Likes', total: 20 },
    ]);
    // p1 total engagement 170 > p2 50, so p1 ranks first.
    expect(result.topPosts.map((p) => p.content)).toEqual(['Hello', 'World']);
    expect(result.topPosts[0].engagement).toBe(170);
    expect(prisma.postAnalytics.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org-1' }),
    }));
  });

  it('throws for a customer outside the org', async () => {
    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue(null) },
      organization: { findFirst: jest.fn().mockResolvedValue(null) },
      integration: { findMany: jest.fn().mockResolvedValue([]) },
      post: { findMany: jest.fn().mockResolvedValue([]) },
      postAnalytics: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await expect(
      new ReportService(prisma as never).buildReport('org-1', 'nope', 30)
    ).rejects.toThrow('Customer not found');
  });
});
