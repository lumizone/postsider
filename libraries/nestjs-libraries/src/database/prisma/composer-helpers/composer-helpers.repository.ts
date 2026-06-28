import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

// Ownership is always enforced by including organizationId in every where clause,
// so a row from another org can never be read, updated or deleted.
@Injectable()
export class ComposerHelpersRepository {
  constructor(
    private _hashtagGroup: PrismaRepository<'hashtagGroup'>,
    private _captionTemplate: PrismaRepository<'captionTemplate'>,
    private _utmPreset: PrismaRepository<'utmPreset'>
  ) {}

  // Hashtag groups -----------------------------------------------------------
  listHashtagGroups(orgId: string) {
    return this._hashtagGroup.model.hashtagGroup.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createHashtagGroup(
    orgId: string,
    data: { name: string; hashtags: string; platform?: string | null }
  ) {
    return this._hashtagGroup.model.hashtagGroup.create({
      data: { organizationId: orgId, ...data },
    });
  }

  async updateHashtagGroup(
    orgId: string,
    id: string,
    data: { name: string; hashtags: string; platform?: string | null }
  ) {
    const res = await this._hashtagGroup.model.hashtagGroup.updateMany({
      where: { id, organizationId: orgId },
      data,
    });
    return res.count;
  }

  async deleteHashtagGroup(orgId: string, id: string) {
    const res = await this._hashtagGroup.model.hashtagGroup.deleteMany({
      where: { id, organizationId: orgId },
    });
    return res.count;
  }

  // Caption templates --------------------------------------------------------
  listCaptionTemplates(orgId: string) {
    return this._captionTemplate.model.captionTemplate.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createCaptionTemplate(
    orgId: string,
    data: { name: string; content: string }
  ) {
    return this._captionTemplate.model.captionTemplate.create({
      data: { organizationId: orgId, ...data },
    });
  }

  async updateCaptionTemplate(
    orgId: string,
    id: string,
    data: { name: string; content: string }
  ) {
    const res = await this._captionTemplate.model.captionTemplate.updateMany({
      where: { id, organizationId: orgId },
      data,
    });
    return res.count;
  }

  async deleteCaptionTemplate(orgId: string, id: string) {
    const res = await this._captionTemplate.model.captionTemplate.deleteMany({
      where: { id, organizationId: orgId },
    });
    return res.count;
  }

  // UTM presets --------------------------------------------------------------
  listUtmPresets(orgId: string) {
    return this._utmPreset.model.utmPreset.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createUtmPreset(
    orgId: string,
    data: {
      name: string;
      utmSource: string;
      utmMedium: string;
      utmCampaign: string;
      utmContent?: string | null;
      utmTerm?: string | null;
    }
  ) {
    return this._utmPreset.model.utmPreset.create({
      data: { organizationId: orgId, ...data },
    });
  }

  async updateUtmPreset(
    orgId: string,
    id: string,
    data: {
      name: string;
      utmSource: string;
      utmMedium: string;
      utmCampaign: string;
      utmContent?: string | null;
      utmTerm?: string | null;
    }
  ) {
    const res = await this._utmPreset.model.utmPreset.updateMany({
      where: { id, organizationId: orgId },
      data,
    });
    return res.count;
  }

  async deleteUtmPreset(orgId: string, id: string) {
    const res = await this._utmPreset.model.utmPreset.deleteMany({
      where: { id, organizationId: orgId },
    });
    return res.count;
  }
}
