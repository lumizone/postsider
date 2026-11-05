import { BadRequestException, Injectable } from '@nestjs/common';
import { AgentActivityRepository } from '@postsider/nestjs-libraries/database/prisma/agent-activity/agent-activity.repository';
import { ActorDirectoryService } from '@postsider/nestjs-libraries/database/prisma/agent-activity/actor-directory.service';
import {
  ActivityRow,
  GroupSummary,
  toGroupSummary,
} from '@postsider/nestjs-libraries/database/prisma/agent-activity/agent-activity.view';
import { bucketOfRow } from '@postsider/nestjs-libraries/agent-activity/activity-buckets';
import {
  ActivityFilters,
  ActorFilter,
  buildActivityWhere,
  parseActorFilter,
} from '@postsider/nestjs-libraries/agent-activity/activity-where';
import { dayBounds, resolveTimeZone } from '@postsider/nestjs-libraries/agent-activity/activity-day';
import {
  decodeGroupCursor,
  encodeGroupCursor,
} from '@postsider/nestjs-libraries/agent-activity/activity-cursor';
import { actorViewFromColumns } from '@postsider/nestjs-libraries/actor/post-actor';
import type { ActorView } from '@postsider/nestjs-libraries/actor/post-actor';

export type ActivitySummary = {
  timezone: string;
  dayStart: string;
  dayEnd: string;
  actionsToday: number;
  waitingForReview: number;
  policyBlocked: number;
  failed: { total: number; retryable: number; unknownOutcome: number; other: number };
  publishedToday: number;
};

/** `actor` may be the raw query string (`USER:<id>`) or an already parsed filter. */
export type ParsedActivityQuery = Omit<ActivityFilters, 'actor'> & {
  actor?: ActorFilter | string;
  limit: number;
  cursor?: string;
};

export type ActivityFilterOptions = {
  actors: Array<{
    key: string;
    type: 'API_KEY' | 'OAUTH_CLIENT';
    id: string | null;
    name: string | null;
    state: 'ok' | 'revoked' | 'unknown' | 'legacy';
  }>;
  agentNames: string[];
  sources: string[];
};

