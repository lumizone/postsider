import { PostsRepository } from './posts.repository';

describe('PostsRepository update semantics', () => {
  it('rejects an update entry whose supplied id does not belong to an active post', async () => {
    const post = {
      model: {
        post: {
          findFirst: jest.fn().mockResolvedValue(null),
          upsert: jest.fn().mockResolvedValue({ id: 'created-post' }),
        },
      },
    };
    const repository = new PostsRepository(
      post as any, {} as any, {} as any, {} as any,
      { model: { tagsPosts: { deleteMany: jest.fn().mockResolvedValue(undefined) } } } as any,
      {} as any, {} as any,
    );

    await expect(repository.createOrUpdatePost(
      'update', 'org-1', '2026-09-01T10:00:00',
      {
        integration: { id: 'channel-1' },
        settings: { __type: 'x-post' },
        value: [{ id: 'unknown-post', content: 'new', image: [] }],
      } as any,
      [], 'WEB' as any,
    )).rejects.toThrow('Post not found');

    expect(post.model.post.upsert).not.toHaveBeenCalled();
  });
});
