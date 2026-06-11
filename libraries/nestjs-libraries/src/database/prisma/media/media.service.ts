import { HttpException, Injectable } from '@nestjs/common';
import { MediaRepository } from '@postsider/nestjs-libraries/database/prisma/media/media.repository';
import { OpenaiService } from '@postsider/nestjs-libraries/openai/openai.service';
import { SubscriptionService } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { Organization } from '@prisma/client';
import { SaveMediaInformationDto } from '@postsider/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoManager } from '@postsider/nestjs-libraries/videos/video.manager';
import { VideoDto } from '@postsider/nestjs-libraries/dtos/videos/video.dto';
import { UploadFactory } from '@postsider/nestjs-libraries/upload/upload.factory';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@postsider/backend/services/auth/permissions/permission.exception.class';

@Injectable()
export class MediaService {
  private storage = UploadFactory.createStorage();

  constructor(
    private _mediaRepository: MediaRepository,
    private _openAi: OpenaiService,
    private _subscriptionService: SubscriptionService,
    private _videoManager: VideoManager
  ) {}

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
    const existing = await this._mediaRepository.getMediaById(id);
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

  getMediaById(id: string) {
    return this._mediaRepository.getMediaById(id);
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

  async generateImage(
    prompt: string,
    org: Organization,
    generatePromptFirst?: boolean
  ) {
    const generating = await this._subscriptionService.useCredit(
      org,
      'ai_images',
      async () => {
        if (generatePromptFirst) {
          prompt = await this._openAi.generatePromptForPicture(prompt);
        }
        return this._openAi.generateImage(prompt);
      }
    );

    return generating;
  }

  saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    type: 'image' | 'video' | 'audio' = 'image'
  ) {
    return this._mediaRepository.saveFile(
      org,
      fileName,
      filePath,
      originalName,
      type
    );
  }

  getMedia(org: string, page: number, search?: string) {
    return this._mediaRepository.getMedia(org, page, search);
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._mediaRepository.saveMediaInformation(org, data);
  }

  getVideoOptions() {
    return this._videoManager.getAllVideos();
  }

  async generateVideoAllowed(org: Organization, type: string) {
    const video = this._videoManager.getVideoByName(type);
    if (!video) {
      throw new Error(`Video type ${type} not found`);
    }

    if (!video.trial && org.isTrailing) {
      throw new HttpException('This video is not available in trial mode', 406);
    }

    return true;
  }

  async generateVideo(org: Organization, body: VideoDto) {
    const totalCredits = await this._subscriptionService.checkCredits(
      org,
      'ai_videos'
    );

    if (totalCredits.credits <= 0) {
      throw new SubscriptionException({
        action: AuthorizationActions.Create,
        section: Sections.VIDEOS_PER_MONTH,
      });
    }

    const video = this._videoManager.getVideoByName(body.type);
    if (!video) {
      throw new Error(`Video type ${body.type} not found`);
    }

    if (!video.trial && org.isTrailing) {
      throw new HttpException('This video is not available in trial mode', 406);
    }

    await video.instance.processAndValidate(body.customParams);

    return await this._subscriptionService.useCredit(
      org,
      'ai_videos',
      async () => {
        const loadedData = await video.instance.process(
          body.output,
          body.customParams
        );

        const file = await this.storage.uploadSimple(loadedData);
        return this.saveFile(
          org.id,
          file.split('/').pop()!,
          file,
          undefined,
          'video'
        );
      }
    );
  }

  async videoFunction(identifier: string, functionName: string, body: any) {
    const video = this._videoManager.getVideoByName(identifier);
    if (!video) {
      throw new Error(`Video with identifier ${identifier} not found`);
    }

    // @ts-ignore
    const functionToCall = video.instance[functionName];
    if (
      typeof functionToCall !== 'function' ||
      this._videoManager.checkAvailableVideoFunction(functionToCall)
    ) {
      throw new HttpException(
        `Function ${functionName} not found on video instance`,
        400
      );
    }

    return functionToCall(body);
  }
}
