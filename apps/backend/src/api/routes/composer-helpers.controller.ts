import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ComposerHelpersService } from '@postsider/nestjs-libraries/database/prisma/composer-helpers/composer-helpers.service';
import {
  UpsertCaptionTemplateDto,
  UpsertHashtagGroupDto,
  UpsertUtmPresetDto,
} from '@postsider/nestjs-libraries/dtos/composer-helpers/composer-helpers.dto';

@ApiTags('ComposerHelpers')
@Controller('/composer-helpers')
export class ComposerHelpersController {
  constructor(private _service: ComposerHelpersService) {}

  // Hashtag groups -----------------------------------------------------------
  @Get('/hashtag-groups')
  listHashtagGroups(@GetOrgFromRequest() org: Organization) {
    return this._service.listHashtagGroups(org.id);
  }

  @Post('/hashtag-groups')
  createHashtagGroup(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpsertHashtagGroupDto
  ) {
    return this._service.createHashtagGroup(org.id, body);
  }

  @Put('/hashtag-groups/:id')
  updateHashtagGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpsertHashtagGroupDto
  ) {
    return this._service.updateHashtagGroup(org.id, id, body);
  }

  @Delete('/hashtag-groups/:id')
  deleteHashtagGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._service.deleteHashtagGroup(org.id, id);
  }

  // Caption templates --------------------------------------------------------
  @Get('/caption-templates')
  listCaptionTemplates(@GetOrgFromRequest() org: Organization) {
    return this._service.listCaptionTemplates(org.id);
  }

  @Post('/caption-templates')
  createCaptionTemplate(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpsertCaptionTemplateDto
  ) {
    return this._service.createCaptionTemplate(org.id, body);
  }

  @Put('/caption-templates/:id')
  updateCaptionTemplate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpsertCaptionTemplateDto
  ) {
    return this._service.updateCaptionTemplate(org.id, id, body);
  }

  @Delete('/caption-templates/:id')
  deleteCaptionTemplate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._service.deleteCaptionTemplate(org.id, id);
  }

  // UTM presets --------------------------------------------------------------
  @Get('/utm-presets')
  listUtmPresets(@GetOrgFromRequest() org: Organization) {
    return this._service.listUtmPresets(org.id);
  }

  @Post('/utm-presets')
  createUtmPreset(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpsertUtmPresetDto
  ) {
    return this._service.createUtmPreset(org.id, body);
  }

  @Put('/utm-presets/:id')
  updateUtmPreset(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: UpsertUtmPresetDto
  ) {
    return this._service.updateUtmPreset(org.id, id, body);
  }

  @Delete('/utm-presets/:id')
  deleteUtmPreset(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._service.deleteUtmPreset(org.id, id);
  }
}
