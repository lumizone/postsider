import { IUploadProvider, UploadedFile } from './upload.interface';
import { mkdirSync, unlink, writeFileSync } from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
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

export class LocalStorage implements IUploadProvider {
  constructor(private uploadDirectory: string) {}

  /**
   * Build the on-disk path and the public URL path for a freshly generated
   * filename. Files are partitioned by media kind first, then by upload date,
   * so that CDN/cache rules and bulk operations can target a single class of
   * media without iterating the whole tree.
   */
  private buildPaths(kind: MediaKind, ext: string) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const innerPath = `/${kind}/${year}/${month}/${day}`;
    const dir = `${this.uploadDirectory}${innerPath}`;
    mkdirSync(dir, { recursive: true });

    // These names are the only access control on publicly served /uploads/*
    // assets — they must be cryptographically random (Math.random is
    // predictable, and the old rounding could emit length-31 or over-weighted
    // 0/1 hex digits).
    const randomName = randomBytes(16).toString('hex');

    return {
      filePath: `${dir}/${randomName}.${ext}`,
      publicPath: `${innerPath}/${randomName}.${ext}`,
    };
  }

  /**
   * Compose the public URL backend exposes for a stored asset.
   *
   * Prefer `BACKEND_URL` when set (the headless, agent-bridge deployment that
   * has no frontend at all). Fall back to `FRONTEND_URL` for legacy setups
   * where a separate web app reverse-proxies `/uploads/*` to the backend.
   */
  private publicUrl(publicPath: string) {
    const base = process.env.BACKEND_URL || process.env.FRONTEND_URL || '';
    return `${base}/uploads${publicPath}`;
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

    // Never trust the claimed mime/extension (data URL header, remote
    // content-type, or URL path): sniff the real type from the bytes and
    // only accept the allow-list, otherwise an attacker could write an
    // arbitrary file (e.g. .html/.svg with embedded script) into the
    // publicly served uploads directory on the app's own origin.
    const detected = await detectFileType(body);
    if (!detected || !ALLOWED_MIME.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }
    const kind = classifyMime(detected.mime);
    const { filePath, publicPath } = this.buildPaths(kind, detected.ext);

    writeFileSync(filePath, body);

    return this.publicUrl(publicPath);
  }

  async uploadFile(file: Express.Multer.File): Promise<UploadedFile> {
    try {
      const detected = await detectFileType(file.buffer);
      if (!detected || !ALLOWED_MIME.has(detected.mime)) {
        throw new Error('Unsupported file type.');
      }
      const kind = classifyMime(detected.mime);
      const safeExt = detected.ext;
      const safeMime = detected.mime;

      const { filePath, publicPath } = this.buildPaths(kind, safeExt);
      writeFileSync(filePath, file.buffer);

      const filename = path.basename(filePath);
      return {
        filename,
        path: this.publicUrl(publicPath),
        mimetype: safeMime,
        originalname: filename,
        kind,
      };
    } catch (err) {
      console.error('Error uploading file to Local Storage:', err);
      throw err;
    }
  }

  /**
   * Translate a public URL back to a local filesystem path and unlink it.
   *
   * Idempotent — missing files do not throw, because the only legitimate
   * caller is `MediaService.deleteMedia` and a partial state where the DB
   * row exists but the file was already cleaned up should not block the
   * delete flow.
   */
  async removeFile(filePath: string): Promise<void> {
    let publicPath: string;
    try {
      // Accept both absolute URLs and bare `/uploads/...` paths.
      publicPath = filePath.startsWith('http')
        ? new URL(filePath).pathname
        : filePath;
    } catch {
      return;
    }

    const marker = '/uploads';
    const idx = publicPath.indexOf(marker);
    if (idx === -1) return;
    const inner = publicPath.slice(idx + marker.length);

    // Refuse path traversal: only accept paths that resolve under the
    // configured upload directory.
    const resolved = path.resolve(this.uploadDirectory, '.' + inner);
    const root = path.resolve(this.uploadDirectory);
    if (!resolved.startsWith(root + path.sep)) return;

    return new Promise((resolve) => {
      unlink(resolved, () => resolve());
    });
  }
}
