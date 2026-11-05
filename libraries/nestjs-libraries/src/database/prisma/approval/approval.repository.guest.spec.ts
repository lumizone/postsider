import { ApprovalRepository } from './approval.repository';
import { hashGuestToken } from './guest-token';

describe('ApprovalRepository guest token hashing', () => {
  const create = () => {
    const model = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ id: 'a1' }),
    };
    return {
      model,
      repository: new ApprovalRepository(
        {
          model: {
            postApproval: model,
            postApprovalStage: { deleteMany: jest.fn(), createMany: jest.fn() },
            approvalActionToken: { deleteMany: jest.fn() },
          },
        } as any,
        {} as any
      ),
    };
  };
  const token = 'presented-token';
  const hash = hashGuestToken(token);

  it('getByGuestToken looks up the hash and never the plaintext column', async () => {
    const { repository, model } = create();
    await repository.getByGuestToken(token);
    const where = model.findFirst.mock.calls[0][0].where;
    expect(where.guestTokenHash).toBe(hash);
    expect(where.status).toBe('PENDING');
    expect(where.guestTokenExpiresAt).toEqual({ gt: expect.any(Date) });
    expect(JSON.stringify(where)).not.toContain(token);
    expect(where).not.toHaveProperty('guestToken');
    const select = model.findFirst.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('guestToken');
    expect(select).not.toHaveProperty('guestTokenHash');
  });

  it('setGuestToken stores the hash and nulls the plaintext column', async () => {
    const { repository, model } = create();
    const expiresAt = new Date('2026-11-12T00:00:00Z');
    await repository.setGuestToken('org-1', 'a1', hash, expiresAt);
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', organizationId: 'org-1' },
      data: { guestTokenHash: hash, guestToken: null, guestTokenExpiresAt: expiresAt },
    });
  });

  it('revokeGuestToken clears hash and plaintext', async () => {
    const { repository, model } = create();
    await repository.revokeGuestToken('org-1', 'a1');
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', organizationId: 'org-1' },
      data: { guestTokenHash: null, guestToken: null, guestTokenExpiresAt: null },
    });
  });

  it('reopening a resolved approval drops any previous link material', async () => {
    const { repository, model } = create();
    await repository.openRequest('org-1', 'p1', 'u1', { type: 'USER', userId: 'u1' } as any);
    expect(model.updateMany.mock.calls[0][0].data).toMatchObject({
      guestToken: null,
      guestTokenHash: null,
      guestTokenExpiresAt: null,
    });
  });
});
