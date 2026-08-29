import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { EvergreenRepository } from './evergreen.repository';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { SubscriptionService } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { pricing } from '@postsider/nestjs-libraries/database/prisma/subscriptions/pricing';
import { isBillingEnabled } from '@postsider/nestjs-libraries/services/billing.flag';
import { pickNextEvergreen } from './evergreen.selection';

// Recycling publishes a REAL new post, so a run-away value here (fat-fingered
// or malicious) would hammer the target platform's API and, pre-quota-check,
// blow straight through the plan's monthly post cap in one cron tick. Applies
// in self-host too (no billing tier there), purely as an operational bound.
const MAX_PER_RUN_CAP = 20;
const MIN_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 365;

@Injectable()
export class EvergreenService {
  constructor(
    private _repo: EvergreenRepository,
    private _posts: PostsService,
    private _subscriptions: SubscriptionService,
    private _organizations: OrganizationRepository,
  ) {}
  list(orgId: string) { return this._repo.listEvergreen(orgId); }
  toggle(orgId: string, group: string, on: boolean) { return this._repo.setEvergreen(orgId, group, on); }
  getSettings(orgId: string) { return this._repo.getSettings(orgId).then((s) => s ?? { enabled: false, intervalDays: 7, maxPerRun: 1 }); }
  saveSettings(orgId: string, data: { enabled: boolean; intervalDays: number; maxPerRun: number }) {
    return this._repo.upsertSettings(orgId, {
      ...data,
      maxPerRun: Math.min(Math.max(1, Math.round(data.maxPerRun)), MAX_PER_RUN_CAP),
      intervalDays: Math.min(Math.max(MIN_INTERVAL_DAYS, Math.round(data.intervalDays)), MAX_INTERVAL_DAYS),
    });
  }

  /**
   * Mirrors PermissionsService.check's Sections.POSTS_PER_MONTH branch —
   * recycleOnce runs from a Temporal activity, never through the HTTP guard,
   * so without this an evergreen-enabled FREE/STANDARD org could recycle
   * past its monthly cap forever (the cron has no other rate limit). Same
   * "manual mirror" pattern already used for NoAuthIntegrationsController's
   * channel-capacity check.
   */
  private async hasPostsQuotaRemaining(orgId: string): Promise<boolean> {
    if (!isBillingEnabled()) return true;
    const subscription = await this._subscriptions.getSubscriptionByOrganizationId(orgId);
    const tier = subscription?.subscriptionTier || 'FREE';
    const postsPerMonth = pricing[tier].posts_per_month;
    // Matches PermissionsService.check's fallback exactly: the org's own
    // createdAt, not "now" (which would misdate the month window for any
    // future tier where this branch actually matters — today it's inert
    // since a null subscription also forces the FREE tier's hard 0 cap).
    const createdAt =
      subscription?.createdAt ||
      (await this._organizations.getOrgById(orgId))?.createdAt ||
      new Date();
    const totalMonthPast = Math.abs(dayjs(createdAt).diff(dayjs(), 'month'));
    const checkFrom = dayjs(createdAt).add(totalMonthPast, 'month');
    const count = await this._posts.countPostsFromDay(orgId, checkFrom.toDate());
    return count < postsPerMonth;
  }

  async recycleOnce(orgId: string): Promise<string | null> {
    const settings = await this.getSettings(orgId);
    const candidates = (await this._repo.listEvergreen(orgId)).map((p) => ({ id: p.id, group: p.group, integrationId: p.integrationId, lastRecycledAt: p.lastRecycledAt }));
    const pick = pickNextEvergreen(candidates, settings.intervalDays, new Date());
    if (!pick) return null;
    if (!(await this.hasPostsQuotaRemaining(orgId))) return null;
    // Use the post's own channel so the recycled slot respects that channel's
    // queue plan, not the org default.
    const date = await this._posts.findFreeDateTime(orgId, pick.integrationId);
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
