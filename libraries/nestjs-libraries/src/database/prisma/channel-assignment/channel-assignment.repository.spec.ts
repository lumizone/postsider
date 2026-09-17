import { ChannelAssignmentRepository } from './channel-assignment.repository';

describe('ChannelAssignmentRepository.setForIntegration', () => {
  const build = (members: string[]) => {
    const create = jest.fn((args: unknown) => Promise.resolve(args));
    const deleteMany = jest.fn(() => Promise.resolve({ count: 0 }));
    const findMany = jest.fn(() =>
      Promise.resolve(members.map((userId) => ({ userId })))
    );
    const repo = new ChannelAssignmentRepository(
      { model: { channelAssignment: { deleteMany, create } } } as never,
      { model: { userOrganization: { findMany } } } as never
    );
    return { repo, create, deleteMany, findMany };
  };

  it('only assigns users who are members of the organization', async () => {
    const { repo, create, findMany } = build(['member-1']);

    await repo.setForIntegration('org-1', 'ch-1', [
      'member-1',
      'foreign-user',
    ]);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        userId: { in: ['member-1', 'foreign-user'] },
      },
      select: { userId: true },
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        integrationId: 'ch-1',
        userId: 'member-1',
      },
    });
  });

  it('creates nothing when only foreign user ids are given', async () => {
    const { repo, create } = build([]);

    await repo.setForIntegration('org-1', 'ch-1', ['foreign-1', 'foreign-2']);

    expect(create).not.toHaveBeenCalled();
  });

  it('clears assignments on an empty list without querying members', async () => {
    const { repo, create, deleteMany, findMany } = build([]);

    await repo.setForIntegration('org-1', 'ch-1', []);

    expect(findMany).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('de-duplicates the requested user ids', async () => {
    const { repo, create } = build(['member-1']);

    await repo.setForIntegration('org-1', 'ch-1', ['member-1', 'member-1']);

    expect(create).toHaveBeenCalledTimes(1);
  });
});
