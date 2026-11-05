import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import {
  actorViewFromColumns,
  ActorPrefix,
  ActorView,
} from '@postsider/nestjs-libraries/actor/post-actor';
import { AUTOMATION_ACTOR_TYPES } from '@postsider/nestjs-libraries/agent-activity/activity-buckets';
import type { PostWhere } from '@postsider/nestjs-libraries/agent-activity/activity-where';
import type {
  ActivityRow,
  ApprovalRow,
  ChildRow,
  DetailRow,
} from '@postsider/nestjs-libraries/database/prisma/agent-activity/agent-activity.view';

const MAX_RECENT = 50;
const automationTypes = () => ({ in: [...AUTOMATION_ACTOR_TYPES] });

const ROW_SELECT = {
  id: true,
  group: true,
  state: true,
  publishDate: true,
  updatedAt: true,
  content: true,
  image: true,
  error: true,
  errorCategory: true,
  errorRetryable: true,
  publishAttempts: true,
  releaseId: true,
  releaseURL: true,
  integrationId: true,
  createdByType: true,
  createdByUserId: true,
  createdByApiKeyId: true,
  createdByOAuthClientId: true,
  lastModifiedByType: true,
  lastModifiedByUserId: true,
  lastModifiedByApiKeyId: true,
  lastModifiedByOAuthClientId: true,
  agentName: true,
  workflowId: true,
  runId: true,
  externalRef: true,
  source: true,
  integration: {
    select: { id: true, name: true, providerIdentifier: true, picture: true },
  },
} as const;

const DETAIL_SELECT = {
  ...ROW_SELECT,
  lastPublishAttemptAt: true,
  firstComment: true,
} as const;

// Explicit on purpose: never guestToken or guestTokenExpiresAt.
const APPROVAL_SELECT = {
  id: true,
  postId: true,
  status: true,
  note: true,
  requestedAt: true,
  resolvedAt: true,
  requestedByType: true,
  requestedByUserId: true,
  requestedByApiKeyId: true,
  requestedByOAuthClientId: true,
  decidedByType: true,
  approverId: true,
  guestName: true,
  guestEmail: true,
} as const;

/** Longest thread chain walked (matches the policy evaluator's limit). */
const MAX_CHILD_DEPTH = 100;

/** Top-level destination of this organization that is not deleted. */
const destinationBase = (orgId: string) => ({
  organizationId: orgId,
  parentPostId: null,
  deletedAt: null,
  integration: { deletedAt: null },
});

