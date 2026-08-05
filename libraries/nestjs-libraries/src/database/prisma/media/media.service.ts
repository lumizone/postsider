import { Injectable } from '@nestjs/common';
import { MediaRepository } from '@postsider/nestjs-libraries/database/prisma/media/media.repository';
import { SaveMediaInformationDto } from '@postsider/nestjs-libraries/dtos/media/save.media.information.dto';
import { UploadFactory } from '@postsider/nestjs-libraries/upload/upload.factory';

@Injectable()
export class MediaService {
  private storage = UploadFactory.createStorage();

  constructor(private _mediaRepository: MediaRepository) {}

  /**
   * Soft-delete the DB row and best-effort permanently remove the underlying
   * blob from storage so the bucket / disk does not accumulate orphan files.
   *
   * The blob is removed only when the soft-delete actually persisted (i.e.
   * the row exists and belongs to the org). Storage failures are logged but
   * not propagated: we prefer a successful logical delete over a 500 that
   * leaves the user unable to clean up their library.
   */
  async deleteMedia(org: string, id: string) {
    const existing = await this._mediaRepository.getMediaById(id, org);
    const result = await this._mediaRepository.deleteMedia(org, id);

    if (existing?.path && existing.organizationId === org) {
      try {
        await this.storage.removeFile(existing.path);
      } catch (err) {
        console.error('Failed to remove physical file for media', id, err);
      }
    }

    return result;
  }

  getMediaById(id: string, orgId: string) {
    return this._mediaRepository.getMediaById(id, orgId);
  }

  /**
   * Delete every media file that is not referenced by any post (by path,
   * filename, or id). Soft-deletes the DB rows and best-effort removes the
   * underlying blobs. Returns how many were removed.
   */
  async deleteUnusedMedia(org: string) {
    const all = await this._mediaRepository.listAllForOrg(org);
    if (all.length === 0) {
      return { deleted: 0 };
    }

    const posts = await this._mediaRepository.getPostMediaReferences(org);
    const haystack = posts
      .map((p) => `${p.content ?? ''}\n${p.image ?? ''}`)
      .join('\n');

    const unused = all.filter((m) => {
      if (m.path && haystack.includes(m.path)) return false;
      const base = m.path?.split('/').pop();
      if (base && haystack.includes(base)) return false;
      if (m.id && haystack.includes(m.id)) return false;
      return true;
    });

    if (unused.length === 0) {
      return { deleted: 0 };
    }

    await this._mediaRepository.softDeleteByIds(
      org,
      unused.map((m) => m.id)
    );
    await this.removeBlobs(unused);
    return { deleted: unused.length };
  }

  /**
   * Permanently clears the media library for an organization: soft-deletes all
   * rows and best-effort removes the underlying blobs. Destructive — guarded by
   * a typed confirmation in the UI and an admin check in the controller.
   */
  async deleteAllMedia(org: string) {
    const all = await this._mediaRepository.listAllForOrg(org);
    if (all.length === 0) {
      return { deleted: 0 };
    }
    await this._mediaRepository.softDeleteAllForOrg(org);
    await this.removeBlobs(all);
    return { deleted: all.length };
  }

  /** Best-effort physical removal of a set of media blobs. */
  private async removeBlobs(items: { id: string; path: string }[]) {
    for (const m of items) {
      if (!m.path) continue;
      try {
        await this.storage.removeFile(m.path);
      } catch (err) {
        console.error('Failed to remove physical file for media', m.id, err);
      }
    }
  }

  saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    type: 'image' | 'video' | 'audio' = 'image',
    fileSize?: number
  ) {
    return this._mediaRepository.saveFile(
      org,
      fileName,
      filePath,
      originalName,
      type,
      fileSize
    );
  }

  getMedia(org: string, page: number, search?: string) {
    return this._mediaRepository.getMedia(org, page, search);
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._mediaRepository.saveMediaInformation(org, data);
  }
}
