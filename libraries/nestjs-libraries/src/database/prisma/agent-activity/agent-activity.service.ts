import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { AgentActivityRepository } from '@postsider/nestjs-libraries/database/prisma/agent-activity/agent-activity.repository';
import { ActorDirectoryService } from '@postsider/nestjs-libraries/database/prisma/agent-activity/actor-directory.service';
import {
  ActivityRow,
  ApprovalRow,
  DestinationDetail,
  GroupSummary,
  RULE_NAME_MAX,
  RecordedPolicy,
  TimelineItem,
  cleanMetadata,
  parseRecordedPolicy,
  toDestinationDetail,
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
import { AuditEventsService } from '@postsider/nestjs-libraries/database/prisma/audit/audit-events.service';
import { PostsRepository } from '@postsider/nestjs-libraries/database/prisma/posts/posts.repository';
import {
  PolicyEvaluationService,
  PolicyTarget,
} from '@postsider/nestjs-libraries/database/prisma/policies/policy-evaluation.service';
import { cleanDisplayName } from '@postsider/nestjs-libraries/agent-activity/display-name';
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
  /** `value` is the stored text used for exact-match filtering, `label` is cleaned for display */
  agentNames: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
};

export type ActivityDetail = {
  group: string;
  updatedAt: Date;
  destinations: DestinationDetail[];
  policy: {
    recorded: RecordedPolicy | null;
    current: {
      effect: 'ALLOW' | 'REQUIRE_APPROVAL' | 'BLOCK';
      matched: Array<{ ruleId: string; name: string; effect: string; condition: string }>;
    } | null;
  };
  timeline: TimelineItem[];
};

const FILTER_WINDOW_DAYS = 90;
const TIMELINE_LIMIT = 100;
/** Stored states whose destination can still be published, so a re-evaluation means something. */
const EVALUABLE_STATES = ['QUEUE', 'DRAFT', 'APPROVAL', 'ERROR', 'HELD'];
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AgentActivityService {
  constructor(
    private _repo: AgentActivityRepository,
    private _actors: ActorDirectoryService,
    private _audit: AuditEventsService,
    private _posts: PostsRepository,
    @Optional() private _policy?: PolicyEvaluationService
  ) {}

  private readonly logger = new Logger(AgentActivityService.name);

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
    if (
      (q.from && Number.isNaN(q.from.getTime())) ||
      (q.to && Number.isNaN(q.to.getTime()))
    ) {
      throw new BadRequestException('Invalid date');
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
    const options = (values: string[]) =>
      values.flatMap((value) => {
        const label = cleanDisplayName(value, 255);
        return label === null ? [] : [{ value, label }];
      });
    return {
      actors,
      agentNames: options(provenance.agentNames),
      sources: options(provenance.sources),
    };
  }

  async detail(orgId: string, group: string): Promise<ActivityDetail> {
    const rows = await this._repo.detailRows(orgId, group);
    if (rows.length === 0) throw new NotFoundException('Group not found');
    const postIds = rows.map((r) => r.id);

    const [children, approvals, groupIds] = await Promise.all([
      this._repo.childRows(orgId, postIds),
      this._repo.approvalsFor(orgId, postIds),
      this._posts.getPostIdsInGroupIncludingDeleted(orgId, rows[0].id),
    ]);
    const { events } = await this._audit.list(orgId, {
      targetType: 'post',
      targetIds: groupIds ?? postIds,
      limit: TIMELINE_LIMIT,
    });

    // views come from rows and audit events of this organization only (see ActorDirectoryService.resolve)
    const views: Array<ActorView | null> = [];
    for (const r of rows) {
      views.push(actorViewFromColumns(r, 'createdBy'), actorViewFromColumns(r, 'lastModifiedBy'));
    }
    for (const a of approvals) {
      views.push(actorViewFromColumns(a, 'requestedBy'));
      if (a.decidedByType === 'USER' && a.approverId) {
        views.push({ type: 'USER', userId: a.approverId });
      } else if (a.decidedByType) {
        views.push({ type: a.decidedByType as ActorView['type'] });
      }
    }
    for (const e of events) {
      if (e.actor.type !== 'GUEST') views.push(auditActorView(e.actor));
    }
    const resolve = await this._actors.resolve(orgId, views);

    const approvalByPost = new Map<string, ApprovalRow>(approvals.map((a) => [a.postId, a]));
    const destinations = rows.map((r) =>
      toDestinationDetail(r, { children, approval: approvalByPost.get(r.id), resolve })
    );

    const timeline: TimelineItem[] = events.map((e) => ({
      id: e.id,
      type: e.type,
      createdAt: e.createdAt,
      postId: e.target.id,
      actor:
        e.actor.type === 'GUEST'
          ? { type: 'GUEST' as const }
          : resolve(auditActorView(e.actor)) ?? {
              type: 'SYSTEM' as const,
              id: null,
              name: null,
              state: 'unknown' as const,
              authorizedBy: null,
            },
      metadata: cleanMetadata(e.metadata),
    }));

    const recordedEvent = events.find((e) => e.type === 'post.policy_evaluated');
    return {
      group,
      updatedAt: rows.reduce((max, r) => (r.updatedAt > max ? r.updatedAt : max), rows[0].updatedAt),
      destinations,
      policy: {
        recorded: recordedEvent ? parseRecordedPolicy(recordedEvent) : null,
        current: await this.currentPolicy(orgId, rows, approvalByPost),
      },
      timeline,
    };
  }

  /** Live re-evaluation against today's rules. Never fails the detail. */
  private async currentPolicy(
    orgId: string,
    rows: ActivityRow[],
    approvalByPost: Map<string, ApprovalRow>
  ): Promise<ActivityDetail['policy']['current']> {
    if (!this._policy) return null;
    try {
      const evaluable = rows.filter((r) => EVALUABLE_STATES.includes(r.state));
      if (evaluable.length === 0) return null;
      const targets: PolicyTarget[] = [];
      for (const r of evaluable) {
        const target = await this._policy.targetFromStoredPost(orgId, r.id, {
          action: 'SCHEDULE',
          approved: approvalByPost.get(r.id)?.status === 'APPROVED',
        });
        if (target) targets.push(target);
      }
      if (targets.length === 0) return null;
      const outcome = await this._policy.evaluateTargets(orgId, targets, 'publish');
      return {
        effect: outcome.effect,
        matched: outcome.matched.map((m) => ({
          ruleId: m.ruleId,
          name: cleanDisplayName(m.name, RULE_NAME_MAX) ?? '',
          effect: m.effect,
          condition: m.condition,
        })),
      };
    } catch (error) {
      this.logger.warn(
        `Policy re-evaluation failed for group ${rows[0]?.group}: ${(error as Error)?.message ?? error}`
      );
      return null;
    }
  }
}

function auditActorView(actor: {
  type: string;
  userId?: string;
  apiKeyId?: string;
  oauthClientId?: string;
}): ActorView {
  const view: ActorView = { type: actor.type as ActorView['type'] };
  if (actor.userId) view.userId = actor.userId;
  if (actor.apiKeyId) view.apiKeyId = actor.apiKeyId;
  if (actor.oauthClientId) view.oauthClientId = actor.oauthClientId;
  return view;
}
