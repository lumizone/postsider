import { MediaKind } from './mime.types';

export interface UploadedFile {
  filename: string;
  path: string;
  mimetype: string;
  originalname: string;
  kind: MediaKind;
}

export interface IUploadProvider {
  /**
   * Upload from a remote URL or `data:` URL. Returns the public URL of the
   * stored file. Implementations MUST sniff the actual MIME type from bytes
   * (never trust the source) and reject anything outside the shared allow-list.
   */
  uploadSimple(path: string): Promise<string>;

  /**
   * Upload a multipart file. Returns the stored object metadata including the
   * detected MediaKind so callers can persist it on `Media.type`.
   */
  uploadFile(file: Express.Multer.File): Promise<UploadedFile>;

  /**
   * Permanently remove a previously stored file. The argument is whatever the
   * provider returned from `uploadSimple`/`uploadFile.path` (a public URL).
   * Implementations are responsible for translating the URL back to the
   * provider-specific key/path. Must be idempotent: removing a file that does
   * not exist is not an error.
   */
  removeFile(filePath: string): Promise<void>;
}
