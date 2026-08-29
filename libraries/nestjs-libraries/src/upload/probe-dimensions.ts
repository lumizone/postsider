import sharp from 'sharp';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import ffprobeStatic from 'ffprobe-static';

const execFileAsync = promisify(execFile);

/**
 * Reads pixel dimensions (frame size) and, for video, the duration from an
 * in-memory upload buffer. Images go through sharp directly (no disk
 * round-trip). Video needs a real file for ffprobe to seek/parse container
 * metadata, so it's spilled to a temp file for the duration of the probe and
 * removed after. Returns {} for anything else or on a decode failure, so a
 * corrupt/unsupported file never blocks the upload itself.
 *
 * `durationSeconds` is only present for video: container-level duration from
 * ffprobe's format probe, rounded to a whole second. Providers use it to
 * enforce per-account video length limits at post validation (e.g. TikTok's
 * `max_video_post_duration_sec`).
 */
export async function probeDimensions(
  file: Express.Multer.File
): Promise<{
  width?: number;
  height?: number;
  durationSeconds?: number;
}> {
  if (!file?.buffer) return {};
  if (file.mimetype?.startsWith('image/')) {
    try {
      const { width, height } = await sharp(file.buffer).metadata();
      return { width, height };
    } catch {
      return {};
    }
  }
  if (file.mimetype?.startsWith('video/')) {
    const tmpPath = join(tmpdir(), `probe-${randomBytes(8).toString('hex')}`);
    try {
      await writeFile(tmpPath, file.buffer);
      const { stdout } = await execFileAsync(ffprobeStatic.path, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        tmpPath,
      ]);
      const parsed = JSON.parse(stdout) || {};
      const streams = parsed?.streams || [];
      const videoStream = streams.find((s: any) => s.codec_type === 'video');
      // Container duration is the reliable source (stream duration can be
      // missing for some containers); prefer it, fall back to the video
      // stream's own duration.
      const rawDuration =
        parsed?.format?.duration ?? videoStream?.duration;
      const durationSeconds = Number.isFinite(Number(rawDuration))
        ? Math.round(Number(rawDuration))
        : undefined;
      return videoStream
        ? {
            width: videoStream.width,
            height: videoStream.height,
            ...(durationSeconds !== undefined
              ? { durationSeconds }
              : {}),
          }
        : {};
    } catch {
      return {};
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }
  return {};
}
