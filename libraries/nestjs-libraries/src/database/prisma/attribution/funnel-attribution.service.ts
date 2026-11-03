import { Injectable } from '@nestjs/common';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

export type FunnelClientStage = 'onboarding_type_selected';
export type OnboardingChoice = 'agents' | 'scheduler';

type Attribution = {
  journeyId?: string | null;
  landingPath?: string | null;
  referrerHost?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
};

function safeValue(raw: unknown, limit: number): string | null {
  if (typeof raw !== 'string' || raw.length > limit) return null;
  const trimmed = raw.trim();
  return trimmed && /^[a-zA-Z0-9][a-zA-Z0-9._%+\- ]*$/.test(trimmed) ? trimmed : null;
}

/** Cookie decoding is defensive because cookie-parser may have decoded it. */
export function parseFirstTouch(raw: unknown): Attribution | null {
  if (typeof raw !== 'string' || raw.length > 2000 || !raw) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(raw));
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (row.v !== 1) return null;
    const landingPath = typeof row.landing_path === 'string' &&
      /^\/[a-zA-Z0-9/_-]{0,180}$/.test(row.landing_path)
      ? row.landing_path : null;
    return {
      landingPath,
      referrerHost: safeValue(row.referrer_host, 120),
      utmSource: safeValue(row.utm_source, 90),
      utmMedium: safeValue(row.utm_medium, 90),
      utmCampaign: safeValue(row.utm_campaign, 90),
      utmContent: safeValue(row.utm_content, 90),
      utmTerm: safeValue(row.utm_term, 90),
    };
  } catch {
    return null;
  }
}

export function parseJourneyId(raw: unknown): string | null {
  return typeof raw === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
      ? raw : null;
}

/**
 * Opt-in only. First-touch UTM values are never overwritten by another
 * organization member or a subsequent campaign. All milestones are
 * idempotent, tenant-scoped, and omit email, tokens and content.
 */
