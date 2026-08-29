/**
 * Maps PostSider plan tiers + billing periods to Polar product ids.
 *
 * In Polar, a product has a single billing interval, so each tier needs two
 * products (monthly + yearly). Product ids come from the environment so the
 * same code works across sandbox and production without rebuilds.
 *
 * Set these in your .env:
 *   POLAR_PRODUCT_STANDARD_MONTHLY, POLAR_PRODUCT_STANDARD_YEARLY,
 *   POLAR_PRODUCT_TEAM_MONTHLY,     POLAR_PRODUCT_TEAM_YEARLY,
 *   POLAR_PRODUCT_PRO_MONTHLY,      POLAR_PRODUCT_PRO_YEARLY,
 *   POLAR_PRODUCT_ULTIMATE_MONTHLY, POLAR_PRODUCT_ULTIMATE_YEARLY
 */
export type BillingTier = 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE';
export type BillingPeriod = 'MONTHLY' | 'YEARLY';

export interface PolarProductRef {
  tier: BillingTier;
  period: BillingPeriod;
  productId: string;
}

const TIERS: BillingTier[] = ['STANDARD', 'TEAM', 'PRO', 'ULTIMATE'];
const PERIODS: BillingPeriod[] = ['MONTHLY', 'YEARLY'];

function envKey(tier: BillingTier, period: BillingPeriod) {
  return `POLAR_PRODUCT_${tier}_${period}`;
}

/**
 * Resolve the Polar product id configured for a tier + period.
 * Returns undefined if not configured.
 */
export function getPolarProductId(
  tier: BillingTier,
  period: BillingPeriod
): string | undefined {
  const value = process.env[envKey(tier, period)];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * Build a reverse lookup of every configured product id back to its
 * tier + period. Used when handling webhooks where Polar only sends the
 * product id.
 */
export function buildProductReverseMap(): Record<string, PolarProductRef> {
  const map: Record<string, PolarProductRef> = {};
  for (const tier of TIERS) {
    for (const period of PERIODS) {
      const productId = getPolarProductId(tier, period);
      if (productId) {
        map[productId] = { tier, period, productId };
      }
    }
  }
  return map;
}

/**
 * Find the tier + period for a given Polar product id, or null if unknown.
 */
export function resolveProductRef(productId?: string | null): PolarProductRef | null {
  if (!productId) {
    return null;
  }
  return buildProductReverseMap()[productId] || null;
}

/**
 * List every configured product id (for building checkout product lists).
 */
export function getAllConfiguredProducts(): PolarProductRef[] {
  return Object.values(buildProductReverseMap());
}
