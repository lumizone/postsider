jest.mock('@postsider/nestjs-libraries/upload/detect-file-type', () => ({
  detectFileType: jest.fn(),
}));

import {
  REMOTE_MEDIA_MAX_BYTES,
  readRemoteResponse,
  remoteMediaMaxBytesForMime,
  RemoteMediaTooLargeError,
  withRemoteMediaPermit,
} from './remote.response';
import { detectFileType } from '@postsider/nestjs-libraries/upload/detect-file-type';
import { UPLOAD_MAX_FILE_BYTES } from './upload.limits';

const mockDetectFileType = detectFileType as jest.Mock;

function responseFromChunks(
  chunks: Uint8Array[],
  headers?: HeadersInit,
  onCancel?: (reason: unknown) => void
) {
  let index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        const chunk = chunks[index++];
        if (chunk) {
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
      cancel: onCancel,
    }),
    { headers }
  );
}

describe('remoteMediaMaxBytesForMime', () => {
  it('aligns known kinds with the app upload allowance', () => {
    expect(remoteMediaMaxBytesForMime('image/jpeg')).toBe(10 * 1024 * 1024);
    expect(remoteMediaMaxBytesForMime('audio/mpeg')).toBe(50 * 1024 * 1024);
    // Videos inherit the 500 MiB allowance so large URL imports keep working.
    expect(remoteMediaMaxBytesForMime('video/mp4')).toBe(500 * 1024 * 1024);
  });

  it('keeps the low conservative cap for unclassifiable mime types', () => {
    expect(remoteMediaMaxBytesForMime('application/octet-stream')).toBe(
      REMOTE_MEDIA_MAX_BYTES
    );
  });
});

describe('readRemoteResponse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDetectFileType.mockReset();
  });

  it('buffers streamed chunks up to the configured limit', async () => {
    const response = responseFromChunks([
      Buffer.from('safe '),
      Buffer.from('media'),
    ]);

    await expect(readRemoteResponse(response, 10)).resolves.toEqual(
      Buffer.from('safe media')
    );
  });

  it('rejects chunked responses before adding the over-limit chunk', async () => {
    const response = responseFromChunks([
      Buffer.from('safe'),
      Buffer.from('media'),
    ]);

    await expect(readRemoteResponse(response, 8)).rejects.toBeInstanceOf(
      RemoteMediaTooLargeError
    );
  });

  it('cancels an oversized declared response before rejecting it', async () => {
    const onCancel = jest.fn();
    const response = {
      body: new ReadableStream({ cancel: onCancel }),
      headers: new Headers({ 'content-length': '9' }),
    } as unknown as Response;

    await expect(readRemoteResponse(response, 8)).rejects.toBeInstanceOf(
      RemoteMediaTooLargeError
    );
    expect(onCancel).toHaveBeenCalledWith(expect.any(RemoteMediaTooLargeError));
  });

  it('rejects a declared size above the absolute file ceiling without reading', async () => {
    const onCancel = jest.fn();
    const response = {
      body: new ReadableStream({ cancel: onCancel }),
      headers: new Headers({
        'content-length': String(UPLOAD_MAX_FILE_BYTES + 1),
      }),
    } as unknown as Response;

    await expect(readRemoteResponse(response)).rejects.toBeInstanceOf(
      RemoteMediaTooLargeError
    );
    expect(onCancel).toHaveBeenCalledWith(expect.any(RemoteMediaTooLargeError));
  });

  it('applies the video ceiling to a remote video URL import', async () => {
    mockDetectFileType.mockResolvedValue({ mime: 'video/mp4', ext: 'mp4' });
    const response = responseFromChunks([Buffer.from('video-bytes')], {
      'content-length': '400000000',
    });

    await expect(readRemoteResponse(response)).resolves.toEqual(
      Buffer.from('video-bytes')
    );
    expect(mockDetectFileType).toHaveBeenCalled();
  });

  it('applies the image ceiling to a remote image URL import', async () => {
    mockDetectFileType.mockResolvedValue({ mime: 'image/jpeg', ext: 'jpg' });
    const response = responseFromChunks([Buffer.from('tiny-image')], {
      'content-length': String(11 * 1024 * 1024),
    });

    await expect(readRemoteResponse(response)).rejects.toBeInstanceOf(
      RemoteMediaTooLargeError
    );
  });

  it('falls back to the low default cap when bytes cannot be classified', async () => {
    mockDetectFileType.mockResolvedValue(undefined);
    const response = responseFromChunks([Buffer.from('mystery')], {
      'content-length': String(REMOTE_MEDIA_MAX_BYTES + 1),
    });

    await expect(readRemoteResponse(response)).rejects.toBeInstanceOf(
      RemoteMediaTooLargeError
    );
    expect(REMOTE_MEDIA_MAX_BYTES).toBe(25 * 1024 * 1024);
  });

  it('holds one permit for the complete remote-media lifecycle', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const started: string[] = [];

    const first = withRemoteMediaPermit(async () => {
      started.push('first');
      await firstGate;
    });
    await Promise.resolve();
    const second = withRemoteMediaPermit(async () => {
      started.push('second');
    });

    expect(started).toEqual(['first']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(started).toEqual(['first', 'second']);
  });

  it('releases the permit when a hung remote-media operation exceeds the deadline', async () => {
    const previous = process.env.REMOTE_MEDIA_TIMEOUT_MS;
    process.env.REMOTE_MEDIA_TIMEOUT_MS = '40';
    try {
      const hung = withRemoteMediaPermit(
        () => new Promise<void>(() => undefined)
      );
      await expect(hung).rejects.toThrow('Remote media operation timed out');

      // The single global permit was released — a later upload can proceed.
      await expect(withRemoteMediaPermit(async () => 'ok')).resolves.toBe(
        'ok'
      );
    } finally {
      if (previous === undefined) delete process.env.REMOTE_MEDIA_TIMEOUT_MS;
      else process.env.REMOTE_MEDIA_TIMEOUT_MS = previous;
    }
  });
});
