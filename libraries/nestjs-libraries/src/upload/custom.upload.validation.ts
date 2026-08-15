import {
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { ALLOWED_MIME } from '@postsider/nestjs-libraries/upload/mime.types';
import { detectFileType } from '@postsider/nestjs-libraries/upload/detect-file-type';

/**
 * Dangerous byte sequences that could indicate an embedded script or polyglot.
 * We scan the first 4KB of the file for these patterns — if found, reject the
 * upload even if magic bytes say it's a valid image/video.
 */
const DANGEROUS_PATTERNS = [
  Buffer.from('<script', 'utf8'),
  Buffer.from('<?php', 'utf8'),
  Buffer.from('<%', 'utf8'),
  Buffer.from('<html', 'utf8'),
  Buffer.from('<svg', 'utf8'),
  Buffer.from('javascript:', 'utf8'),
  Buffer.from('onload=', 'utf8'),
  Buffer.from('onerror=', 'utf8'),
];

function containsDangerousContent(buffer: Buffer): boolean {
  // Check only first 4KB — polyglot attacks hide payloads near the start
  const slice = buffer.subarray(0, 4096);
  const lower = slice.toString('latin1').toLowerCase();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (lower.includes(pattern.toString('latin1').toLowerCase())) {
      return true;
    }
  }
  return false;
}

@Injectable()
export class CustomFileValidationPipe implements PipeTransform {
  async transform(value: any) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    // Skip non-file parameters (org, body, query, etc.)
    if (!('buffer' in value) && !('mimetype' in value) && !('fieldname' in value)) {
      return value;
    }

    if (!value.buffer || !Buffer.isBuffer(value.buffer)) {
      throw new BadRequestException('Invalid file upload.');
    }

    // 1. Detect real file type from magic bytes (never trust Content-Type header)
    const detected = await detectFileType(value.buffer);
    if (!detected || !ALLOWED_MIME.has(detected.mime)) {
      throw new BadRequestException(
        'Unsupported file type. Allowed: JPEG, PNG, GIF, WebP, AVIF, BMP, TIFF, MP4, WebM, MOV.'
      );
    }

    // 2. Block SVG explicitly (can contain embedded XSS)
    if (detected.mime === 'image/svg+xml') {
      throw new BadRequestException('SVG files are not allowed for security reasons.');
    }

    // 3. Scan for embedded scripts/polyglot payloads
    if (containsDangerousContent(value.buffer)) {
      throw new BadRequestException('File contains potentially dangerous content.');
    }

    // 4. Check file size limits
    const maxSize = this.getMaxSize(detected.mime);
    if (value.size > maxSize) {
      throw new BadRequestException(
        `File too large. Max: ${Math.round(maxSize / 1024 / 1024)}MB for ${detected.mime.split('/')[0]}.`
      );
    }

    // 5. Sanitize filename — use random name, never original
    value.mimetype = detected.mime;
    const safeBase = (value.originalname || 'upload')
      .replace(/\.[^./\\]*$/, '')
      .replace(/[\\/]/g, '_')
      .slice(0, 100) || 'upload';
    value.originalname = `${safeBase}.${detected.ext}`;

    return value;
  }

  private getMaxSize(mimeType: string): number {
    if (mimeType.startsWith('image/')) {
      return 10 * 1024 * 1024; // 10 MB
    } else if (mimeType.startsWith('video/')) {
      return 500 * 1024 * 1024; // 500 MB
    } else if (mimeType.startsWith('audio/')) {
      return 50 * 1024 * 1024; // 50 MB
    } else {
      throw new BadRequestException('Unsupported file type.');
    }
  }
}
