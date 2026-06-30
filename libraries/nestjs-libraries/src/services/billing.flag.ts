/**
 * Single source of truth for "is paid billing enforced?".
 *
 * PostSider billing is Polar.sh only. Billing is enabled when POLAR_ACCESS_TOKEN
 * is configured. When it is absent the app runs in "all unlocked" mode (every org
 * behaves like the top tier) - the intended self-hosted default.
 */
export function isBillingEnabled(): boolean {
  return !!process.env.POLAR_ACCESS_TOKEN;
}
