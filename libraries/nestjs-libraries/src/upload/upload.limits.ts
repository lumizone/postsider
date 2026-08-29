/**
 * Multer options for every file-upload endpoint.
 *
 * Without an explicit limit multer buffers the WHOLE multipart body in the
 * backend's heap (MemoryStorage), and nginx used to allow 2GB — so a single large
 * upload could blow the container past its cgroup memory limit and let the
 * kernel OOM-kill the backend or the orchestrator mid-publish (2026-07-22
 * audit). Keep this at or below the nginx `client_max_body_size`
 * (var/docker/nginx.conf and the host proxy), which enforces the same cap one
 * layer earlier.
 */
export const UPLOAD_MAX_FILE_MB = Number(process.env.MAX_UPLOAD_MB || 512);
export const UPLOAD_MAX_FILE_BYTES = UPLOAD_MAX_FILE_MB * 1024 * 1024;
export const UPLOAD_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const UPLOAD_MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const UPLOAD_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const CSV_UPLOAD_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const CSV_IMPORT_FIELD_VALUE_MAX_BYTES = 5;
// File endpoints should tolerate ordinary client metadata without allowing
// multipart fields to become an unbounded second request body.
export const UPLOAD_MAX_FIELD_COUNT = 10;
export const UPLOAD_FIELD_NAME_MAX_BYTES = 100;
export const UPLOAD_FIELD_VALUE_MAX_BYTES = 64 * 1024;

export function maxUploadBytesForMime(mimeType: string): number {
  const kindLimit = mimeType.startsWith('image/')
    ? UPLOAD_MAX_IMAGE_BYTES
    : mimeType.startsWith('video/')
    ? UPLOAD_MAX_VIDEO_BYTES
    : mimeType.startsWith('audio/')
    ? UPLOAD_MAX_AUDIO_BYTES
    : 0;

  return Math.min(kindLimit, UPLOAD_MAX_FILE_BYTES);
}

export const uploadInterceptorOptions = {
  limits: {
    fileSize: UPLOAD_MAX_FILE_BYTES,
    files: 1,
    fields: UPLOAD_MAX_FIELD_COUNT,
    parts: UPLOAD_MAX_FIELD_COUNT + 1,
    fieldNameSize: UPLOAD_FIELD_NAME_MAX_BYTES,
    fieldSize: UPLOAD_FIELD_VALUE_MAX_BYTES,
  },
};

export const csvImportInterceptorOptions = {
  limits: {
    fileSize: CSV_UPLOAD_MAX_FILE_BYTES,
    files: 1,
    // CSV import accepts one file and an optional `asDraft=true|false` field.
    fields: 1,
    parts: 2,
    fieldNameSize: 16,
    fieldSize: CSV_IMPORT_FIELD_VALUE_MAX_BYTES,
  },
};
