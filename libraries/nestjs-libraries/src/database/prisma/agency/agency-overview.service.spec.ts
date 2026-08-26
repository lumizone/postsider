import { AgencyOverviewService } from './agency-overview.service';

/**
 * Regression: /overview counted rows the UI can never show or clear —
 * posts sitting on a deleted channel, and approvals whose post was deleted.
 * Production showed summary.errors = 1 with clients[].errors = 0 for weeks
 * because of a "test" post on a removed Instagram channel.
 */
describe('AgencyOverviewService — counters only include rows the UI can surface', () => {
  const makePrisma = () => ({
    integration: { findMany: jest.fn().mockResolvedValue([]) },
    post: {
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    postApproval: { count: jest.fn().mockResolvedValue(0) },
  });

  it('excludes posts whose channel was deleted from every post query', async () => {
    const prisma = makePrisma();
    await new AgencyOverviewService(prisma as never).getOverview('org-1', 30);

    const postWheres = [
      ...prisma.post.groupBy.mock.calls.map(([args]: [any]) => args.where),
      ...prisma.post.count.mock.calls.map(([args]: [any]) => args.where),
    ];
    expect(postWheres.length).toBeGreaterThan(0);
    for (const where of postWheres) {
      expect(where).toMatchObject({
        deletedAt: null,
        integration: { deletedAt: null },
      });
    }
  });

  it('excludes approvals whose post was deleted', async () => {
    const prisma = makePrisma();
    await new AgencyOverviewService(prisma as never).getOverview('org-1', 30);

    expect(prisma.postApproval.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: 'org-1',
        status: 'PENDING',
        post: { deletedAt: null, integration: { deletedAt: null } },
      }),
    });
  });
});
