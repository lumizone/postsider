import { Injectable } from '@nestjs/common';
import { EvergreenRepository } from './evergreen.repository';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { pickNextEvergreen } from './evergreen.selection';

@Injectable()
export class EvergreenService {
  constructor(private _repo: EvergreenRepository, private _posts: PostsService) {}
  list(orgId: string) { return this._repo.listEvergreen(orgId); }
  toggle(orgId: string, group: string, on: boolean) { return this._repo.setEvergreen(orgId, group, on); }
  getSettings(orgId: string) { return this._repo.getSettings(orgId).then((s) => s ?? { enabled: false, intervalDays: 7, maxPerRun: 1 }); }
  saveSettings(orgId: string, data: { enabled: boolean; intervalDays: number; maxPerRun: number }) { return this._repo.upsertSettings(orgId, data); }
  async recycleOnce(orgId: string): Promise<string | null> {
    const settings = await this.getSettings(orgId);
    const candidates = (await this._repo.listEvergreen(orgId)).map((p) => ({ id: p.id, group: p.group, lastRecycledAt: p.lastRecycledAt }));
    const pick = pickNextEvergreen(candidates, settings.intervalDays, new Date());
    if (!pick) return null;
    const date = await this._posts.findFreeDateTime(orgId);
    // duplicatePost creates the copy as a DRAFT (it won't publish on its own),
    // so flip the new post to a scheduled (QUEUE) state to actually re-publish it.
    const dup = await this._posts.duplicatePost(orgId, pick.group, undefined, date + 'Z');
    const newPostId = dup?.target?.group;
    if (newPostId) {
      await this._posts.changePostStatus(orgId, newPostId, 'schedule');
    }
    await this._repo.markRecycled(pick.id, new Date());
    return newPostId ?? pick.group;
  }
}
