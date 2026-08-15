import { AgencyOverviewService } from './agency-overview.service';

describe('AgencyOverviewService', () => {
  it('returns org-scoped operational counts and client rollups', async () => {
    const prisma = {
      integration: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'i1', name: 'LinkedIn', providerIdentifier: 'linkedin', disabled: false, customer: { id: 'c1', name: 'Acme' } },
          { id: 'i2', name: 'X', providerIdentifier: 'x', disabled: true, customer: { id: 'c1', name: 'Acme' } },
        ]),
      },
      post: {
        groupBy: jest.fn().mockResolvedValue([
          { state: 'QUEUE', _count: { _all: 3 } },
          { state: 'ERROR', _count: { _all: 1 } },
        ]),
        count: jest.fn().mockResolvedValue(1),
      },
      postApproval: { count: jest.fn().mockResolvedValue(2) },
    };

    const result = await new AgencyOverviewService(prisma as never).getOverview('org-1', 30);
    expect(result.summary).toMatchObject({
      clients: 1,
      channels: 2,
      activeChannels: 1,
      queued: 3,
      errors: 1,
      pendingApprovals: 2,
    });
    expect(result.clients).toEqual([{ id: 'c1', name: 'Acme', channels: 2, activeChannels: 1 }]);
    expect(prisma.integration.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1', deletedAt: null } }));
    expect(prisma.post.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1', deletedAt: null }) }));
  });
});
