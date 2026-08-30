import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ALLOWED_MIME } from '@postsider/nestjs-libraries/upload/mime.types';
import { detectFileType } from '@postsider/nestjs-libraries/upload/detect-file-type';
import { maxUploadBytesForMime } from '@postsider/nestjs-libraries/upload/upload.limits';

@Injectable()
export class CustomFileValidationPipe implements PipeTransform {
  async transform(value: any) {
    if (!value || typeof value !== 'object') {
      return value;
    }

    // Skip non-file parameters (org, body, query, etc.)
    if (
      !('buffer' in value) &&
      !('mimetype' in value) &&
      !('fieldname' in value)
    ) {
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
      throw new BadRequestException(
        'SVG files are not allowed for security reasons.'
      );
    }

    // 3. Check file size limits
    const maxSize = this.getMaxSize(detected.mime);
    if (value.size > maxSize) {
      throw new BadRequestException(
        `File too large. Max: ${Math.round(maxSize / 1024 / 1024)}MB for ${
          detected.mime.split('/')[0]
        }.`
      );
    }

    // 4. Sanitize filename — use random name, never original
    value.mimetype = detected.mime;
    const safeBase =
      (value.originalname || 'upload')
        .replace(/\.[^./\\]*$/, '')
        .replace(/[\\/]/g, '_')
        .slice(0, 100) || 'upload';
    value.originalname = `${safeBase}.${detected.ext}`;

    return value;
  }

  private getMaxSize(mimeType: string): number {
    const maxSize = maxUploadBytesForMime(mimeType);
    if (maxSize === 0) {
      throw new BadRequestException('Unsupported file type.');
    }
    return maxSize;
  }
}
