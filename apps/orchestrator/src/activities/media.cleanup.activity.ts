import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { UploadFactory } from '@postsider/nestjs-libraries/upload/upload.factory';

const RETENTION_DAYS = parseInt(process.env.MEDIA_RETENTION_DAYS || '90', 10);

@Injectable()
@Activity()
export class MediaCleanupActivity {
  private storage = UploadFactory.createStorage();

  constructor(private readonly _prisma: PrismaService) {}

  @ActivityMethod()
  async cleanupExpiredMedia(): Promise<{ deleted: number; skipped: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    // Find media older than retention period that:
    // - Is not already soft-deleted
    // - Is not a user profile picture
    // - Is not attached to a scheduled (QUEUE) post
    const expiredMedia = await this._prisma.media.findMany({
      where: {
        createdAt: { lt: cutoffDate },
        deletedAt: null,
        // Exclude profile pictures
        userPicture: { none: {} },
        // Exclude OAuth app pictures
        oauthApps: { none: {} },
      },
      select: {
        id: true,
        path: true,
        organizationId: true,
      },
      take: 500, // Process in batches to avoid timeout
    });

    let deleted = 0;
    let skipped = 0;

    for (const media of expiredMedia) {
      // Check if this media is used in any scheduled (QUEUE) post
      // Posts store media paths in the `image` JSON field
      const queuedPostUsingMedia = await this._prisma.post.findFirst({
        where: {
          organizationId: media.organizationId,
          state: 'QUEUE',
          deletedAt: null,
          image: { contains: media.path },
        },
        select: { id: true },
      });

      if (queuedPostUsingMedia) {
        skipped++;
        continue;
      }

      // Delete from storage
      try {
        await this.storage.removeFile(media.path);
      } catch (err) {
        // Storage deletion failed — still soft-delete from DB
        // so we don't retry the same file forever
        console.error(`[media-cleanup] Failed to remove file: ${media.path}`, err);
      }

      // Soft-delete in database
      await this._prisma.media.update({
        where: { id: media.id },
        data: { deletedAt: new Date() },
      });

      deleted++;
    }

    console.log(
      `[media-cleanup] Done: ${deleted} deleted, ${skipped} skipped (still in use), ${expiredMedia.length} checked`
    );

    return { deleted, skipped };
  }
}