const FILTER_WINDOW_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AgentActivityService {
  constructor(
    private _repo: AgentActivityRepository,
    private _actors: ActorDirectoryService
  ) {}

  async summary(
    orgId: string,
    opts: { timezone?: string | null; orgDefaultTimezone?: string | null; now?: Date }
  ): Promise<ActivitySummary> {
    const timezone = resolveTimeZone(opts.timezone, opts.orgDefaultTimezone);
    const range = dayBounds(opts.now ?? new Date(), timezone);
    const [open, publishedToday, actionsToday] = await Promise.all([
      this._repo.openCounts(orgId),
      this._repo.publishedCount(orgId, range),
      this._repo.automationActionCount(orgId, range),
    ]);
    let waitingForReview = 0;
    let policyBlocked = 0;
    let retryable = 0;
    let unknownOutcome = 0;
    let other = 0;
    for (const r of open) {
      switch (bucketOfRow(r)) {
        case 'review':
          waitingForReview += r.count;
          break;
        case 'blocked':
          policyBlocked += r.count;
          break;
        case 'retryable':
          retryable += r.count;
          break;
        case 'unknown_outcome':
          unknownOutcome += r.count;
          break;
        case 'failed_other':
          other += r.count;
          break;
        default:
          break;
      }
    }
    return {
      timezone,
      dayStart: range.start.toISOString(),
      dayEnd: range.end.toISOString(),
      actionsToday,
      waitingForReview,
      policyBlocked,
      failed: {
        total: retryable + unknownOutcome + other,
        retryable,
        unknownOutcome,
        other,
      },
      publishedToday,
    };
  }

  async list(
    orgId: string,
    q: ParsedActivityQuery
  ): Promise<{ groups: GroupSummary[]; nextCursor: string | null }> {
    const cursor = q.cursor === undefined ? null : decodeGroupCursor(q.cursor);
    if (q.cursor !== undefined && !cursor) {
      throw new BadRequestException('Invalid cursor');
    }
    let actor: ActorFilter | undefined;
    if (typeof q.actor === 'string') {
      const parsed = parseActorFilter(q.actor);
      if (!parsed) throw new BadRequestException('Invalid actor filter');
      actor = parsed;
    } else {
      actor = q.actor;
    }
    if (q.from && q.to && q.from.getTime() > q.to.getTime()) {
      throw new BadRequestException('"from" must not be after "to"');
    }

    const where = buildActivityWhere(orgId, {
      bucket: q.bucket,
      scope: q.scope,
      integrationIds: q.integrationIds,
      actor,
      agentName: q.agentName,
      source: q.source,
      from: q.from,
      to: q.to,
    });
    const found = await this._repo.pageGroups(orgId, where, cursor, q.limit + 1);
    const page = found.slice(0, q.limit);
    if (page.length === 0) return { groups: [], nextCursor: null };
    const last = page[page.length - 1];
    const nextCursor =
      found.length > q.limit
        ? encodeGroupCursor({ updatedAt: last.updatedAt, group: last.group })
        : null;

    const rows = await this._repo.rowsForGroups(
      orgId,
      page.map((p) => p.group)
    );
    const pending = await this._repo.pendingApprovalIds(
      orgId,
      rows.map((r) => r.id)
    );
    const rowsByGroup = new Map<string, ActivityRow[]>();
    const groupOfPost = new Map<string, string>();
    for (const r of rows) {
      const list = rowsByGroup.get(r.group) ?? [];
      list.push(r);
      rowsByGroup.set(r.group, list);
      groupOfPost.set(r.id, r.group);
    }
    const pendingByGroup = new Map<string, string[]>();
    for (const p of pending) {
      const g = groupOfPost.get(p.postId);
      if (!g) continue;
      const list = pendingByGroup.get(g) ?? [];
      list.push(p.id);
      pendingByGroup.set(g, list);
    }

    // views come from rows of this organization only (see ActorDirectoryService.resolve)
    const views: Array<ActorView | null> = [];
    for (const r of rows) {
      views.push(actorViewFromColumns(r, 'createdBy'), actorViewFromColumns(r, 'lastModifiedBy'));
    }
    const resolve = await this._actors.resolve(orgId, views);

    const groups: GroupSummary[] = [];
    for (const p of page) {
      const groupRows = rowsByGroup.get(p.group);
      // a group deleted between the two queries simply drops out of the page
      if (!groupRows || groupRows.length === 0) continue;
      groups.push(toGroupSummary(groupRows, resolve, pendingByGroup.get(p.group) ?? []));
    }
    return { groups, nextCursor };
  }

  async filters(orgId: string, now: Date = new Date()): Promise<ActivityFilterOptions> {
    const since = new Date(now.getTime() - FILTER_WINDOW_DAYS * DAY_MS);
    const [views, provenance] = await Promise.all([
      this._repo.recentActors(orgId, since),
      this._repo.recentProvenance(orgId, since),
    ]);
    // views come from rows of this organization only (see ActorDirectoryService.resolve)
    const resolve = await this._actors.resolve(orgId, views);
    const seen = new Set<string>();
    const actors: ActivityFilterOptions['actors'] = [];
    for (const view of views) {
      if (view.type !== 'API_KEY' && view.type !== 'OAUTH_CLIENT') continue;
      const id = (view.type === 'API_KEY' ? view.apiKeyId : view.oauthClientId) ?? null;
      // the filter parser has no legacy form for OAuth clients
      if (view.type === 'OAUTH_CLIENT' && id === null) continue;
      const key = `${view.type}:${id ?? 'legacy'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const display = resolve(view);
      actors.push({
        key,
        type: view.type,
        id,
        name: display?.name ?? null,
        state: display?.state ?? 'unknown',
      });
    }
    return { actors, agentNames: provenance.agentNames, sources: provenance.sources };
  }
}
