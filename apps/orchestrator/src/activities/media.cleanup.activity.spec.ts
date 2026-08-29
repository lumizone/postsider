import { MediaCleanupActivity } from './media.cleanup.activity';

describe('MediaCleanupActivity', () => {
  it('retains media referenced by a non-deleted post image or content in any state', async () => {
    const prisma = {
      media: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'media-1',
              path: 'https://cdn/media-1.jpg',
              organizationId: 'org-1',
              createdAt: new Date('2026-01-01T00:00:00Z'),
            },
          ])
          .mockResolvedValueOnce([]),
        update: jest.fn(),
      },
      post: {
        findFirst: jest.fn().mockResolvedValue({ id: 'draft-post' }),
      },
    };
    const activity = new MediaCleanupActivity(prisma as any);
    const storage = { removeFile: jest.fn() };
    (activity as any).storage = storage;

    await expect(activity.cleanupExpiredMedia()).resolves.toEqual({
      deleted: 0,
      skipped: 1,
    });

    expect(prisma.post.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        OR: [
          { image: { contains: 'https://cdn/media-1.jpg' } },
          { content: { contains: 'https://cdn/media-1.jpg' } },
        ],
      },
      select: { id: true },
    });
    expect(storage.removeFile).not.toHaveBeenCalled();
    expect(prisma.media.update).not.toHaveBeenCalled();
  });

  it('continues past retained media and deletes later candidates', async () => {
    const retainedAt = new Date('2026-01-01T00:00:00Z');
    const deletableAt = new Date('2026-01-02T00:00:00Z');
    const prisma = {
      media: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'media-1',
              path: 'https://cdn/media-1.jpg',
              organizationId: 'org-1',
              createdAt: retainedAt,
            },
          ])
          .mockResolvedValueOnce([
            {
              id: 'media-2',
              path: 'https://cdn/media-2.jpg',
              organizationId: 'org-1',
              createdAt: deletableAt,
            },
          ])
          .mockResolvedValueOnce([]),
        update: jest.fn(),
      },
      post: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'post-1' })
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
      },
    };
    const activity = new MediaCleanupActivity(prisma as any);
    const storage = { removeFile: jest.fn() };
    (activity as any).storage = storage;

    await expect(activity.cleanupExpiredMedia()).resolves.toEqual({
      deleted: 1,
      skipped: 1,
    });

    expect(prisma.media.findMany.mock.calls[1][0].where.OR).toEqual([
      { createdAt: { gt: retainedAt } },
      { createdAt: retainedAt, id: { gt: 'media-1' } },
    ]);
    expect(storage.removeFile).toHaveBeenCalledWith('https://cdn/media-2.jpg');
    expect(prisma.media.update).toHaveBeenCalledWith({
      where: { id: 'media-2' },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it('rechecks content references immediately before removing a blob', async () => {
    const prisma = {
      media: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'media-1',
              path: 'https://cdn/media-1.jpg',
              organizationId: 'org-1',
              createdAt: new Date('2026-01-01T00:00:00Z'),
            },
          ])
          .mockResolvedValueOnce([]),
        update: jest.fn(),
      },
      post: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 'new-content-reference' }),
      },
    };
    const activity = new MediaCleanupActivity(prisma as any);
    const storage = { removeFile: jest.fn() };
    (activity as any).storage = storage;

    await expect(activity.cleanupExpiredMedia()).resolves.toEqual({
      deleted: 0,
      skipped: 1,
    });

    expect(prisma.post.findFirst).toHaveBeenCalledTimes(2);
    expect(storage.removeFile).not.toHaveBeenCalled();
    expect(prisma.media.update).not.toHaveBeenCalled();
  });

  it('leaves media eligible for retry when physical deletion fails', async () => {
    const prisma = {
      media: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: 'media-1',
              path: 'https://cdn/media-1.jpg',
              organizationId: 'org-1',
              createdAt: new Date('2026-01-01T00:00:00Z'),
            },
          ])
          .mockResolvedValueOnce([]),
        update: jest.fn(),
      },
      post: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const activity = new MediaCleanupActivity(prisma as any);
    const storage = {
      removeFile: jest.fn().mockRejectedValue(new Error('storage unavailable')),
    };
    const error = jest.spyOn(console, 'error').mockImplementation();
    (activity as any).storage = storage;

    await expect(activity.cleanupExpiredMedia()).resolves.toEqual({
      deleted: 0,
      skipped: 0,
    });

    expect(prisma.media.update).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