@Injectable()
export class FunnelAttributionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Signup completion is recorded ONLY from the backend after a committed
   * new organization, never from a client-issued "signup" event or a visit to
   * /onboarding. This also covers newly registered Google/OAuth users.
   */
  async recordSignupCreated(
    organizationId: string,
    cookies: Record<string, unknown> | undefined
  ) {
    if (cookies?.ps_analytics_consent !== '1') return { recorded: false, consented: false };
    const attribution = parseFirstTouch(cookies.ps_attribution_v1) ?? {};
    const journeyId = parseJourneyId(cookies.ps_journey_id);
    await this.prisma.funnelAttribution.upsert({
      where: { organizationId },
      create: {
        organizationId, ...attribution, journeyId,
        signupCompletedAt: new Date(),
      },
      update: {},
    });
    return { recorded: true, consented: true };
  }

  async recordClientStage(
    organizationId: string,
    choice: OnboardingChoice,
    cookies: Record<string, unknown> | undefined
  ) {
    if (cookies?.ps_analytics_consent !== '1') return { recorded: false, consented: false };
    if (choice !== 'agents' && choice !== 'scheduler') {
      return { recorded: false, consented: true };
    }
    const attribution = parseFirstTouch(cookies.ps_attribution_v1) ?? {};
    const journeyId = parseJourneyId(cookies.ps_journey_id);
    await this.prisma.funnelAttribution.upsert({
      where: { organizationId },
      create: { organizationId, ...attribution, journeyId },
      update: {},
    });
    const updated = await this.prisma.funnelAttribution.updateMany({
      where: { organizationId, onboardingTypeSelectedAt: null },
      data: { onboardingIntent: choice, onboardingTypeSelectedAt: new Date() },
    });
    return { recorded: updated.count === 1, consented: true };
  }

  /** Only return stages to a visitor with analytics consent. */
  async getJourney(organizationId: string, cookies: Record<string, unknown> | undefined) {
    if (cookies?.ps_analytics_consent !== '1') {
      return { consented: false, milestones: null };
    }
    const row = await this.prisma.funnelAttribution.findUnique({
      where: { organizationId },
    });
    if (!row) return { consented: true, milestones: null };
    return {
      consented: true,
      journeyId: row.journeyId,
      source: row.utmSource,
      campaign: row.utmCampaign,
      landingPath: row.landingPath,
      milestones: {
        signup_completed: !!row.signupCompletedAt,
        onboarding_type_selected: !!row.onboardingTypeSelectedAt,
        mcp_connected: !!row.mcpConnectedAt,
        first_draft_created: !!row.firstDraftCreatedAt,
        subscription_started: !!row.subscriptionStartedAt,
      },
      onboardingType: row.onboardingIntent,
    };
  }

  async recordFirstDraft(organizationId: string) {
    await this.prisma.funnelAttribution.updateMany({
      where: { organizationId, firstDraftCreatedAt: null },
      data: { firstDraftCreatedAt: new Date() },
    });
  }

  /** Only the first successful MCP OAuth-backed Public API use counts. */
  async recordMcpConnected(organizationId: string) {
    await this.prisma.funnelAttribution.updateMany({
      where: { organizationId, mcpConnectedAt: null },
      data: { mcpConnectedAt: new Date() },
    });
  }

  /** Called only after a SIGNATURE-VERIFIED, positive-amount Polar order.paid. */
  async recordFirstPaidOrder(
    organizationId: string,
    tier: string,
    amountMinorUnits: number,
    currency: string
  ) {
    if (!Number.isSafeInteger(amountMinorUnits) || amountMinorUnits <= 0 ||
      !/^[A-Z]{3}$/.test(currency)) return;
    await this.prisma.funnelAttribution.updateMany({
      where: { organizationId, subscriptionStartedAt: null },
      data: {
        subscriptionStartedAt: new Date(),
        firstPaidTier: tier.slice(0, 20),
        firstPaidAmount: amountMinorUnits,
        firstPaidCurrency: currency,
      },
    });
  }

  async deleteJourney(organizationId: string) {
    await this.prisma.funnelAttribution.deleteMany({ where: { organizationId } });
  }

  /** Platform-owner-only reporting endpoint uses aggregates, no user PII. */
  async acquisitionReport(days: number) {
    const window = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86400000);
    const records = await this.prisma.funnelAttribution.findMany({
      where: { createdAt: { gte: window } },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    const buckets = new Map<string, {
      source: string; campaign: string; signups: number; agentIntent: number;
      schedulerIntent: number; mcpConnected: number; firstDrafts: number;
      payingCustomers: number; paidAmountMinorUnits: number;
    }>();
    for (const row of records) {
      const source = row.utmSource || (row.referrerHost ? 'referral' : 'direct_or_unknown');
      const campaign = row.utmCampaign || '(none)';
      const key = JSON.stringify([source, campaign]);
      let b = buckets.get(key);
      if (!b) {
        b = { source, campaign, signups: 0, agentIntent: 0, schedulerIntent: 0,
          mcpConnected: 0, firstDrafts: 0, payingCustomers: 0, paidAmountMinorUnits: 0 };
        buckets.set(key, b);
      }
      if (row.signupCompletedAt) b.signups++;
      if (row.onboardingIntent === 'agents') b.agentIntent++;
      if (row.onboardingIntent === 'scheduler') b.schedulerIntent++;
      if (row.mcpConnectedAt) b.mcpConnected++;
      if (row.firstDraftCreatedAt) b.firstDrafts++;
      if (row.subscriptionStartedAt) {
        b.payingCustomers++;
        // Monetary totals aren't comparable across currencies: expose only
        // customer counts in buckets. Paid amount is available in the rows.
      }
    }
    return {
      days: Math.min(Math.max(days, 1), 365),
      trackedOrganizations: records.length,
      truncated: records.length === 5000,
      bySourceCampaign: [...buckets.values()].sort((a, b) =>
        b.payingCustomers - a.payingCustomers || b.signups - a.signups
      ),
      paidJourneys: records.filter((x) => !!x.subscriptionStartedAt).map((row) => ({
        organizationId: row.organizationId,
        journeyId: row.journeyId,
        landingPath: row.landingPath,
        source: row.utmSource ?? (row.referrerHost ? 'referral' : 'direct_or_unknown'),
        referrerHost: row.referrerHost,
        campaign: row.utmCampaign,
        medium: row.utmMedium,
        intent: row.onboardingIntent,
        signupCompletedAt: row.signupCompletedAt,
        onboardingTypeSelectedAt: row.onboardingTypeSelectedAt,
        mcpConnectedAt: row.mcpConnectedAt,
        firstDraftCreatedAt: row.firstDraftCreatedAt,
        subscriptionStartedAt: row.subscriptionStartedAt,
        firstPaidTier: row.firstPaidTier,
        firstPaidCurrency: row.firstPaidCurrency,
        firstPaidAmount: row.firstPaidAmount,
      })),
    };
  }
}
