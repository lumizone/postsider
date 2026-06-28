import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@postsider/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { EvergreenService } from '@postsider/nestjs-libraries/database/prisma/evergreen/evergreen.service';

@ApiTags('Evergreen')
@Controller('/evergreen')
export class EvergreenController {
  constructor(private _evergreen: EvergreenService) {}
  @Get('/') list(@GetOrgFromRequest() org: Organization) { return this._evergreen.list(org.id); }
  @Post('/:group/toggle') toggle(@GetOrgFromRequest() org: Organization, @Param('group') group: string, @Body() body: { on: boolean }) { return this._evergreen.toggle(org.id, group, !!body.on); }
  @Get('/settings') getSettings(@GetOrgFromRequest() org: Organization) { return this._evergreen.getSettings(org.id); }
  @Post('/settings') saveSettings(@GetOrgFromRequest() org: Organization, @Body() body: { enabled: boolean; intervalDays: number; maxPerRun: number }) { return this._evergreen.saveSettings(org.id, body); }
}
