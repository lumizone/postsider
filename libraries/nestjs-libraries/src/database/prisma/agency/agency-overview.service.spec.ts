import { AgencyOverviewService } from './agency-overview.service';

const integration = (id: string, customerId: string | null, customerName: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  name: 'X',
  providerIdentifier: 'x',
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  tokenExpiration: null,
  customer: customerId ? { id: customerId, name: customerName } : null,
  ...extra,
});

describe('AgencyOverviewService', () => {
  it('returns org-scoped operational counts and client rollups', async () => {
    const prisma = {
      integration: {
        findMany: jest.fn().mockResolvedValue([
          integration('i1', 'c1', 'Acme'),
          integration('i2', 'c1', 'Acme', { disabled: true }),
          integration('i3', null, null),
        ]),
      },
      post: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([
            { state: 'QUEUE', _count: { _all: 3 } },
            { state: 'ERROR', _count: { _all: 1 } },
          ])
          .mockResolvedValueOnce([
            { integrationId: 'i1', _count: { _all: 2 } },
          ])
          .mockResolvedValueOnce([
            { integrationId: 'i2', _count: { _all: 1 } },
          ]),
        count: jest.fn().mockResolvedValue(1),
      },
      postApproval: { count: jest.fn().mockResolvedValue(2) },
    };

    const result = await new AgencyOverviewService(prisma as never).getOverview('org-1', 30);
    expect(result.summary).toMatchObject({
      clients: 2,
      channels: 3,
      activeChannels: 2,
      queued: 3,
      errors: 1,
      pendingApprovals: 2,
      stuckPosts: 2,
      tokenIssues: 1,
    });
    expect(result.clients).toEqual([
      { id: 'c1', name: 'Acme', channels: 2, activeChannels: 1, errors: 1, stuckPosts: 2, tokenIssues: 1 },
      { id: null, name: 'Unassigned', channels: 1, activeChannels: 1, errors: 0, stuckPosts: 0, tokenIssues: 0 },
    ]);
    expect(prisma.integration.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1', deletedAt: null } }));
    expect(prisma.post.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1', deletedAt: null }) }));
  });

  it('flags near/expired tokens and disconnected channels as token issues', async () => {
    const prisma = {
      integration: {
        findMany: jest.fn().mockResolvedValue([
          integration('i1', 'c1', 'Acme', { refreshNeeded: true }),
          integration('i2', 'c1', 'Acme', { inBetweenSteps: true }),
          integration('i3', null, null, { tokenExpiration: new Date(Date.now() - 1000) }),
        ]),
      },
      post: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      postApproval: { count: jest.fn().mockResolvedValue(0) },
    };

    const result = await new AgencyOverviewService(prisma as never).getOverview('org-1', 30);
    expect(result.summary.tokenIssues).toBe(3);
    expect(result.clients[0].tokenIssues).toBe(2);
  });
});
