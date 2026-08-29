jest.mock('@aws-sdk/client-s3', () => ({
  __mockSend: jest.fn(),
  UploadPartCommand: jest.fn(),
  S3Client: jest.fn(() => ({
    send: jest.requireMock('@aws-sdk/client-s3').__mockSend,
  })),
  ListPartsCommand: jest.fn(),
  CreateMultipartUploadCommand: jest.fn(),
  CompleteMultipartUploadCommand: jest.fn(),
  AbortMultipartUploadCommand: jest.fn(),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  HeadObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(async () => 'https://presigned.example/part'),
}));

jest.mock('@postsider/nestjs-libraries/upload/detect-file-type', () => ({
  detectFileType: jest.fn(),
}));

import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  multipartUploadSizeMatches,
  parseMultipartUploadSize,
  prepareUploadParts,
  signPart,
  simpleUpload,
} from './r2.uploader';
import { maxUploadBytesForMime, UPLOAD_MAX_FILE_BYTES } from './upload.limits';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';

const mockSend = (
  jest.requireMock('@aws-sdk/client-s3') as {
    __mockSend: jest.Mock;
  }
).__mockSend;
const mockDetectFileType = (
  jest.requireMock('@postsider/nestjs-libraries/upload/detect-file-type') as {
    detectFileType: jest.Mock;
  }
).detectFileType;

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
}

function request(
  body: Record<string, unknown>,
  owner = { orgId: 'org_1', userId: 'user_1' }
) {
  return {
    body,
    org: { id: owner.orgId },
    user: { id: owner.userId },
  } as any;
}

async function createSession(
  owner = { orgId: 'org_1', userId: 'user_1' },
  size = 42
) {
  const res = response();
  mockSend.mockResolvedValueOnce({ UploadId: 'upload_1', Key: 'video.mp4' });
  await createMultipartUpload(
    request({ file: { name: 'video.mp4', size } }, owner),
    res
  );
  return res;
}

