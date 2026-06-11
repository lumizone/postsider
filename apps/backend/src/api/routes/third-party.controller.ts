import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Delete,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThirdPartyManager } from '@postsider/nestjs-libraries/3rdparties/thirdparty.manager';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { AuthService } from '@postsider/helpers/auth/auth.service';
import { UploadFactory } from '@postsider/nestjs-libraries/upload/upload.factory';
import { MediaService } from '@postsider/nestjs-libraries/database/prisma/media/media.service';
import { ImportMediaDto } from '@postsider/nestjs-libraries/dtos/third-party/import-media.dto';

@ApiTags('Third Party')
@Controller('/third-party')
export class ThirdPartyController {
  private storage = UploadFactory.createStorage();

  constructor(
    private _thirdPartyManager: ThirdPartyManager,
    private _mediaService: MediaService,
  ) {}

  @Get('/list')
  async getThirdPartyList() {
    return this._thirdPartyManager.getAllThirdParties();
  }

  @Get('/')
  async getSavedThirdParty(@GetOrgFromRequest() organization: Organization) {
    return Promise.all(
      (
        await this._thirdPartyManager.getAllThirdPartiesByOrganization(
          organization.id
        )
      ).map((thirdParty) => {
        const { description, fields, position, title, identifier } =
          this._thirdPartyManager.getThirdPartyByName(thirdParty.identifier)!;
        return {
          ...thirdParty,
          title,
          position,
          fields,
          description,
        };
      })
    );
  }

  @Delete('/:id')
  deleteById(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string
  ) {
    return this._thirdPartyManager.deleteIntegration(organization.id, id);
  }

  @Post('/:id/submit')
  async generate(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Body() data: any
  ) {
    const thirdParty = await this._thirdPartyManager.getIntegrationById(
      organization.id,
      id
    );

    if (!thirdParty) {
      throw new HttpException('Integration not found', 404);
    }

    const thirdPartyInstance = this._thirdPartyManager.getThirdPartyByName(
      thirdParty.identifier
    );

    if (!thirdPartyInstance) {
      throw new HttpException('Invalid identifier', 400);
    }

    const loadedData = await thirdPartyInstance?.instance?.sendData(
      AuthService.decryptSecret(thirdParty.apiKey),
      data
    );

    const file = await this.storage.uploadSimple(loadedData);
    return this._mediaService.saveFile(organization.id, file.split('/').pop()!, file);
  }

  @Post('/function/:id/:functionName')
  async callFunction(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Param('functionName') functionName: string,
    @Body() data: any
  ) {
    // Block potentially dangerous property accesses from user-controlled input.
    const BLOCKED_NAMES = new Set([
      'constructor',
      '__proto__',
      '__defineGetter__',
      '__defineSetter__',
      'prototype',
      'toString',
      'valueOf',
      'hasOwnProperty',
    ]);
    if (BLOCKED_NAMES.has(functionName)) {
      throw new HttpException('Invalid function', 400);
    }

    const thirdParty = await this._thirdPartyManager.getIntegrationById(
      organization.id,
      id
    );

    if (!thirdParty) {
      throw new HttpException('Integration not found', 404);
    }

    const thirdPartyInstance = this._thirdPartyManager.getThirdPartyByName(
      thirdParty.identifier
    );

    if (!thirdPartyInstance) {
      throw new HttpException('Invalid identifier', 400);
    }

    // Only allow calling methods that exist directly on the instance and are
    // functions — never inherited Object.prototype methods or non-functions.
    const fn = thirdPartyInstance.instance?.[functionName];
    if (typeof fn !== 'function') {
      throw new HttpException('Invalid function', 400);
    }

    return fn.call(
      thirdPartyInstance.instance,
      AuthService.decryptSecret(thirdParty.apiKey),
      data
    );
  }

  @Post('/:id/import')
  async importMedia(
    @GetOrgFromRequest() organization: Organization,
    @Param('id') id: string,
    @Body() body: ImportMediaDto
  ) {
    const thirdParty = await this._thirdPartyManager.getIntegrationById(
      organization.id,
      id
    );

    if (!thirdParty) {
      throw new HttpException('Integration not found', 404);
    }

    const thirdPartyInstance = this._thirdPartyManager.getThirdPartyByName(
      thirdParty.identifier
    );

    if (!thirdPartyInstance) {
      throw new HttpException('Invalid identifier', 400);
    }

    const downloadUrls = await thirdPartyInstance?.instance?.['importMedia']?.(
      AuthService.decryptSecret(thirdParty.apiKey),
      body.items
    );

    if (!downloadUrls || !Array.isArray(downloadUrls)) {
      throw new HttpException('Import not supported', 400);
    }

    const results: any[] = [];
    for (const item of downloadUrls) {
      const file = await this.storage.uploadSimple(item.url);
      const saved = await this._mediaService.saveFile(
        organization.id,
        item.name || file.split('/').pop(),
        file
      );
      results.push(saved);
    }

    return results;
  }

  @Post('/:identifier')
  async addApiKey(
    @GetOrgFromRequest() organization: Organization,
    @Param('identifier') identifier: string,
    @Body('api') api: string
  ) {
    const thirdParty = this._thirdPartyManager.getThirdPartyByName(identifier);
    if (!thirdParty) {
      throw new HttpException('Invalid identifier', 400);
    }

    const connect = await thirdParty.instance.checkConnection(api);
    if (!connect) {
      throw new HttpException('Invalid API key', 400);
    }

    try {
      const save = await this._thirdPartyManager.saveIntegration(
        organization.id,
        identifier,
        api,
        {
          name: connect.name,
          username: connect.username,
          id: connect.id,
        }
      );

      return {
        id: save.id,
      };
    } catch (e) {
      console.log(e);
      throw new HttpException('Integration Already Exists', 400);
    }
  }
}
