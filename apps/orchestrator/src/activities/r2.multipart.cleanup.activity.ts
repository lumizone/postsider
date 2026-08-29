import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

const {
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_ACCESS_KEY,
  CLOUDFLARE_SECRET_ACCESS_KEY,
  CLOUDFLARE_BUCKETNAME,
} = process.env;

const configuredGraceHours = Number(
  process.env.R2_MULTIPART_CLEANUP_GRACE_HOURS || 24
);
const GRACE_HOURS =
  Number.isFinite(configuredGraceHours) && configuredGraceHours > 0
    ? configuredGraceHours
    : 24;
const GRACE_MS = Math.max(1, GRACE_HOURS) * 60 * 60 * 1000;
const ABORT_ATTEMPTS = 3;

// The direct multipart endpoint writes at the bucket root. CloudflareStorage
// partitions regular media by type, so inventory each known namespace without
// traversing unrelated future prefixes in the shared bucket.
const R2_MULTIPART_PREFIX_INVENTORY: ReadonlyArray<{
  prefix: string;
  delimiter?: string;
}> = [
  { prefix: '', delimiter: '/' },
  { prefix: 'image/' },
  { prefix: 'video/' },
  { prefix: 'audio/' },
];

// Custom metadata set by r2.uploader.ts at CreateMultipartUpload time. Its
// presence marks a completed object as multipart-origin, which is the only
// population that can contain completed-but-rejected objects.
const MULTIPART_METADATA_KEY = 'declared-size';

export type R2MultipartCleanupResult = {
  scanned: number;
  aborted: number;
  skipped: number;
  reclaimed: number;
};

function isAlreadyAbsent(error: unknown) {
  const r2Error = error as {
    $metadata?: { httpStatusCode?: number };
    name?: string;
    Code?: string;
  };
  return (
    r2Error?.$metadata?.httpStatusCode === 404 ||
    r2Error?.name === 'NoSuchUpload' ||
    r2Error?.Code === 'NoSuchUpload'
  );
}

