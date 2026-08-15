import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { SaveMediaInformationDto } from '@postsider/nestjs-libraries/dtos/media/save.media.information.dto';

@Injectable()
export class MediaRepository {
  constructor(
    private _media: PrismaRepository<'media'>,
    private _post: PrismaRepository<'post'>
  ) {}

  /**
   * All non-deleted media for an organization, reduced to the fields needed
   * for cleanup scanning (id + path).
   */
  listAllForOrg(org: string) {
    return this._media.model.media.findMany({
      where: { organizationId: org, deletedAt: null },
      select: { id: true, path: true },
    });
  }

  /**
   * Content + image blobs of every non-deleted post for the organization.
   * Used to detect which media are still referenced by a post.
   */
  getPostMediaReferences(org: string) {
    return this._post.model.post.findMany({
      where: { organizationId: org, deletedAt: null },
      select: { content: true, image: true },
    });
  }

  /** Soft-delete a specific set of media ids belonging to the organization. */
  softDeleteByIds(org: string, ids: string[]) {
    return this._media.model.media.updateMany({
      where: { organizationId: org, id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  /** Soft-delete every non-deleted media for the organization. */
  softDeleteAllForOrg(org: string) {
    return this._media.model.media.updateMany({
      where: { organizationId: org, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    type: 'image' | 'video' | 'audio' = 'image',
    fileSize?: number,
    width?: number,
    height?: number
  ) {
    return this._media.model.media.create({
      data: {
        organization: {
          connect: {
            id: org,
          },
        },
        name: fileName,
        path: filePath,
        originalName: originalName || null,
        type,
        fileSize: fileSize ?? 0,
        width,
        height,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        type: true,
        fileSize: true,
        width: true,
        height: true,
      },
    });
  }

  getMediaById(id: string, orgId: string) {
    return this._media.model.media.findFirst({
      where: {
        id,
        organizationId: orgId,
      },
    });
  }

  deleteMedia(org: string, id: string) {
    return this._media.model.media.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._media.model.media.update({
      where: {
        id: data.id,
        organizationId: org,
      },
      data: {
        alt: data.alt,
        thumbnail: data.thumbnail,
        thumbnailTimestamp: data.thumbnailTimestamp,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        alt: true,
        thumbnail: true,
        path: true,
        thumbnailTimestamp: true,
      },
    });
  }

  async getMedia(org: string, page: number, search?: string) {
    const pageNum = (page || 1) - 1;
    const trimmedSearch = search?.trim();
    const searchFilter = trimmedSearch
      ? {
          originalName: {
            contains: trimmedSearch,
            mode: 'insensitive' as const,
          },
        }
      : {};
    const query: { where: any } = {
      where: {
        organization: {
          id: org,
        },
        deletedAt: null,
        ...searchFilter,
      },
    };
    const pages = Math.ceil((await this._media.model.media.count(query)) / 18);
    const results = await this._media.model.media.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
        ...searchFilter,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        fileSize: true,
        type: true,
        createdAt: true,
        width: true,
        height: true,
      },
      skip: pageNum * 18,
      take: 18,
    });

    return {
      pages,
      results,
    };
  }
}
