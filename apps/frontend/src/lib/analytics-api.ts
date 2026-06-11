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
): Promise<IntegrationAnalyticsResponse> {
  return api.get<IntegrationAnalyticsResponse>(
    `/analytics/${integrationId}`,
    { date: String(daysBack) },
    { silent: true },
  );
}
