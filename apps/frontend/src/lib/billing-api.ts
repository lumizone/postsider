"use client";

import { api } from "./api";

/**
 * Billing tiers. Mirrors the backend `pricing.ts` for display purposes.
 *
 * Only `channels`, `postsPerMonth` and `teamMembers` are enforced today; the
 * other product features are intentionally not advertised because they aren't
 * built yet. Prices here are for display only — Polar holds the source
 * of truth and the backend validates against its own pricing table.
 */
export type TierName = "STANDARD" | "TEAM" | "PRO" | "ULTIMATE";
/** Includes the internal SAMURAI plan that may appear on a subscription. */
export type SubscriptionTierName = TierName | "SAMURAI";
export type BillingPeriod = "MONTHLY" | "YEARLY";

export interface PlanDescriptor {
  name: TierName;
  monthlyPrice: number;
  yearlyPrice: number;
  channels: number;
  postsPerMonth: number | "unlimited";
  teamMembers: boolean;
  /** Whether to show a "Popular" badge on this plan. */
  popular: boolean;
}

/**
 * Structural plan data only. All display copy (labels, taglines, feature
 * bullets) lives in the i18n catalog under `billing.plans.*` and
 * `billing.features.*`; the billing page composes the card copy from there.
 */
export const PLANS: PlanDescriptor[] = [
  {
    name: "STANDARD",
    monthlyPrice: 20,
    yearlyPrice: 200,
    channels: 5,
    postsPerMonth: 400,
    teamMembers: false,
    popular: false,
  },
  {
    name: "TEAM",
    monthlyPrice: 35,
    yearlyPrice: 350,
    channels: 10,
    postsPerMonth: "unlimited",
    teamMembers: true,
    popular: false,
  },
  {
    name: "PRO",
    monthlyPrice: 45,
    yearlyPrice: 450,
    channels: 30,
    postsPerMonth: "unlimited",
    teamMembers: true,
    popular: true,
  },
  {
    name: "ULTIMATE",
    monthlyPrice: 90,
    yearlyPrice: 900,
    channels: 100,
    postsPerMonth: "unlimited",
    teamMembers: true,
    popular: false,
  },
];

export function getPlan(name: string | null | undefined): PlanDescriptor | null {
  if (!name) return null;
  // SAMURAI is an internal owner-only plan — not sold, not shown in the grid,
  // but recognized so the current-plan summary renders correctly.
  if (name === "SAMURAI") {
    return {
      name: "ULTIMATE",
      monthlyPrice: 0,
      yearlyPrice: 0,
      channels: 1000000,
      postsPerMonth: "unlimited",
      teamMembers: true,
      popular: false,
    };
  }
  return PLANS.find((p) => p.name === name) ?? null;
}

export interface CurrentSubscription {
  id: string;
  organizationId: string;
  subscriptionTier: SubscriptionTierName;
  identifier: string | null;
  cancelAt: string | null;
  period: BillingPeriod;
  totalChannels: number;
  isLifetime: boolean;
  createdAt: string;
}

/** Current subscription for the org, or null when on the free/no plan. */
export async function getCurrentBilling(): Promise<CurrentSubscription | null> {
  const res = await api.get<CurrentSubscription | null>("/billing", undefined, {
    silent: true,
  });
  return res || null;
}

interface SubscribeResponse {
  // Polar redirect checkout
  url?: string;
  id?: string;
  // in-place upgrade returns just { id }
  portal?: string;
}

/**
 * Start a checkout for the given tier + period. Returns a URL to redirect the
 * browser to (hosted checkout or billing portal). When the backend performs an
 * in-place change it may return only an id and no url.
 */
export async function subscribe(
  billing: TierName,
  period: BillingPeriod
): Promise<SubscribeResponse> {
  return api.post<SubscribeResponse>("/billing/subscribe", {
    billing,
    period,
  });
}

/** Open the provider customer portal (manage card, invoices, cancel). */
export async function openBillingPortal(): Promise<string | null> {
  const res = await api.get<{ portal: string }>("/billing/portal", undefined, {
    silent: true,
  });
  return res?.portal || null;
}

/** Cancel the active subscription at period end. */
export async function cancelSubscription(feedback: string): Promise<{
  id: string;
  cancel_at?: string;
}> {
  return api.post("/billing/cancel", { feedback });
}

/** Poll checkout provisioning status. 2 = provisioned, 1 = pending, 0 = none. */
export async function checkCheckout(id: string): Promise<number> {
  const res = await api.get<{ status: number }>(
    `/billing/check/${encodeURIComponent(id)}`,
    undefined,
    { silent: true }
  );
  return res?.status ?? 0;
}
