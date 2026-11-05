import { ApprovalRepository } from './approval.repository';

describe('ApprovalRepository compensation', () => {
  const createRepository = () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    return {
      repository: new ApprovalRepository(
        { model: { postApproval: { updateMany } } } as any,
        {} as any
      ),
      updateMany,
    };
  };

  it('conditionally restores an authenticated approval to pending', async () => {
    const { repository, updateMany } = createRepository();

    await expect(
      repository.revertApproved('org-1', 'approval-1', 'approver-1')
    ).resolves.toBe(1);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-1',
        organizationId: 'org-1',
        status: 'APPROVED',
        approverId: 'approver-1',
      },
      data: {
        status: 'PENDING',
        approverId: null,
        decidedByType: null,
        note: null,
        resolvedAt: null,
      },
    });
  });

  it('conditionally restores a guest token while returning approval to pending', async () => {
    const { repository, updateMany } = createRepository();
    const expiresAt = new Date('2026-09-06T12:00:00.000Z');

    await expect(
      repository.revertGuestApproval(
        'org-1',
        'approval-1',
        'guest-token-hash',
        expiresAt
      )
    ).resolves.toBe(1);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-1',
        organizationId: 'org-1',
        status: 'APPROVED',
        approverId: null,
        guestTokenHash: null,
      },
      data: {
        status: 'PENDING',
        note: null,
        resolvedAt: null,
        guestName: null,
        guestEmail: null,
        guestToken: null,
        guestTokenHash: 'guest-token-hash',
        guestTokenExpiresAt: expiresAt,
      },
    });
  });
});

describe('ApprovalRepository attribution and idempotent request', () => {
  const create = () => {
    const model = {
      updateMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
    };
    return {
      model,
      repository: new ApprovalRepository(
        { model: { postApproval: model } } as any,
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

  it('records a USER decision on resolve', async () => {
    const { repository, model } = create();
    model.updateMany.mockResolvedValue({ count: 1 });
    await repository.resolve('org-1', 'a1', 'u9', 'APPROVED', null);
    expect(model.updateMany.mock.calls[0][0].data).toMatchObject({
      approverId: 'u9',
      decidedByType: 'USER',
    });
  });

  it('records the guest identity and still consumes the token', async () => {
    const { repository, model } = create();
    model.updateMany.mockResolvedValue({ count: 1 });
    await repository.resolveByGuestToken('tok', 'REJECTED', 'nope', {
      name: 'Ann',
      email: 'a@b.co',
    });
    expect(model.updateMany.mock.calls[0][0].data).toMatchObject({
      status: 'REJECTED',
      approverId: null,
      decidedByType: null,
      guestName: 'Ann',
      guestEmail: 'a@b.co',
      guestToken: null,
      guestTokenHash: null,
      guestTokenExpiresAt: null,
    });
  });
});
