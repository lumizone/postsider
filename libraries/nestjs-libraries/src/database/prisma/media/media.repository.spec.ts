import { MediaRepository } from './media.repository';

describe('MediaRepository references', () => {
  it('searches image and content only on active posts in the same organization', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'post-1' });
    const repository = new MediaRepository(
      {} as any,
      { model: { post: { findFirst } } } as any
    );

    await expect(
      repository.isMediaReferenced(
        'org-1',
        'media-1',
        'https://storage.example/image/file.jpg'
      )
    ).resolves.toBe(true);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        OR: [
          { image: { contains: 'https://storage.example/image/file.jpg' } },
          { content: { contains: 'https://storage.example/image/file.jpg' } },
          { image: { contains: 'file.jpg' } },
          { content: { contains: 'file.jpg' } },
          { image: { contains: 'media-1' } },
          { content: { contains: 'media-1' } },
        ],
      },
      select: { id: true },
    });
  });
});
