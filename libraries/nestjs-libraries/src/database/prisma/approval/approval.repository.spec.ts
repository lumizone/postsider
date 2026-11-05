import { ApprovalRepository } from './approval.repository';

describe('ApprovalRepository attribution and idempotent request', () => {
  const create = () => {
    const model = {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    };
    const stage = { deleteMany: jest.fn(), createMany: jest.fn() };
    const tokens = { deleteMany: jest.fn() };
    return {
      model,
      stage,
      tokens,
      repository: new ApprovalRepository(
        {
          model: {
            postApproval: model,
            postApprovalStage: stage,
            approvalActionToken: tokens,
          },
        } as any,
        {} as any
      ),
    };
  };
  const actor = { type: 'API_KEY', apiKeyId: 'k1' } as const;

  it('re-opens a resolved approval and clears the previous round', async () => {
    const { repository, model } = create();
    model.updateMany.mockResolvedValue({ count: 1 });
    model.findFirst.mockResolvedValue({ id: 'a1', status: 'PENDING' });

    await expect(
      repository.openRequest('org-1', 'p1', 'u-super', actor)
    ).resolves.toEqual({ approval: { id: 'a1', status: 'PENDING' }, created: true });

    const arg = model.updateMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      postId: 'p1',
      organizationId: 'org-1',
      status: { in: ['APPROVED', 'REJECTED'] },
    });
    expect(arg.data).toMatchObject({
      status: 'PENDING',
      requestedById: 'u-super',
      requestedByType: 'API_KEY',
      requestedByApiKeyId: 'k1',
      decidedByType: null,
      approverId: null,
      guestName: null,
      guestEmail: null,
      guestToken: null,
      guestTokenHash: null,
      guestTokenExpiresAt: null,
      resolvedAt: null,
      note: null,
    });
    expect(model.create).not.toHaveBeenCalled();
  });

  it('creates the first request with requester and actor columns', async () => {
    const { repository, model } = create();
    model.updateMany.mockResolvedValue({ count: 0 });
    model.create.mockResolvedValue({ id: 'a1' });

    await expect(
      repository.openRequest('org-1', 'p1', 'u-super', actor)
    ).resolves.toEqual({ approval: { id: 'a1' }, created: true });
    expect(model.create.mock.calls[0][0].data).toMatchObject({
      postId: 'p1',
      organizationId: 'org-1',
      requestedById: 'u-super',
      requestedByType: 'API_KEY',
      requestedByApiKeyId: 'k1',
    });
  });

  it('returns the existing row untouched on a unique violation', async () => {
    const { repository, model } = create();
    model.updateMany.mockResolvedValue({ count: 0 });
    model.create.mockRejectedValue({ code: 'P2002' });
    model.findFirst.mockResolvedValue({ id: 'a1', status: 'PENDING' });

    await expect(
      repository.openRequest('org-1', 'p1', 'u-super', actor)
    ).resolves.toEqual({
      approval: { id: 'a1', status: 'PENDING' },
      created: false,
    });
    expect(model.updateMany).toHaveBeenCalledTimes(1);
    expect(model.findFirst).toHaveBeenCalledWith({
      where: { postId: 'p1', organizationId: 'org-1' },
    });
  });

  it('rethrows any other create error', async () => {
    const { repository, model } = create();
    model.updateMany.mockResolvedValue({ count: 0 });
    const boom = new Error('db down');
    model.create.mockRejectedValue(boom);
    await expect(
      repository.openRequest('org-1', 'p1', 'u-super', actor)
    ).rejects.toBe(boom);
  });
});