@Injectable()
@Activity()
export class R2MultipartCleanupActivity {
  private readonly _r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: CLOUDFLARE_ACCESS_KEY!,
      secretAccessKey: CLOUDFLARE_SECRET_ACCESS_KEY!,
    },
  });

  constructor(private readonly _prisma: PrismaService) {}

  @ActivityMethod()
  async cleanupIncompleteR2MultipartUploads(): Promise<R2MultipartCleanupResult> {
    if (process.env.STORAGE_PROVIDER !== 'cloudflare') {
      return { scanned: 0, aborted: 0, skipped: 0, reclaimed: 0 };
    }

    const cutoff = Date.now() - GRACE_MS;
    let scanned = 0;
    let aborted = 0;
    let skipped = 0;

    for (const inventory of R2_MULTIPART_PREFIX_INVENTORY) {
      let keyMarker: string | undefined;
      let uploadIdMarker: string | undefined;

      do {
        const page = await this._r2.send(
          new ListMultipartUploadsCommand({
            Bucket: CLOUDFLARE_BUCKETNAME,
            Prefix: inventory.prefix,
            ...(inventory.delimiter && { Delimiter: inventory.delimiter }),
            ...(keyMarker && { KeyMarker: keyMarker }),
            ...(uploadIdMarker && { UploadIdMarker: uploadIdMarker }),
          })
        );

        for (const upload of page.Uploads || []) {
          scanned++;
          const initiatedAt = upload.Initiated?.getTime();
          if (
            !upload.Key ||
            !upload.UploadId ||
            !Number.isFinite(initiatedAt) ||
            initiatedAt! > cutoff
          ) {
            skipped++;
            continue;
          }

          await this.abortUpload(upload.Key, upload.UploadId);
          aborted++;
        }

        if (!page.IsTruncated) break;
        if (!page.NextKeyMarker) {
          throw new Error(
            'R2 multipart listing was truncated without a key marker'
          );
        }
        keyMarker = page.NextKeyMarker;
        uploadIdMarker = page.NextUploadIdMarker;
      } while (true);
    }

    let reclaimed = 0;
    try {
      reclaimed = await this.reclaimCompletedRejectedObjects(cutoff);
    } catch (err) {
      // Incomplete-upload cleanup above must not be undone by a reclaim error.
      console.error('[r2-multipart-cleanup] Reclaim of completed objects failed', err);
    }

    console.log(
      `[r2-multipart-cleanup] Done: ${aborted} aborted, ${skipped} skipped, ${scanned} scanned, ${reclaimed} reclaimed`
    );
    return { scanned, aborted, skipped, reclaimed };
  }

  /**
   * Reclaims objects that were COMPLETED but rejected at verification
   * (size/type mismatch, or the post-completion save failed). Such objects are
   * normal S3 objects — invisible to ListMultipartUploads — so the inline
   * DeleteObject in r2.uploader.ts is the primary path and this is a safety net
   * for the narrow windows where it cannot run (R2 outage, crash mid-request).
   *
   * Only the bucket root is scanned: r2.uploader.ts always builds multipart keys
   * as `<random>.<ext>` at the root, while regular uploads live under
   * image/|video/|audio/ partitions. A root object is reclaimed when it is old
   * enough to be past any in-flight completion, carries the multipart metadata,
   * and is not referenced by any Media row.
   */
  private async reclaimCompletedRejectedObjects(
    cutoffMs: number
  ): Promise<number> {
    const bucketUrl = process.env.CLOUDFLARE_BUCKET_URL;
    if (!bucketUrl) return 0;

    let reclaimed = 0;
    let continuationToken: string | undefined;

    do {
      const page = await this._r2.send(
        new ListObjectsV2Command({
          Bucket: CLOUDFLARE_BUCKETNAME,
          // Multipart keys live at the bucket root; the delimiter keeps the
          // sweep from walking the image/|video/|audio/ partitions.
          Delimiter: '/',
          ...(continuationToken && { ContinuationToken: continuationToken }),
        })
      );

      for (const object of page.Contents || []) {
        if (
          !object.Key ||
          !object.LastModified ||
          object.LastModified.getTime() > cutoffMs
        ) {
          continue;
        }

        try {
          const head = await this._r2.send(
            new HeadObjectCommand({
              Bucket: CLOUDFLARE_BUCKETNAME,
              Key: object.Key,
            })
          );
          if (head.Metadata?.[MULTIPART_METADATA_KEY] === undefined) {
            continue;
          }

          const publicUrl = `${bucketUrl}/${object.Key}`;
          const referenced = await this._prisma.media.findFirst({
            where: { path: publicUrl },
            select: { id: true },
          });
          if (referenced) continue;

          await this._r2.send(
            new DeleteObjectCommand({
              Bucket: CLOUDFLARE_BUCKETNAME,
              Key: object.Key,
            })
          );
          reclaimed++;
        } catch (error) {
          // A head/delete failure must not abort the sweep; the next daily run
          // will retry. A 404 means another cleaner already won the race.
          if (!isAlreadyAbsent(error)) {
            console.error(
              `[r2-multipart-cleanup] Failed to reclaim completed object: ${object.Key}`,
              error
            );
          }
        }
      }

      if (!page.IsTruncated) break;
      continuationToken = page.NextContinuationToken;
      if (!continuationToken) {
        throw new Error(
          'R2 object listing was truncated without a continuation token'
        );
      }
    } while (true);

    return reclaimed;
  }

  private async abortUpload(key: string, uploadId: string): Promise<void> {
    for (let attempt = 1; attempt <= ABORT_ATTEMPTS; attempt++) {
      try {
        await this._r2.send(
          new AbortMultipartUploadCommand({
            Bucket: CLOUDFLARE_BUCKETNAME,
            Key: key,
            UploadId: uploadId,
          })
        );
        return;
      } catch (error) {
        // A previous attempt or another cleaner may have won the race.
        if (isAlreadyAbsent(error)) return;
        if (attempt === ABORT_ATTEMPTS) throw error;
        await this.waitForAbortRetry(attempt);
      }
    }
  }

  private waitForAbortRetry(attempt: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, attempt * 100));
  }
}
