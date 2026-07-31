import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import 'multer';
import { makeId } from '@postsider/nestjs-libraries/services/make.is';
import { IUploadProvider, UploadedFile } from './upload.interface';
import { isSafePublicHttpsUrl } from '@postsider/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@postsider/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { parseDataUrl } from '@postsider/nestjs-libraries/upload/data.url';
import {
  ALLOWED_MIME,
  classifyMime,
  MediaKind,
} from '@postsider/nestjs-libraries/upload/mime.types';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fromBuffer } = require('file-type');

// Cap for remote media downloads (matches the multipart video ceiling).
const MAX_REMOTE_MEDIA_BYTES = 500 * 1024 * 1024;

/**
 * MinIO storage provider — S3-compatible, self-hosted object storage.
 *
 * Env vars:
 *   MINIO_ENDPOINT        — e.g. "http://postsider-minio:9000"
 *   MINIO_ACCESS_KEY      — root user or service account access key
 *   MINIO_SECRET_KEY      — corresponding secret key
 *   MINIO_BUCKET          — bucket name (created automatically by MinIO init)
 *   MINIO_PUBLIC_URL      — public-facing URL for serving files, e.g. "https://app.postsider.com/storage"
 */
class MinioStorage implements IUploadProvider {
  private _client: S3Client;

  constructor(
    private _endpoint: string,
    private _accessKey: string,
    private _secretKey: string,
    private _bucket: string,
    private _publicUrl: string
  ) {
    this._client = new S3Client({
      endpoint: this._endpoint,
      region: 'us-east-1', // MinIO ignores this but the SDK requires it
      credentials: {
        accessKeyId: this._accessKey,
        secretAccessKey: this._secretKey,
      },
      forcePathStyle: true, // Required for MinIO (path-style access)
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  }

  private buildKey(kind: MediaKind, ext: string) {
    return `${kind}/${makeId(10)}.${ext}`;
  }

  async uploadSimple(input: string): Promise<string> {
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
        // @ts-ignore — undici option
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

    const detected = await fromBuffer(body);
    if (!detected || !ALLOWED_MIME.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }
    const kind = classifyMime(detected.mime);
    const key = this.buildKey(kind, detected.ext);

    await this._client.send(
      new PutObjectCommand({
        Bucket: this._bucket,
        Key: key,
        Body: body,
        ContentType: detected.mime,
      })
    );

    return `${this._publicUrl}/${key}`;
  }

  async uploadFile(file: Express.Multer.File): Promise<UploadedFile> {
    try {
      const detected = await fromBuffer(file.buffer);
      if (!detected || !ALLOWED_MIME.has(detected.mime)) {
        throw new Error('Unsupported file type.');
      }
      const kind = classifyMime(detected.mime);
      const key = this.buildKey(kind, detected.ext);

      await this._client.send(
        new PutObjectCommand({
          Bucket: this._bucket,
          Key: key,
          Body: file.buffer,
          ContentType: detected.mime,
        })
      );

      const filename = key.split('/').pop()!;
      return {
        filename,
        path: `${this._publicUrl}/${key}`,
        mimetype: detected.mime,
        originalname: filename,
        kind,
      };
    } catch (err) {
      console.error('Error uploading file to MinIO:', err);
      throw err;
    }
  }

  async removeFile(filePath: string): Promise<void> {
    if (!filePath) return;

    let key: string | null = null;

    if (filePath.startsWith(this._publicUrl)) {
      key = filePath.slice(this._publicUrl.length).replace(/^\/+/, '');
    } else {
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
          Bucket: this._bucket,
          Key: key,
        })
      );
    } catch (err: any) {
      const status = err?.$metadata?.httpStatusCode;
      const code = err?.name || err?.Code;
      if (status === 404 || code === 'NoSuchKey') return;
      throw err;
    }
  }
}

export { MinioStorage };
export default MinioStorage;
