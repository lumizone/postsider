import { PostsRepository } from './posts.repository';

const make = () => {
  const count = jest.fn().mockResolvedValue(4);
  const repo = new PostsRepository({ model: { post: { count } } } as any, ...([] as any[]));
  return { repo, count };
};

describe('PostsRepository.countAutomationPostsInRange', () => {
  const range = { start: new Date('2026-03-10T00:00:00Z'), end: new Date('2026-03-11T00:00:00Z') };

  it('counts top-level live automation posts in the range for the org', async () => {
    const { repo, count } = make();
    expect(await repo.countAutomationPostsInRange('org', range, {})).toBe(4);
    expect(count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org',
        parentPostId: null,
        deletedAt: null,
        state: { in: ['QUEUE', 'PUBLISHED'] },
        publishDate: { gte: range.start, lt: range.end },
        createdByType: { in: ['API_KEY', 'OAUTH_CLIENT'] },
      },
    });
  });

  it('adds the channel and excludes one post when asked', async () => {
    const { repo, count } = make();
    await repo.countAutomationPostsInRange('org', range, { integrationId: 'i1', excludePostId: 'p1' });
    const where = count.mock.calls[0][0].where;
    expect(where.integrationId).toBe('i1');
    expect(where.id).toEqual({ not: 'p1' });
    expect(where.organizationId).toBe('org');
  });
});
