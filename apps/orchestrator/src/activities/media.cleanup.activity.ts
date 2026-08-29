import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { UploadFactory } from '@postsider/nestjs-libraries/upload/upload.factory';

const RETENTION_DAYS = parseInt(process.env.MEDIA_RETENTION_DAYS || '90', 10);
const BATCH_SIZE = 500;

@Injectable()
@Activity()
export class MediaCleanupActivity {
  private storage = UploadFactory.createStorage();

  constructor(private readonly _prisma: PrismaService) {}

  @ActivityMethod()
  async cleanupExpiredMedia(): Promise<{ deleted: number; skipped: number }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

    let deleted = 0;
    let skipped = 0;
    let lastProcessed: { id: string; createdAt: Date } | undefined;

    while (true) {
      // Keyset pagination advances even when a batch contains only retained
      // media. Offset pagination would repeatedly revisit those rows.
      const expiredMedia = await this._prisma.media.findMany({
        where: {
          createdAt: { lt: cutoffDate },
          deletedAt: null,
          userPicture: { none: {} },
          oauthApps: { none: {} },
          ...(lastProcessed && {
            OR: [
              { createdAt: { gt: lastProcessed.createdAt } },
              {
                createdAt: lastProcessed.createdAt,
                id: { gt: lastProcessed.id },
              },
            ],
          }),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          path: true,
          organizationId: true,
          createdAt: true,
        },
        take: BATCH_SIZE,
      });

      if (expiredMedia.length === 0) break;

      for (const media of expiredMedia) {
        lastProcessed = { id: media.id, createdAt: media.createdAt };
        // Drafts, approvals, and published history can all need the blob.
        const postUsingMedia = await this._prisma.post.findFirst({
          where: {
            organizationId: media.organizationId,
            deletedAt: null,
            OR: [
              { image: { contains: media.path } },
              { content: { contains: media.path } },
            ],
          },
          select: { id: true },
        });

        if (postUsingMedia) {
          skipped++;
          continue;
        }

        // A post may have gained this path while an earlier candidate was
        // being processed. Check again immediately before removing the blob.
        const postUsingMediaNow = await this._prisma.post.findFirst({
          where: {
            organizationId: media.organizationId,
            deletedAt: null,
            OR: [
              { image: { contains: media.path } },
              { content: { contains: media.path } },
            ],
          },
          select: { id: true },
        });

        if (postUsingMediaNow) {
          skipped++;
          continue;
        }

        try {
          await this.storage.removeFile(media.path);
        } catch (err) {
          // Keep the row eligible so a later cleanup run can retry the blob.
          console.error(
            `[media-cleanup] Failed to remove file: ${media.path}`,
            err
          );
          continue;
        }

        await this._prisma.media.update({
          where: { id: media.id },
          data: { deletedAt: new Date() },
        });

        deleted++;
      }
    }

    console.log(
      `[media-cleanup] Done: ${deleted} deleted, ${skipped} skipped (still in use)`
    );

    return { deleted, skipped };
  }
}
