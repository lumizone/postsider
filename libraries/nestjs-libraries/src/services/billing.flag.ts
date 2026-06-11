/**
 * Single source of truth for "is paid billing enforced?".
 *
 * Historically the codebase used the presence of `STRIPE_PUBLISHABLE_KEY` to
 * decide whether to gate features behind a subscription. With the move to
 * Polar.sh, billing is enabled when EITHER provider is configured:
 *   - Stripe:  STRIPE_PUBLISHABLE_KEY
 *   - Polar:   POLAR_ACCESS_TOKEN
 *
 * When neither is set, the app runs in "all unlocked" mode (every org behaves
 * like the top tier), which is the intended self-hosted / pre-launch default.
 */
export function isBillingEnabled(): boolean {
  return !!process.env.POLAR_ACCESS_TOKEN || !!process.env.STRIPE_PUBLISHABLE_KEY;
}
