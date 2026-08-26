import { BadRequestException, Injectable } from '@nestjs/common';
import { State } from '@prisma/client';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class CustomerReportService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(organizationId: string, customerId: string, days = 30) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, orgId: organizationId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!customer) throw new BadRequestException('Customer not found');

    const windowDays = Math.max(1, Math.min(365, days));
    const since = new Date(Date.now() - windowDays * 86400000);
    const reportWindow = {
      OR: [
        { createdAt: { gte: since } },
        { updatedAt: { gte: since } },
        { publishDate: { gte: since } },
      ],
    };
    const [channels, posts, approvals, errors] = await Promise.all([
      this.prisma.integration.findMany({
        where: { organizationId, customerId, deletedAt: null },
        select: { id: true, name: true, providerIdentifier: true, disabled: true },
      }),
      this.prisma.post.groupBy({
        by: ['state'],
        where: { organizationId, deletedAt: null, parentPostId: null, integration: { customerId, deletedAt: null }, ...reportWindow },
        _count: { _all: true },
      }),
      this.prisma.postApproval.count({
        where: { organizationId, status: 'PENDING', post: { deletedAt: null, integration: { customerId, deletedAt: null } } },
      }),
      this.prisma.post.count({
        where: { organizationId, state: State.ERROR, deletedAt: null, parentPostId: null, updatedAt: { gte: since }, integration: { customerId, deletedAt: null } },
      }),
    ]);

    const byState = Object.fromEntries(
      posts.map((row) => [row.state, Number((row._count as { _all?: number })?._all ?? 0)])
    );
    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      customer,
      channels,
      summary: {
        channels: channels.length,
        activeChannels: channels.filter((channel) => !channel.disabled).length,
        queued: byState[State.QUEUE] ?? 0,
        drafts: byState[State.DRAFT] ?? 0,
        published: byState[State.PUBLISHED] ?? 0,
        errors: byState[State.ERROR] ?? 0,
        recentErrors: errors,
        pendingApprovals: approvals,
      },
    };
  }
}
