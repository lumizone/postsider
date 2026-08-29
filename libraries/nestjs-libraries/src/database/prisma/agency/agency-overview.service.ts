import { Injectable } from '@nestjs/common';
import { State } from '@prisma/client';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

interface IntegrationHealth {
  id: string;
  disabled: boolean;
  refreshNeeded: boolean;
  inBetweenSteps: boolean;
  tokenExpiration: Date | null;
}

const isTokenIssue = (integration: IntegrationHealth): boolean =>
  integration.disabled ||
  integration.refreshNeeded ||
  integration.inBetweenSteps ||
  (integration.tokenExpiration != null &&
    integration.tokenExpiration.getTime() < Date.now());

const countOf = (row: { _count?: { _all?: number } }): number =>
  Number(row._count?._all ?? 0);

@Injectable()
export class AgencyOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(organizationId: string, days = 30) {
    const windowDays = Math.max(1, Math.min(365, days));
    const since = new Date(Date.now() - windowDays * 86400000);
    const now = new Date();
    const reportWindow = {
      OR: [
        { createdAt: { gte: since } },
        { updatedAt: { gte: since } },
        { publishDate: { gte: since } },
      ],
    };
    const [
      integrations,
      posts,
      approvals,
      recentErrors,
      stuckRows,
      errorRows,
    ] = await Promise.all([
      this.prisma.integration.findMany({
        where: { organizationId, deletedAt: null },
        select: {
          id: true,
          name: true,
          providerIdentifier: true,
          disabled: true,
          refreshNeeded: true,
          inBetweenSteps: true,
          tokenExpiration: true,
          customer: { select: { id: true, name: true } },
        },
      }),
      this.prisma.post.groupBy({
        by: ['state'],
        where: { organizationId, deletedAt: null, parentPostId: null, integration: { deletedAt: null }, ...reportWindow },
        _count: { _all: true },
      }),
      this.prisma.postApproval.count({
        where: { organizationId, status: 'PENDING', post: { deletedAt: null, integration: { deletedAt: null } } },
      }),
      this.prisma.post.count({
        where: { organizationId, state: State.ERROR, deletedAt: null, parentPostId: null, integration: { deletedAt: null }, updatedAt: { gte: since } },
      }),
      // Stuck posts: scheduled, past their time, never attempted (no error) —
      // the silent-failure signature. Grouped by channel so we can roll it up
      // per client.
      this.prisma.post.groupBy({
        by: ['integrationId'],
        where: { organizationId, state: State.QUEUE, publishDate: { lt: now }, error: null, deletedAt: null, parentPostId: null, integration: { deletedAt: null } },
        _count: { _all: true },
      }),
      this.prisma.post.groupBy({
        by: ['integrationId'],
        where: { organizationId, state: State.ERROR, deletedAt: null, parentPostId: null, integration: { deletedAt: null }, updatedAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    const byState = Object.fromEntries(
      posts.map((row) => [row.state, countOf(row)])
    );
    const stuckByChannel = new Map(
      stuckRows.map((row) => [row.integrationId, countOf(row)])
    );
    const errorsByChannel = new Map(
      errorRows.map((row) => [row.integrationId, countOf(row)])
    );

    type Client = {
      id: string | null;
      name: string;
      channels: number;
      activeChannels: number;
      errors: number;
      stuckPosts: number;
      tokenIssues: number;
    };
    const clients = new Map<string, Client>();
    for (const integration of integrations) {
      const key = integration.customer?.id ?? 'unassigned';
      const current: Client = clients.get(key) ?? {
        id: integration.customer?.id ?? null,
        name: integration.customer?.name ?? 'Unassigned',
        channels: 0,
        activeChannels: 0,
        errors: 0,
        stuckPosts: 0,
        tokenIssues: 0,
      };
      current.channels += 1;
      if (!integration.disabled) current.activeChannels += 1;
      current.errors += errorsByChannel.get(integration.id) ?? 0;
      current.stuckPosts += stuckByChannel.get(integration.id) ?? 0;
      if (isTokenIssue(integration)) current.tokenIssues += 1;
      clients.set(key, current);
    }

    const stuckPosts = integrations.reduce(
      (sum, integration) => sum + (stuckByChannel.get(integration.id) ?? 0),
      0
    );
    const tokenIssues = integrations.filter(isTokenIssue).length;

    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      summary: {
        clients: clients.size,
        channels: integrations.length,
        activeChannels: integrations.filter((i) => !i.disabled).length,
        queued: byState[State.QUEUE] ?? 0,
        drafts: byState[State.DRAFT] ?? 0,
        published: byState[State.PUBLISHED] ?? 0,
        errors: byState[State.ERROR] ?? 0,
        recentErrors,
        pendingApprovals: approvals,
        stuckPosts,
        tokenIssues,
      },
      clients: [...clients.values()].sort(
        (a, b) => b.channels - a.channels || a.name.localeCompare(b.name)
      ),
    };
  }
}
