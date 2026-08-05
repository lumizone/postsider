import { api } from "./api";

/**
 * Per-provider analytics.
 *
 * The backend dispatches to `IntegrationService.checkAnalytics`, whose return
 * shape is provider-specific. The shared subset every social analytics
 * provider returns is an array of `AnalyticsData`-style entries with
 * `{ label, percentageChange, data: [{ total, date }] }`.
 *
 * We type that loosely and let consumers reshape as they need.
 */
export interface AnalyticsSeriesPoint {
  total: number | string;
  date: string;
}

export interface AnalyticsSeries {
  label: string;
  percentageChange?: number;
  data: AnalyticsSeriesPoint[];
}

export type IntegrationAnalyticsResponse = AnalyticsSeries[] | Record<string, unknown>;

export async function fetchIntegrationAnalytics(
  /** Integration ROW ID (Integration.id), not the provider identifier. */
  integrationId: string,
  /** Number of days to look back: backend treats this as a stringified number. */
  daysBack: number,
  /** Bypass the Redis cache and force a fresh fetch from the provider. */
  forceRefresh = false,
): Promise<IntegrationAnalyticsResponse> {
  const params: Record<string, string> = { date: String(daysBack) };
  if (forceRefresh) params.refresh = 'true';
  return api.get<IntegrationAnalyticsResponse>(
    `/analytics/${integrationId}`,
    params,
    { silent: true },
  );
}
