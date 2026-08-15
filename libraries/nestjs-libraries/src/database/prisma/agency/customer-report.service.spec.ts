import { CustomerReportService } from './customer-report.service';

describe('CustomerReportService', () => {
  it('scopes customer, channels, posts, approvals and errors to one org', async () => {
    const prisma = {
      customer: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', name: 'Acme' }) },
      integration: { findMany: jest.fn().mockResolvedValue([{ id: 'i1', name: 'X', providerIdentifier: 'x', disabled: false }]) },
      post: {
        groupBy: jest.fn().mockResolvedValue([{ state: 'QUEUE', _count: { _all: 2 } }]),
        count: jest.fn().mockResolvedValue(1),
      },
      postApproval: { count: jest.fn().mockResolvedValue(1) },
    };

    const result = await new CustomerReportService(prisma as never).getReport('org-1', 'c1', 30);
    expect(result.summary).toMatchObject({ channels: 1, activeChannels: 1, queued: 2, recentErrors: 1, pendingApprovals: 1 });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', orgId: 'org-1', deletedAt: null },
      select: { id: true, name: true },
    });
    expect(prisma.integration.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-1', customerId: 'c1', deletedAt: null } }));
  });
});
