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
        'guest-token',
        expiresAt
      )
    ).resolves.toBe(1);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-1',
        organizationId: 'org-1',
        status: 'APPROVED',
        approverId: null,
        guestToken: null,
      },
      data: {
        status: 'PENDING',
        note: null,
        resolvedAt: null,
        guestToken: 'guest-token',
        guestTokenExpiresAt: expiresAt,
      },
    });
  });
});
