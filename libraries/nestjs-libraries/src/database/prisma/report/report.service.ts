import { BadRequestException, Injectable } from '@nestjs/common';
import { State } from '@prisma/client';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

const clampDays = (days: number) => Math.max(1, Math.min(365, days));

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async buildReport(organizationId: string, customerId: string, days = 30) {
    const windowDays = clampDays(days);
    const since = new Date(Date.now() - windowDays * 86400000);

    const [customer, org, integrations, posts, analytics] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: customerId, orgId: organizationId, deletedAt: null },
        select: { id: true, name: true },
      }),
      this.prisma.organization.findFirst({
        where: { id: organizationId },
        select: { name: true, logo: true },
      }),
      this.prisma.integration.findMany({
        where: { organizationId, customerId, deletedAt: null },
        select: { id: true, name: true, providerIdentifier: true, disabled: true },
      }),
      this.prisma.post.findMany({
        where: {
          organizationId,
          integration: { customerId },
          state: State.PUBLISHED,
          publishDate: { gte: since },
          deletedAt: null,
          parentPostId: null,
        },
        select: {
          id: true,
          content: true,
          releaseURL: true,
          publishDate: true,
          integration: { select: { name: true } },
        },
      }),
      this.prisma.postAnalytics.findMany({
        where: { organizationId, post: { integration: { customerId } }, measuredAt: { gte: since } },
        select: { postId: true, metric: true, value: true, measuredAt: true },
      }),
    ]);

    if (!customer) {
      throw new BadRequestException('Customer not found');
    }

    // Latest value per (post, metric) — grouped by post for the per-post
    // engagement total, and summed by metric for the report summary.
    const latestPerPost = new Map<
      string,
      Map<string, { value: number; ts: number }>
    >();
    for (const row of analytics) {
      let metrics = latestPerPost.get(row.postId);
      if (!metrics) {
        metrics = new Map();
        latestPerPost.set(row.postId, metrics);
      }
      const ts = row.measuredAt.getTime();
      const prev = metrics.get(row.metric);
      if (!prev || ts >= prev.ts) {
        metrics.set(row.metric, { value: row.value, ts });
      }
    }

    // Engagement summary: sum latest value per post, per metric label.
    const metricTotals = new Map<string, number>();
    for (const [, metrics] of latestPerPost) {
      for (const [metric, entry] of metrics) {
        metricTotals.set(metric, (metricTotals.get(metric) ?? 0) + entry.value);
      }
    }
    const engagement = [...metricTotals.entries()]
      .map(([metric, total]) => ({ metric, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total);

    // Per-channel published counts from the posts we already loaded.
    const perChannel = new Map<string, number>();
    for (const post of posts) {
      const name = post.integration.name;
      perChannel.set(name, (perChannel.get(name) ?? 0) + 1);
    }

    // Top posts: rank by total engagement (sum of latest metric values), fall
    // back to most recent when there is no analytics data at all.
    const withEngagement = posts.map((post) => {
      const metrics = latestPerPost.get(post.id);
      let total = 0;
      if (metrics) {
        for (const entry of metrics.values()) total += entry.value;
      }
      return { post, total };
    });
    withEngagement.sort(
      (a, b) =>
        b.total - a.total ||
        b.post.publishDate.getTime() - a.post.publishDate.getTime()
    );

    return {
      generatedAt: new Date().toISOString(),
      branding: { name: org?.name ?? '', logo: org?.logo ?? null },
      customer: { id: customer.id, name: customer.name },
      period: {
        days: windowDays,
        start: since.toISOString(),
        end: new Date().toISOString(),
      },
      delivery: {
        channels: integrations.length,
        activeChannels: integrations.filter((i) => !i.disabled).length,
        published: posts.length,
        perChannel: integrations.map((i) => ({
          name: i.name,
          providerIdentifier: i.providerIdentifier,
          disabled: i.disabled,
          published: perChannel.get(i.name) ?? 0,
        })),
      },
      engagement,
      topPosts: withEngagement.slice(0, 10).map(({ post, total }) => ({
        content: post.content,
        releaseURL: post.releaseURL,
        publishedAt: post.publishDate.toISOString(),
        channel: post.integration.name,
        engagement: Math.round(total),
      })),
    };
  }
}
