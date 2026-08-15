import { Injectable, NotFoundException } from '@nestjs/common';
import { ComposerHelpersRepository } from './composer-helpers.repository';
import {
  UpsertCaptionTemplateDto,
  UpsertHashtagGroupDto,
  UpsertUtmPresetDto,
} from '@postsider/nestjs-libraries/dtos/composer-helpers/composer-helpers.dto';

type HashtagGroupRow = { hashtags: string };

// The hashtags column stores a JSON string array; the service is the single
// place that serializes on write and parses on read so the API speaks string[].
@Injectable()
export class ComposerHelpersService {
  constructor(private _repo: ComposerHelpersRepository) {}

  private parseHashtags<T extends HashtagGroupRow>(row: T) {
    let hashtags: string[] = [];
    try {
      const parsed = JSON.parse(row.hashtags);
      if (Array.isArray(parsed)) {
        hashtags = parsed.filter((h): h is string => typeof h === 'string');
      }
    } catch {
      hashtags = [];
    }
    return { ...row, hashtags };
  }

  // Hashtag groups -----------------------------------------------------------
  async listHashtagGroups(orgId: string) {
    const rows = await this._repo.listHashtagGroups(orgId);
    return rows.map((r) => this.parseHashtags(r));
  }

  async createHashtagGroup(orgId: string, dto: UpsertHashtagGroupDto) {
    const row = await this._repo.createHashtagGroup(orgId, {
      name: dto.name,
      hashtags: JSON.stringify(dto.hashtags),
      platform: dto.platform ?? null,
    });
    return this.parseHashtags(row);
  }

  async updateHashtagGroup(
    orgId: string,
    id: string,
    dto: UpsertHashtagGroupDto
  ) {
    const count = await this._repo.updateHashtagGroup(orgId, id, {
      name: dto.name,
      hashtags: JSON.stringify(dto.hashtags),
      platform: dto.platform ?? null,
    });
    if (!count) throw new NotFoundException('Hashtag group not found');
    return { success: true };
  }

  async deleteHashtagGroup(orgId: string, id: string) {
    const count = await this._repo.deleteHashtagGroup(orgId, id);
    if (!count) throw new NotFoundException('Hashtag group not found');
    return { success: true };
  }

  // Caption templates --------------------------------------------------------
  listCaptionTemplates(orgId: string) {
    return this._repo.listCaptionTemplates(orgId);
  }

  createCaptionTemplate(orgId: string, dto: UpsertCaptionTemplateDto) {
    return this._repo.createCaptionTemplate(orgId, {
      name: dto.name,
      content: dto.content,
    });
  }

  async updateCaptionTemplate(
    orgId: string,
    id: string,
    dto: UpsertCaptionTemplateDto
  ) {
    const count = await this._repo.updateCaptionTemplate(orgId, id, {
      name: dto.name,
      content: dto.content,
    });
    if (!count) throw new NotFoundException('Caption template not found');
    return { success: true };
  }

  async deleteCaptionTemplate(orgId: string, id: string) {
    const count = await this._repo.deleteCaptionTemplate(orgId, id);
    if (!count) throw new NotFoundException('Caption template not found');
    return { success: true };
  }

  // UTM presets --------------------------------------------------------------
  listUtmPresets(orgId: string) {
    return this._repo.listUtmPresets(orgId);
  }

  createUtmPreset(orgId: string, dto: UpsertUtmPresetDto) {
    return this._repo.createUtmPreset(orgId, {
      name: dto.name,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      utmContent: dto.utmContent ?? null,
      utmTerm: dto.utmTerm ?? null,
    });
  }

  async updateUtmPreset(orgId: string, id: string, dto: UpsertUtmPresetDto) {
    const count = await this._repo.updateUtmPreset(orgId, id, {
      name: dto.name,
      utmSource: dto.utmSource,
      utmMedium: dto.utmMedium,
      utmCampaign: dto.utmCampaign,
      utmContent: dto.utmContent ?? null,
      utmTerm: dto.utmTerm ?? null,
    });
    if (!count) throw new NotFoundException('UTM preset not found');
    return { success: true };
  }

  async deleteUtmPreset(orgId: string, id: string) {
    const count = await this._repo.deleteUtmPreset(orgId, id);
    if (!count) throw new NotFoundException('UTM preset not found');
    return { success: true };
  }
}