@Injectable()
export class AgentActivityRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _approval: PrismaRepository<'postApproval'>,
    private _audit: PrismaRepository<'auditLog'>
  ) {}

  /**
   * One page of group ids by max(updatedAt) desc, group desc (keyset). `where`
   * must already carry the organization (see buildActivityWhere).
   */
  async pageGroups(
    _orgId: string,
    where: PostWhere,
    cursor: { updatedAt: Date; group: string } | null,
    take: number
  ): Promise<Array<{ group: string; updatedAt: Date }>> {
    const args: Record<string, unknown> = {
      by: ['group'],
      where,
      _max: { updatedAt: true },
      orderBy: [{ _max: { updatedAt: 'desc' } }, { group: 'desc' }],
      take,
    };
    if (cursor) {
      args.having = {
        OR: [
          { updatedAt: { _max: { lt: cursor.updatedAt } } },
          {
            AND: [
              { updatedAt: { _max: { equals: cursor.updatedAt } } },
              { group: { lt: cursor.group } },
            ],
          },
        ],
      };
    }
    const rows = (await (this._post.model.post as any).groupBy(args)) as Array<{
      group: string;
      _max: { updatedAt: Date | null };
    }>;
    return rows.map((r) => ({ group: r.group, updatedAt: r._max.updatedAt as Date }));
  }

  async rowsForGroups(orgId: string, groups: string[]): Promise<ActivityRow[]> {
    if (groups.length === 0) return [];
    return (await this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        parentPostId: null,
        deletedAt: null,
        integration: { deletedAt: null },
        group: { in: groups },
      },
      select: ROW_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })) as unknown as ActivityRow[];
  }

  /** Top-level, not deleted destinations of one group (empty for an unknown or foreign group). */
  async detailRows(orgId: string, group: string): Promise<DetailRow[]> {
    return (await this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        group,
        parentPostId: null,
        deletedAt: null,
        integration: { deletedAt: null },
      },
      select: DETAIL_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })) as unknown as DetailRow[];
  }

  /**
   * Thread rows below the given top-level posts. A thread is stored as a chain
   * (each value's parent is the previous value), so this walks one level per query
   * up to MAX_CHILD_DEPTH. `parentPostId` is the direct parent.
   */
  async childRows(orgId: string, parentIds: string[]): Promise<ChildRow[]> {
    const out: ChildRow[] = [];
    let level = parentIds;
    for (let depth = 0; depth < MAX_CHILD_DEPTH && level.length > 0; depth++) {
      const rows = (await this._post.model.post.findMany({
        where: { organizationId: orgId, parentPostId: { in: level }, deletedAt: null },
        select: { id: true, parentPostId: true, content: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })) as Array<{ id: string; parentPostId: string | null; content: string; createdAt: Date }>;
      level = [];
      for (const row of rows) {
        if (row.parentPostId === null) continue;
        out.push({
          id: row.id,
          parentPostId: row.parentPostId,
          content: row.content,
          createdAt: row.createdAt,
        });
        level.push(row.id);
      }
    }
    return out;
  }

  async approvalsFor(orgId: string, postIds: string[]): Promise<ApprovalRow[]> {
    if (postIds.length === 0) return [];
    return (await this._approval.model.postApproval.findMany({
      where: { organizationId: orgId, postId: { in: postIds } },
      select: APPROVAL_SELECT,
    })) as unknown as ApprovalRow[];
  }

  async pendingApprovalIds(
    orgId: string,
    postIds: string[]
  ): Promise<Array<{ id: string; postId: string }>> {
    if (postIds.length === 0) return [];
    return this._approval.model.postApproval.findMany({
      where: { organizationId: orgId, status: 'PENDING', postId: { in: postIds } },
      select: { id: true, postId: true },
    });
  }

  async openCounts(orgId: string): Promise<
    Array<{
      state: string;
      errorCategory: string | null;
      errorRetryable: boolean | null;
      count: number;
    }>
  > {
    const rows = (await (this._post.model.post as any).groupBy({
      by: ['state', 'errorCategory', 'errorRetryable'],
      where: { ...destinationBase(orgId), state: { in: ['APPROVAL', 'ERROR'] } },
      _count: { _all: true },
    })) as Array<{
      state: string;
      errorCategory: string | null;
      errorRetryable: boolean | null;
      _count: { _all: number };
    }>;
    return rows.map((r) => ({
      state: r.state,
      errorCategory: r.errorCategory,
      errorRetryable: r.errorRetryable,
      count: r._count._all,
    }));
  }

  publishedCount(orgId: string, range: { start: Date; end: Date }): Promise<number> {
    return this._post.model.post.count({
      where: {
        ...destinationBase(orgId),
        state: 'PUBLISHED',
        createdByType: automationTypes(),
        updatedAt: { gte: range.start, lt: range.end },
      } as any,
    });
  }

  automationActionCount(orgId: string, range: { start: Date; end: Date }): Promise<number> {
    return this._audit.model.auditLog.count({
      where: {
        organizationId: orgId,
        type: 'resource',
        actorType: automationTypes(),
        createdAt: { gte: range.start, lt: range.end },
      } as any,
    });
  }

  /** Distinct automation identities (createdBy or lastModifiedBy), most recent first. */
  async recentActors(orgId: string, since: Date): Promise<ActorView[]> {
    const one = async (prefix: ActorPrefix) => {
      const cols = [
        `${prefix}Type`,
        `${prefix}UserId`,
        `${prefix}ApiKeyId`,
        `${prefix}OAuthClientId`,
      ];
      const rows = (await (this._post.model.post as any).groupBy({
        by: cols,
        where: {
          organizationId: orgId,
          parentPostId: null,
          deletedAt: null,
          [`${prefix}Type`]: automationTypes(),
          updatedAt: { gte: since },
        },
        _max: { updatedAt: true },
        orderBy: { _max: { updatedAt: 'desc' } },
        take: MAX_RECENT,
      })) as Array<Record<string, any>>;
      return rows.map((r) => ({
        view: actorViewFromColumns(r, prefix),
        at: r._max.updatedAt as Date,
      }));
    };
    const [created, modified] = await Promise.all([one('createdBy'), one('lastModifiedBy')]);
    const merged = [...created, ...modified]
      .filter((x): x is { view: ActorView; at: Date } => x.view !== null)
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    const seen = new Set<string>();
    const out: ActorView[] = [];
    for (const { view } of merged) {
      const k = JSON.stringify([view.type, view.userId, view.apiKeyId, view.oauthClientId]);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(view);
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  }

  async recentProvenance(
    orgId: string,
    since: Date
  ): Promise<{ agentNames: string[]; sources: string[] }> {
    const distinct = async (col: 'agentName' | 'source') => {
      const rows = (await (this._post.model.post as any).groupBy({
        by: [col],
        where: {
          organizationId: orgId,
          parentPostId: null,
          deletedAt: null,
          [col]: { not: null },
          updatedAt: { gte: since },
        },
        _max: { updatedAt: true },
        orderBy: { _max: { updatedAt: 'desc' } },
        take: MAX_RECENT,
      })) as Array<Record<string, string | null>>;
      return rows.map((r) => r[col]).filter((v): v is string => typeof v === 'string');
    };
    const [agentNames, sources] = await Promise.all([distinct('agentName'), distinct('source')]);
    return { agentNames, sources };
  }
}
