/**
 * Single source of truth for MIME validation across all storage providers.
 *
 * The allow-list is intentionally narrow: only the formats that we know every
 * downstream connector (X, LinkedIn, Discord, Mastodon, Bluesky, etc.) and AI
 * agent pipeline can produce or consume. Anything else is rejected at upload
 * time so we never persist a file we cannot publish later.
 */

export type MediaKind = 'image' | 'video' | 'audio';

export const ALLOWED_IMAGE_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
]);

export const ALLOWED_VIDEO_MIME = new Set<string>([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
]);

export const ALLOWED_AUDIO_MIME = new Set<string>([
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
]);

export const ALLOWED_MIME = new Set<string>([
  ...ALLOWED_IMAGE_MIME,
  ...ALLOWED_VIDEO_MIME,
  ...ALLOWED_AUDIO_MIME,
]);

export function classifyMime(mime: string): MediaKind {
  if (ALLOWED_IMAGE_MIME.has(mime)) return 'image';
  if (ALLOWED_VIDEO_MIME.has(mime)) return 'video';
  if (ALLOWED_AUDIO_MIME.has(mime)) return 'audio';
  throw new Error(`Unsupported media type: ${mime}`);
}
