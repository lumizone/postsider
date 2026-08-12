import { Injectable } from '@nestjs/common';
import { State } from '@prisma/client';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class AgencyOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(organizationId: string, days = 30) {
    const since = new Date(Date.now() - Math.max(1, Math.min(365, days)) * 86400000);
    const reportWindow = {
      OR: [
        { createdAt: { gte: since } },
        { updatedAt: { gte: since } },
        { publishDate: { gte: since } },
      ],
    };
    const [integrations, posts, approvals, recentErrors] = await Promise.all([
      this.prisma.integration.findMany({
        where: { organizationId, deletedAt: null },
        select: { id: true, name: true, providerIdentifier: true, disabled: true, customer: { select: { id: true, name: true } } },
      }),
      this.prisma.post.groupBy({
        by: ['state'],
        where: { organizationId, deletedAt: null, parentPostId: null, ...reportWindow },
        _count: { _all: true },
      }),
      this.prisma.postApproval.count({ where: { organizationId, status: 'PENDING' } }),
      this.prisma.post.count({
        where: { organizationId, state: State.ERROR, deletedAt: null, parentPostId: null, updatedAt: { gte: since } },
      }),
    ]);

    const byState = Object.fromEntries(
      posts.map((row) => [row.state, Number((row._count as { _all?: number })?._all ?? 0)])
    );
    const clients = new Map<string, { id: string | null; name: string; channels: number; activeChannels: number }>();
    for (const integration of integrations) {
      const key = integration.customer?.id ?? 'unassigned';
      const current = clients.get(key) ?? { id: integration.customer?.id ?? null, name: integration.customer?.name ?? 'Unassigned', channels: 0, activeChannels: 0 };
      current.channels += 1;
      if (!integration.disabled) current.activeChannels += 1;
      clients.set(key, current);
    }

    return {
      generatedAt: new Date().toISOString(),
      windowDays: Math.max(1, Math.min(365, days)),
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
      },
      clients: [...clients.values()].sort((a, b) => b.channels - a.channels || a.name.localeCompare(b.name)),
    };
  }
}
