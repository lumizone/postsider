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

export const uploadInterceptorOptions = {
  limits: {
    fileSize: UPLOAD_MAX_FILE_MB * 1024 * 1024,
  },
};