describe('R2 multipart size validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockDetectFileType.mockReset();
  });

  it('accepts only bounded non-negative integer declared sizes', () => {
    expect(parseMultipartUploadSize(0)).toBe(0);
    expect(parseMultipartUploadSize('42')).toBe(42);
    expect(parseMultipartUploadSize(-1)).toBeNull();
    expect(parseMultipartUploadSize('42.5')).toBeNull();
    expect(parseMultipartUploadSize(UPLOAD_MAX_FILE_BYTES + 1)).toBeNull();
  });

  it('rejects R2 objects whose actual size differs from the declaration', () => {
    expect(multipartUploadSizeMatches('42', 42)).toBe(true);
    expect(multipartUploadSizeMatches('42', 43)).toBe(false);
    expect(multipartUploadSizeMatches(undefined, 42)).toBe(false);
  });

  it('enforces the direct-upload cap for each media kind', () => {
    const imageLimit = maxUploadBytesForMime('image/jpeg');
    const videoLimit = maxUploadBytesForMime('video/mp4');
    const audioLimit = maxUploadBytesForMime('audio/mpeg');

    expect(imageLimit).toBe(10 * 1024 * 1024);
    expect(videoLimit).toBe(500 * 1024 * 1024);
    expect(audioLimit).toBe(50 * 1024 * 1024);
    expect(parseMultipartUploadSize(imageLimit, imageLimit)).toBe(imageLimit);
    expect(parseMultipartUploadSize(imageLimit + 1, imageLimit)).toBeNull();
    expect(parseMultipartUploadSize(videoLimit, videoLimit)).toBe(videoLimit);
    expect(parseMultipartUploadSize(videoLimit + 1, videoLimit)).toBeNull();
    expect(parseMultipartUploadSize(audioLimit, audioLimit)).toBe(audioLimit);
    expect(parseMultipartUploadSize(audioLimit + 1, audioLimit)).toBeNull();
  });

  it('rejects an over-limit simple upload before it reaches R2', async () => {
    const imageLimit = maxUploadBytesForMime('image/jpeg');
    mockDetectFileType.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });

    await expect(
      simpleUpload(Buffer.alloc(imageLimit + 1), 'image.jpg', 'image/jpeg')
    ).rejects.toThrow('File too large.');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('persists through the completion callback before replying', async () => {
    process.env.CLOUDFLARE_BUCKET_URL = 'https://storage.example';
    const res = response();
    const onComplete = jest.fn().mockResolvedValue({
      Location: 'https://storage.example/video.mp4',
      saved: { id: 'media_1' },
    });

    await createSession();
    mockSend
      .mockResolvedValueOnce({ Location: 'https://r2.example/video.mp4' })
      .mockResolvedValueOnce({
        ContentLength: 42,
        Metadata: { 'declared-size': '42', 'original-name': 'clip.mp4' },
      })
      .mockResolvedValueOnce({
        Body: (async function* () {
          yield Buffer.from('video');
        })(),
      });
    mockDetectFileType.mockResolvedValue({ mime: 'video/mp4', ext: 'mp4' });

    await completeMultipartUpload(
      request({
        key: 'video.mp4',
        uploadId: 'upload_1',
        parts: [{ PartNumber: 1, ETag: 'etag_1' }],
      }),
      res,
      onComplete
    );

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'video.mp4',
        location: 'https://storage.example/video.mp4',
        originalName: 'clip.mp4',
        type: 'video',
        size: 42,
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      Location: 'https://storage.example/video.mp4',
      saved: { id: 'media_1' },
    });
  });

  it('does not issue part URLs to a different tenant or user', async () => {
    await createSession();
    const res = response();

    await prepareUploadParts(
      request(
        {
          partData: {
            key: 'video.mp4',
            uploadId: 'upload_1',
            parts: [{ number: 1 }],
          },
        },
        { orgId: 'org_2', userId: 'user_2' }
      ),
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockSend).toHaveBeenCalledTimes(1);

    await abortMultipartUpload(
      request({ key: 'video.mp4', uploadId: 'upload_1' }),
      response()
    );
  });

  it('atomically reserves no more than four owner sessions before creating R2 uploads', async () => {
    const sessions = [1, 2, 3, 4].map((number) => ({
      UploadId: `upload_cap_${number}`,
      Key: `video_cap_${number}.mp4`,
    }));
    mockSend.mockResolvedValueOnce(sessions[0]);
    mockSend.mockResolvedValueOnce(sessions[1]);
    mockSend.mockResolvedValueOnce(sessions[2]);
    mockSend.mockResolvedValueOnce(sessions[3]);

    const responses = await Promise.all(
      [1, 2, 3, 4].map(async (number) => {
        const res = response();
        await createMultipartUpload(
          request({ file: { name: `video_${number}.mp4`, size: 42 } }),
          res
        );
        return res;
      })
    );
    for (const res of responses) expect(res.status).toHaveBeenCalledWith(200);

    const overCap = response();
    await createMultipartUpload(
      request({ file: { name: 'video_5.mp4', size: 42 } }),
      overCap
    );

    expect(overCap.status).toHaveBeenCalledWith(429);
    expect(mockSend).toHaveBeenCalledTimes(4);

    for (const session of sessions) {
      await abortMultipartUpload(
        request({ key: session.Key, uploadId: session.UploadId }),
        response()
      );
    }
  });

  it('retries a failed R2 abort and releases the owner slot only after success', async () => {
    await createSession();
    mockSend
      .mockRejectedValueOnce(new Error('temporary R2 failure'))
      .mockRejectedValueOnce(new Error('temporary R2 failure'))
      .mockResolvedValueOnce({});
    const res = response();

    await abortMultipartUpload(
      request({ key: 'video.mp4', uploadId: 'upload_1' }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it('aborts a session with out-of-range or malformed completion parts', async () => {
    await createSession(undefined, 5 * 1024 * 1024);
    const res = response();

    await completeMultipartUpload(
      request({
        key: 'video.mp4',
        uploadId: 'upload_1',
        parts: [{ PartNumber: 2, ETag: 'etag_2' }],
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(
      jest.requireMock('@aws-sdk/client-s3').AbortMultipartUploadCommand
    ).toHaveBeenCalledWith(
      expect.objectContaining({ Key: 'video.mp4', UploadId: 'upload_1' })
    );
  });

  it('aborts abandoned sessions when their presigned URLs expire', async () => {
    jest.useFakeTimers();
    try {
      await createSession();

      await jest.advanceTimersByTimeAsync(15 * 60 * 1000);

      expect(
        jest.requireMock('@aws-sdk/client-s3').AbortMultipartUploadCommand
      ).toHaveBeenCalledWith(
        expect.objectContaining({ Key: 'video.mp4', UploadId: 'upload_1' })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('extends the session TTL on part progress and aborts only when progress stops', async () => {
    jest.useFakeTimers();
    try {
      await createSession();
      const slotKey = 'r2:multipart:owner:org_1%3Auser_1:slot:1';

      // With no progress the slot TTL and session both approach the 15 min cap.
      await jest.advanceTimersByTimeAsync(14 * 60 * 1000);
      expect(await ioRedis.ttl(slotKey)).toBeLessThan(120);

      // Part activity extends the session AND its owner slot atomically.
      const res = response();
      await signPart(
        request({ key: 'video.mp4', uploadId: 'upload_1', partNumber: 1 }),
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(await ioRedis.ttl(slotKey)).toBeGreaterThan(800);

      // The original expiry timer fires at 15 min, sees the extension, and
      // re-arms instead of aborting the still-moving upload.
      await jest.advanceTimersByTimeAsync(60 * 1000);
      expect(
        jest.requireMock('@aws-sdk/client-s3').AbortMultipartUploadCommand
      ).not.toHaveBeenCalled();

      // Once progress stops, the re-armed timer aborts at the extended expiry.
      await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(
        jest.requireMock('@aws-sdk/client-s3').AbortMultipartUploadCommand
      ).toHaveBeenCalledWith(
        expect.objectContaining({ Key: 'video.mp4', UploadId: 'upload_1' })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('removes an object when post-completion verification fails', async () => {
    await createSession();
    const res = response();
    mockSend
      .mockResolvedValueOnce({ Location: 'https://r2.example/video.mp4' })
      .mockResolvedValueOnce({
        ContentLength: 42,
        Metadata: { 'declared-size': '42' },
      })
      .mockResolvedValueOnce({
        Body: (async function* () {
          yield Buffer.from('not-a-video');
        })(),
      });
    mockDetectFileType.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });

    await completeMultipartUpload(
      request({
        key: 'video.mp4',
        uploadId: 'upload_1',
        parts: [{ PartNumber: 1, ETag: 'etag_1' }],
      }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(
      jest.requireMock('@aws-sdk/client-s3').DeleteObjectCommand
    ).toHaveBeenCalledWith(expect.objectContaining({ Key: 'video.mp4' }));
  });
});
