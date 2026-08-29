import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { EvergreenService } from '@postsider/nestjs-libraries/database/prisma/evergreen/evergreen.service';
import { CheckPolicies } from '@postsider/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@postsider/backend/services/auth/permissions/permission.exception.class';
import { EvergreenSettingsDto } from '@postsider/nestjs-libraries/dtos/evergreen/evergreen-settings.dto';

@ApiTags('Evergreen')
@Controller('/evergreen')
export class EvergreenController {
  constructor(private _evergreen: EvergreenService) {}
  @Get('/') list(@GetOrgFromRequest() org: Organization) { return this._evergreen.list(org.id); }

  @Post('/:group/toggle')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  toggle(@GetOrgFromRequest() org: Organization, @Param('group') group: string, @Body() body: { on: boolean }) {
    // Reject non-boolean values — truthiness coercion would turn "false" into true.
    if (typeof body?.on !== 'boolean') {
      throw new BadRequestException('on must be a boolean');
    }
    return this._evergreen.toggle(org.id, group, body.on);
  }
  @Get('/settings') getSettings(@GetOrgFromRequest() org: Organization) { return this._evergreen.getSettings(org.id); }

  @Post('/settings')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  saveSettings(@GetOrgFromRequest() org: Organization, @Body() body: EvergreenSettingsDto) {
    return this._evergreen.saveSettings(org.id, body);
  }
}
