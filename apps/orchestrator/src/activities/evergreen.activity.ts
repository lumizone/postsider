import { Injectable } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { EvergreenService } from '@postsider/nestjs-libraries/database/prisma/evergreen/evergreen.service';
import { EvergreenRepository } from '@postsider/nestjs-libraries/database/prisma/evergreen/evergreen.repository';

@Injectable()
@Activity()
export class EvergreenActivity {
  constructor(
    private _evergreenService: EvergreenService,
    private _evergreenRepository: EvergreenRepository,
  ) {}

  @ActivityMethod()
  async recycleEvergreenForAllOrgs() {
    const orgs = await this._evergreenRepository.listEnabledOrgs();
    for (const org of orgs) {
      try {
        const maxPerRun = org.maxPerRun;
        for (let i = 0; i < maxPerRun; i++) {
          const recycled = await this._evergreenService.recycleOnce(
            org.organizationId,
          );
          if (recycled === null) {
            break;
          }
        }
      } catch (err) {
        // One org's failure must not abort the whole run.
      }
    }
  }
}
