import { ApprovalRepository } from './approval.repository';

function make(rows: any[] = [], flows: any[] = []) {
  const approval = {
    findMany: jest.fn().mockResolvedValue(rows),
    findFirst: jest.fn().mockResolvedValue(rows[0] ?? null),
  };
  const flow = { findMany: jest.fn().mockResolvedValue(flows) };
  const repo = new ApprovalRepository({ model: { postApproval: approval, approvalFlow: flow } } as any, {} as any);
  return { repo, approval, flow };
}

describe('ApprovalRepository public API reads', () => {
  it('list: organization scoped, newest first with an id tiebreak, keyset cursor, explicit select', async () => {
    const { repo, approval } = make();
    const at = new Date('2026-11-01T00:00:00.000Z');
    await repo.listForPublicApi('org-1', {
      status: 'PENDING',
      since: new Date('2026-10-01T00:00:00.000Z'),
      cursor: { requestedAt: at, id: 'm' },
      take: 11,
    });
    const arg = approval.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      organizationId: 'org-1',
      status: 'PENDING',
      requestedAt: { gte: new Date('2026-10-01T00:00:00.000Z') },
      AND: [{ OR: [{ requestedAt: { lt: at } }, { requestedAt: at, id: { lt: 'm' } }] }],
    });
    expect(arg.orderBy).toEqual([{ requestedAt: 'desc' }, { id: 'desc' }]);
    expect(arg.take).toBe(11);
    const selected = JSON.stringify(arg.select);
    expect(selected).not.toMatch(/guestToken|requestedById|organizationId|approverUserIds/);
    expect(arg.include).toBeUndefined();
  });

  it('list without filters only scopes by organization', async () => {
    const { repo, approval } = make();
    await repo.listForPublicApi('org-1', { take: 26 });
    expect(approval.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1' });
  });

  it('attaches the flow (looked up inside the same organization) and null for a missing one', async () => {
    const { repo, flow } = make(
      [{ id: 'a', flowId: 'f1' }, { id: 'b', flowId: 'gone' }, { id: 'c', flowId: null }],
      [{ id: 'f1', name: 'Legal' }]
    );
    const out = await repo.listForPublicApi('org-1', { take: 10 });
    expect(flow.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', id: { in: ['f1', 'gone'] } },
      select: { id: true, name: true },
    });
    expect(out.map((r) => r.flow)).toEqual([{ id: 'f1', name: 'Legal' }, null, null]);
  });

  it('detail: scoped by id and organization, includes the post text, null when absent', async () => {
    const { repo, approval } = make([{ id: 'a', flowId: null }]);
    await repo.getForPublicApi('org-1', 'a');
    const arg = approval.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'a', organizationId: 'org-1' });
    expect(arg.select.post.select.content).toBe(true);
    const none = make([]);
    expect(await none.repo.getForPublicApi('org-1', 'zz')).toBeNull();
  });
});
