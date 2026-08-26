import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import 'multer';
import { randomStorageName } from '@postsider/nestjs-libraries/upload/storage-key';
import { IUploadProvider, UploadedFile } from './upload.interface';
import { isSafePublicHttpsUrl } from '@postsider/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { parseDataUrl } from '@postsider/nestjs-libraries/upload/data.url';
import {
  ALLOWED_MIME,
  classifyMime,
  MediaKind,
} from '@postsider/nestjs-libraries/upload/mime.types';
import { detectFileType } from '@postsider/nestjs-libraries/upload/detect-file-type';

// Cap for remote media downloads (matches the multipart video ceiling).
const MAX_REMOTE_MEDIA_BYTES = 500 * 1024 * 1024;

class CloudflareStorage implements IUploadProvider {
  private _client: S3Client;

  constructor(
    accountID: string,
    accessKey: string,
    secretKey: string,
    private region: string,
    private _bucketName: string,
    private _uploadUrl: string
  ) {
    this._client = new S3Client({
      endpoint: `https://${accountID}.r2.cloudflarestorage.com`,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });

    // R2 rejects requests carrying the AWS SDK's default checksum headers.
    // Strip them on every outgoing request so PutObject keeps working without
    // having to opt out per-call.
    this._client.middlewareStack.add(
      (next) =>
        async (args): Promise<any> => {
          const request = args.request as RequestInit;

          const headers = request.headers as Record<string, string>;
          delete headers['x-amz-checksum-crc32'];
          delete headers['x-amz-checksum-crc32c'];
          delete headers['x-amz-checksum-sha1'];
          delete headers['x-amz-checksum-sha256'];
          request.headers = headers;

          return next(args);
        },
      { step: 'build', name: 'customHeaders' }
    );
  }

  /**
   * Build the R2 object key. We partition by media kind first so listing,
   * lifecycle rules and CDN cache settings can target a single class of media.
   */
  private buildKey(kind: MediaKind, ext: string) {
    return `${kind}/${randomStorageName()}.${ext}`;
  }

  async uploadSimple(input: string) {
    const dataUrl = input.startsWith('data:') ? parseDataUrl(input) : null;

    let body: Buffer;
    if (dataUrl) {
      body = dataUrl.buffer;
    } else {
      if (!(await isSafePublicHttpsUrl(input))) {
        throw new Error('Unsafe URL');
      }
      const loadImage = await fetch(input, {
        signal: AbortSignal.timeout(15000),
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: ssrfSafeDispatcher,
      });
      if (!loadImage.ok) {
        throw new Error(`Failed to fetch media: ${loadImage.status}`);
      }
      const declared = Number(loadImage.headers.get('content-length') ?? 0);
      if (declared > MAX_REMOTE_MEDIA_BYTES) {
        throw new Error('Remote media too large');
      }
      body = Buffer.from(await loadImage.arrayBuffer());
      if (body.byteLength > MAX_REMOTE_MEDIA_BYTES) {
        throw new Error('Remote media too large');
      }
    }

    const detected = await detectFileType(body);
    if (!detected || !ALLOWED_MIME.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }
    const kind = classifyMime(detected.mime);
    const key = this.buildKey(kind, detected.ext);

    await this._client.send(
      new PutObjectCommand({
        Bucket: this._bucketName,
        Key: key,
        Body: body,
        ContentType: detected.mime,
      })
    );

    return `${this._uploadUrl}/${key}`;
  }

  async uploadFile(file: Express.Multer.File): Promise<UploadedFile> {
    try {
      const detected = await detectFileType(file.buffer);
      if (!detected || !ALLOWED_MIME.has(detected.mime)) {
        throw new Error('Unsupported file type.');
      }
      const kind = classifyMime(detected.mime);
      const key = this.buildKey(kind, detected.ext);

      await this._client.send(
        new PutObjectCommand({
          Bucket: this._bucketName,
          ACL: 'public-read',
          Key: key,
          Body: file.buffer,
          ContentType: detected.mime,
        })
      );

      const filename = key.split('/').pop()!;
      return {
        filename,
        path: `${this._uploadUrl}/${key}`,
        mimetype: detected.mime,
        originalname: filename,
        kind,
      };
    } catch (err) {
      console.error('Error uploading file to Cloudflare R2:', err);
      throw err;
    }
  }

  /**
   * Permanently delete an object from the bucket.
   *
   * The argument is the public URL we previously returned. We strip the
   * configured upload-URL prefix to recover the actual R2 object key and
   * then issue `DeleteObject`. Idempotent: a missing object is silently
   * ignored so this is safe to call from a soft-delete trigger.
   */
  async removeFile(filePath: string): Promise<void> {
    if (!filePath) return;

    let key: string | null = null;

    if (filePath.startsWith(this._uploadUrl)) {
      key = filePath.slice(this._uploadUrl.length).replace(/^\/+/, '');
    } else {
      // Best-effort fallback for absolute URLs that don't share our exact
      // configured base (e.g. custom domain): take the URL path sans leading
      // slash and treat it as the key.
      try {
        key = new URL(filePath).pathname.replace(/^\/+/, '');
      } catch {
        key = null;
      }
    }

    if (!key) return;

    try {
      await this._client.send(
        new DeleteObjectCommand({
          Bucket: this._bucketName,
          Key: key,
        })
      );
    } catch (err: any) {
      // Treat 404/NoSuchKey as success so soft-delete + cleanup is idempotent.
      const status = err?.$metadata?.httpStatusCode;
      const code = err?.name || err?.Code;
      if (status === 404 || code === 'NoSuchKey') return;
      throw err;
    }
  }
}

export { CloudflareStorage };
export default CloudflareStorage;
