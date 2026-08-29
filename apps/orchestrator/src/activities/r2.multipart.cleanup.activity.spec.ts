jest.mock('@aws-sdk/client-s3', () => ({
  __mockSend: jest.fn(),
  S3Client: jest.fn(() => ({
    send: jest.requireMock('@aws-sdk/client-s3').__mockSend,
  })),
  ListMultipartUploadsCommand: jest.fn(),
  AbortMultipartUploadCommand: jest.fn(),
  ListObjectsV2Command: jest.fn(),
  HeadObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));

import { R2MultipartCleanupActivity } from './r2.multipart.cleanup.activity';

const s3 = jest.requireMock('@aws-sdk/client-s3') as {
  __mockSend: jest.Mock;
  ListMultipartUploadsCommand: jest.Mock;
  AbortMultipartUploadCommand: jest.Mock;
  ListObjectsV2Command: jest.Mock;
  HeadObjectCommand: jest.Mock;
  DeleteObjectCommand: jest.Mock;
};

function prismaMock() {
  return { media: { findFirst: jest.fn() } };
}

describe('R2MultipartCleanupActivity', () => {
  let activity: R2MultipartCleanupActivity;
  const storageProvider = process.env.STORAGE_PROVIDER;
  const bucketUrl = process.env.CLOUDFLARE_BUCKET_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    s3.__mockSend.mockReset();
    process.env.STORAGE_PROVIDER = 'cloudflare';
    process.env.CLOUDFLARE_BUCKET_URL = 'https://storage.example';
    activity = new R2MultipartCleanupActivity(prismaMock() as any);
  });

  afterAll(() => {
    if (storageProvider === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = storageProvider;
    if (bucketUrl === undefined) delete process.env.CLOUDFLARE_BUCKET_URL;
    else process.env.CLOUDFLARE_BUCKET_URL = bucketUrl;
  });

  it('does not touch R2 when another storage provider is configured', async () => {
    process.env.STORAGE_PROVIDER = 'minio';

    await expect(
      activity.cleanupIncompleteR2MultipartUploads()
    ).resolves.toEqual({
      scanned: 0,
      aborted: 0,
      skipped: 0,
      reclaimed: 0,
    });

    expect(s3.__mockSend).not.toHaveBeenCalled();
  });

  it('inventories known prefixes, paginates root uploads, and honors the grace period', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 60 * 60 * 1000);
    s3.__mockSend
      .mockResolvedValueOnce({
        Uploads: [
          { Key: 'legacy.mp4', UploadId: 'old-root', Initiated: old },
          { Key: 'new.mp4', UploadId: 'recent-root', Initiated: recent },
        ],
        IsTruncated: true,
        NextKeyMarker: 'new.mp4',
        NextUploadIdMarker: 'recent-root',
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Uploads: [], IsTruncated: false })
      .mockResolvedValueOnce({
        Uploads: [
          { Key: 'image/old.jpg', UploadId: 'old-image', Initiated: old },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] });

    await expect(
      activity.cleanupIncompleteR2MultipartUploads()
    ).resolves.toEqual({
      scanned: 3,
      aborted: 2,
      skipped: 1,
      reclaimed: 0,
    });

    expect(
      s3.ListMultipartUploadsCommand.mock.calls.map(([input]) => input)
    ).toEqual([
      expect.objectContaining({ Prefix: '', Delimiter: '/' }),
      expect.objectContaining({
        Prefix: '',
        Delimiter: '/',
        KeyMarker: 'new.mp4',
        UploadIdMarker: 'recent-root',
      }),
      expect.objectContaining({ Prefix: 'image/' }),
      expect.objectContaining({ Prefix: 'video/' }),
      expect.objectContaining({ Prefix: 'audio/' }),
    ]);
    expect(s3.AbortMultipartUploadCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Key: 'legacy.mp4', UploadId: 'old-root' })
    );
    expect(s3.AbortMultipartUploadCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Key: 'image/old.jpg', UploadId: 'old-image' })
    );
  });

  it('retries a transient abort failure before moving to the next prefix', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    jest
      .spyOn(activity as any, 'waitForAbortRetry')
      .mockResolvedValue(undefined);
    s3.__mockSend
      .mockResolvedValueOnce({
        Uploads: [{ Key: 'legacy.mp4', UploadId: 'retry-me', Initiated: old }],
      })
      .mockRejectedValueOnce(new Error('temporary R2 error'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] });

    await expect(
      activity.cleanupIncompleteR2MultipartUploads()
    ).resolves.toEqual({
      scanned: 1,
      aborted: 1,
      skipped: 0,
      reclaimed: 0,
    });
    expect(s3.AbortMultipartUploadCommand).toHaveBeenCalledTimes(2);
    expect((activity as any).waitForAbortRetry).toHaveBeenCalledWith(1);
  });

  it('treats an upload removed by another cleaner as a successful abort', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    s3.__mockSend
      .mockResolvedValueOnce({
        Uploads: [{ Key: 'legacy.mp4', UploadId: 'gone', Initiated: old }],
      })
      .mockRejectedValueOnce({ name: 'NoSuchUpload' })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] });

    await expect(
      activity.cleanupIncompleteR2MultipartUploads()
    ).resolves.toEqual({
      scanned: 1,
      aborted: 1,
      skipped: 0,
      reclaimed: 0,
    });
  });

  it('reclaims a completed object that carries multipart metadata but has no Media row', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const media = prismaMock();
    media.media.findFirst.mockResolvedValue(null);
    (activity as any)._prisma = media;

    s3.__mockSend
      .mockResolvedValueOnce({
        Uploads: [{ Key: 'orphan.mp4', UploadId: 'stale', Initiated: old }],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({
        Contents: [
          { Key: 'rejected.mp4', LastModified: old },
          { Key: 'old.jpg', LastModified: old },
        ],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        Metadata: { 'declared-size': '1024' },
      })
      .mockResolvedValueOnce({
        Metadata: { width: '1280' },
      });

    await expect(
      activity.cleanupIncompleteR2MultipartUploads()
    ).resolves.toEqual({
      scanned: 1,
      aborted: 1,
      skipped: 0,
      reclaimed: 1,
    });

    expect(media.media.findFirst).toHaveBeenCalledWith({
      where: { path: 'https://storage.example/rejected.mp4' },
      select: { id: true },
    });
    expect(s3.ListObjectsV2Command).toHaveBeenCalledWith(
      expect.objectContaining({ Delimiter: '/' })
    );
    expect(s3.DeleteObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Key: 'rejected.mp4' })
    );
    expect(s3.DeleteObjectCommand).not.toHaveBeenCalledWith(
      expect.objectContaining({ Key: 'old.jpg' })
    );
  });

  it('skips a completed multipart object that is still referenced by a Media row', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const media = prismaMock();
    media.media.findFirst.mockResolvedValue({ id: 'media-1' });
    (activity as any)._prisma = media;

    s3.__mockSend
      .mockResolvedValueOnce({ Uploads: [], IsTruncated: false })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'accepted.mp4', LastModified: old }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({
        Metadata: { 'declared-size': '2048' },
      });

    await expect(
      activity.cleanupIncompleteR2MultipartUploads()
    ).resolves.toEqual({
      scanned: 0,
      aborted: 0,
      skipped: 0,
      reclaimed: 0,
    });
    expect(s3.DeleteObjectCommand).not.toHaveBeenCalled();
  });

  it('skips recently-completed objects still inside the grace window', async () => {
    const recent = new Date(Date.now() - 60 * 60 * 1000);
    const media = prismaMock();
    media.media.findFirst.mockResolvedValue(null);
    (activity as any)._prisma = media;

    s3.__mockSend
      .mockResolvedValueOnce({ Uploads: [], IsTruncated: false })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'in-flight.mp4', LastModified: recent }],
        IsTruncated: false,
      });

    await expect(
      activity.cleanupIncompleteR2MultipartUploads()
    ).resolves.toEqual({
      scanned: 0,
      aborted: 0,
      skipped: 0,
      reclaimed: 0,
    });
    expect(s3.HeadObjectCommand).not.toHaveBeenCalled();
    expect(s3.DeleteObjectCommand).not.toHaveBeenCalled();
  });

  it('skips the sweep when the bucket URL is not configured', async () => {
    delete process.env.CLOUDFLARE_BUCKET_URL;
    s3.__mockSend
      .mockResolvedValueOnce({ Uploads: [], IsTruncated: false })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] })
      .mockResolvedValueOnce({ Uploads: [] });

    await expect(
      activity.cleanupIncompleteR2MultipartUploads()
    ).resolves.toEqual({
      scanned: 0,
      aborted: 0,
      skipped: 0,
      reclaimed: 0,
    });
    expect(s3.ListObjectsV2Command).not.toHaveBeenCalled();
  });
});
