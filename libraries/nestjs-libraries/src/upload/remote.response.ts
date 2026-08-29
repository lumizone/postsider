import { mkdtemp, open, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import pLimit from 'p-limit';
import { detectFileType } from '@postsider/nestjs-libraries/upload/detect-file-type';
import {
  maxUploadBytesForMime,
  UPLOAD_MAX_FILE_BYTES,
} from '@postsider/nestjs-libraries/upload/upload.limits';

// Remote media is supplied by an untrusted server and must be buffered by the
// legacy storage interface. Known media kinds inherit the app's own per-kind
// allowance (image 10 MiB, audio 50 MiB, video up to 500 MiB) via
// remoteMediaMaxBytesForMime, so large video URL imports that multipart uploads
// already accept keep working. Bytes that cannot be classified fall back to
// this conservative ceiling instead of the video limit.
export const REMOTE_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

// The serialized remote-media section holds a single global permit, so a hung
// upstream read or storage call must not be able to block every remote upload
// forever. Env-tunable; also cancels the in-flight stream when it fires.
function remoteMediaTimeoutMs(): number {
  return Number(process.env.REMOTE_MEDIA_TIMEOUT_MS || 60_000);
}

// The leading bytes that decide which kind-specific ceiling applies.
const REMOTE_MEDIA_SNIFF_BYTES = 8192;

// A single remote upload can consume its full cap in both /tmp and heap while
// it is handed to the legacy Buffer-based storage providers. Serialize that
// expensive section so concurrent requests cannot multiply the reservation.
const remoteMediaLimit = pLimit(1);

export class RemoteMediaTooLargeError extends Error {
  constructor() {
    super('Remote media too large');
    this.name = 'RemoteMediaTooLargeError';
  }
}

/**
 * Kind-specific ceiling for remote media, aligned with the app's own per-kind
 * upload allowance (see upload.limits.ts). Unknown MIME types keep the low
 * unclassified default rather than inheriting the video ceiling.
 */
export function remoteMediaMaxBytesForMime(mime: string): number {
  const kindLimit = maxUploadBytesForMime(mime);
  return kindLimit > 0 ? kindLimit : REMOTE_MEDIA_MAX_BYTES;
}

export async function readRemoteResponse(
  response: Response,
  maxBytes?: number
): Promise<Buffer> {
  const controller = new AbortController();
  return remoteMediaLimit(() =>
    withDeadline(
      readResponseToBuffer(response, maxBytes, controller.signal),
      remoteMediaTimeoutMs(),
      controller
    )
  );
}

/**
 * Runs the full remote-media lifecycle under one permit. Callers must use the
 * supplied reader so download, detection, storage, and probing cannot retain
 * several large remote buffers concurrently. A hung operation is aborted after
 * remoteMediaTimeoutMs and the permit is released so no single storage call can
 * block all remote uploads forever.
 */
export function withRemoteMediaPermit<T>(
  operation: (
    readResponse: (response: Response, maxBytes?: number) => Promise<Buffer>
  ) => Promise<T>
): Promise<T> {
  return remoteMediaLimit(() => {
    const controller = new AbortController();
    return withDeadline(
      operation((response, maxBytes) =>
        readResponseToBuffer(response, maxBytes, controller.signal)
      ),
      remoteMediaTimeoutMs(),
      controller
    );
  });
}

function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  controller: AbortController
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('Remote media operation timed out');
      controller.abort(error);
      reject(error);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function readResponseToBuffer(
  response: Response,
  maxBytes: number | undefined,
  signal?: AbortSignal
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? 0);

  // Absolute ceiling: nothing buffered by the legacy storage path may exceed
  // the generic file limit, even before the bytes are classified.
  if (declared > UPLOAD_MAX_FILE_BYTES) {
    const error = new RemoteMediaTooLargeError();
    await response.body?.cancel(error).catch(() => undefined);
    throw error;
  }

  if (!response.body) {
    throw new Error('Remote response has no body');
  }

  const reader = response.body.getReader();
  const directory = await mkdtemp(join(tmpdir(), 'postsider-remote-'));
  const filePath = join(directory, 'body');
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let totalBytes = 0;
  let enforcedMaxBytes = maxBytes;

  try {
    file = await open(filePath, 'wx');

    if (enforcedMaxBytes === undefined) {
      // Peek at the leading bytes to classify the media, then enforce the same
      // per-kind allowance the rest of the upload layer uses: videos may
      // legitimately reach the 500 MiB ceiling while images/audio stay tight.
      const prefix: Buffer[] = [];
      let prefixBytes = 0;
      while (prefixBytes < REMOTE_MEDIA_SNIFF_BYTES) {
        const { done, value } = await abortable(reader.read(), signal);
        if (done) break;
        if (!value) continue;
        const take = Math.min(
          value.byteLength,
          REMOTE_MEDIA_SNIFF_BYTES - prefixBytes
        );
        prefix.push(Buffer.from(value.subarray(0, take)));
        prefixBytes += take;
        await file.write(value);
        totalBytes += value.byteLength;
      }
      const detected = await detectFileType(Buffer.concat(prefix));
      enforcedMaxBytes = detected
        ? remoteMediaMaxBytesForMime(detected.mime)
        : REMOTE_MEDIA_MAX_BYTES;
    }

    // Declared length is checked here because the sniffed ceiling is what
    // actually applies. Check before continuing so a lying server is stopped
    // after the sniff window instead of after a full download.
    if (declared > enforcedMaxBytes || totalBytes > enforcedMaxBytes) {
      throw new RemoteMediaTooLargeError();
    }

    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (!value) continue;

      // Check before persisting the chunk so chunked responses cannot exceed
      // the enforced ceiling.
      if (value.byteLength > enforcedMaxBytes - totalBytes) {
        throw new RemoteMediaTooLargeError();
      }

      await file.write(value);
      totalBytes += value.byteLength;
    }

    await file.close();
    file = undefined;
    return await readFile(filePath);
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    await file?.close().catch(() => undefined);
    reader.releaseLock();
    await rm(directory, { force: true, recursive: true }).catch(
      () => undefined
    );
  }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}
