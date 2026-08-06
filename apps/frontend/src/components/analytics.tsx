"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./analytics.module.css";
import { ChannelsPanel } from "./channels-panel";
import { EmptyState } from "./empty-state";
import { useT } from "@/lib/i18n";
import { ChannelAvatar } from "./channel-avatar";
import { platformLabels } from "@/lib/platform-labels";
import { useChannels } from "@/lib/use-channels";
import {
  fetchIntegrationAnalytics,
  type AnalyticsSeries,
} from "@/lib/analytics-api";

type Range = "7d" | "30d" | "90d";

const RANGE_DAYS: Record<Range, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const RANGE_LABEL: Record<Range, string> = {
  "7d": "analytics.last7",
  "30d": "analytics.last30",
  "90d": "analytics.last90",
};

type Metric = "impressions" | "engagements" | "clicks";

function shortDay(d: Date): string {
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function pickSeriesByLabel(
  data: AnalyticsSeries[] | undefined,
  hints: string[],
): AnalyticsSeries | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  for (const hint of hints) {
    const h = hint.toLowerCase();
    const found = data.find((s) =>
      s?.label && s.label.toLowerCase().includes(h),
    );
    if (found) return found;
  }
  return data[0] ?? null;
}

function seriesPoints(s: AnalyticsSeries | null): { date: Date; value: number }[] {
  if (!s || !Array.isArray(s.data)) return [];
  return s.data
    .map((p) => ({
      date: new Date(p.date),
      value: typeof p.total === "number" ? p.total : Number(p.total) || 0,
    }))
    .filter((p) => !isNaN(p.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function sumSeries(points: { value: number }[]): number {
  return points.reduce((acc, p) => acc + (p.value || 0), 0);
}

export function Analytics() {
  const t = useT();
  const { channels } = useChannels();
  const [channelId, setChannelId] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("30d");
  const [metric, setMetric] = useState<Metric>("impressions");
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [data, setData] = useState<AnalyticsSeries[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinguishes "this platform doesn't implement analytics at all" from a
  // genuinely quiet channel — both used to render the exact same empty state.
  const [unsupported, setUnsupported] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Auto-select first channel once they load.
  useEffect(() => {
    if (channelId == null && channels.length > 0) {
      setChannelId(channels[0].id);
    }
  }, [channelId, channels]);

  const channel = useMemo(
    () => channels.find((c) => c.id === channelId) ?? null,
    [channelId, channels],
  );

  const enabledSet = useMemo(
    () => new Set<string>(channelId ? [channelId] : []),
    [channelId],
  );

  const labels = useMemo(
    () => (channel ? platformLabels(channel.platform) : null),
    [channel],
  );

  // Re-fetch whenever the selected channel or range changes. The backend
  // shapes vary per provider, so we work loosely with whatever it returns
  // and surface friendly placeholders when something is missing.
  const fetchData = (force: boolean) => {
    if (!channel) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchIntegrationAnalytics(channel.id, RANGE_DAYS[range], force)
      .then((res) => {
        if (cancelled) return;
        const isUnsupported =
          !Array.isArray(res) && !!res && (res as { unsupported?: boolean }).unsupported;
        setUnsupported(!!isUnsupported);
        setData(Array.isArray(res) ? (res as AnalyticsSeries[]) : []);
        setLastRefresh(new Date());
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : "Could not load analytics",
        );
        setUnsupported(false);
        setData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => {
    const cancel = fetchData(false);
    return () => cancel?.();
  }, [channel, range]);

  const impressionsSeries = useMemo(
    () =>
      pickSeriesByLabel(data ?? [], [
        "impression",
        "view",
        "reach",
      ]),
    [data],
  );
  const engagementsSeries = useMemo(
    () => pickSeriesByLabel(data ?? [], ["engage", "like", "reaction"]),
    [data],
  );
  const clicksSeries = useMemo(
    () =>
      pickSeriesByLabel(data ?? [], [
        "click",
        "profile",
        "subscriber",
      ]),
    [data],
  );
  const audienceSeries = useMemo(
    () =>
      pickSeriesByLabel(data ?? [], [
        "follower",
        "subscriber",
        "audience",
        "page like",
      ]),
    [data],
  );

  const points = useMemo(() => {
    const map: Record<Metric, { date: Date; value: number }[]> = {
      impressions: seriesPoints(impressionsSeries),
      engagements: seriesPoints(engagementsSeries),
      clicks: seriesPoints(clicksSeries),
    };
    return map;
  }, [impressionsSeries, engagementsSeries, clicksSeries]);

  const audiencePoints = useMemo(
    () => seriesPoints(audienceSeries),
    [audienceSeries],
  );

  const totals = useMemo(() => {
    return {
      impressions: sumSeries(points.impressions),
      engagements: sumSeries(points.engagements),
      clicks: sumSeries(points.clicks),
    };
  }, [points]);

  const audienceDelta = useMemo(() => {
    if (audiencePoints.length < 2) return 0;
    return (
      audiencePoints[audiencePoints.length - 1].value - audiencePoints[0].value
    );
  }, [audiencePoints]);

  const audienceLatest = useMemo(() => {
    if (audiencePoints.length === 0) return 0;
    return audiencePoints[audiencePoints.length - 1].value;
  }, [audiencePoints]);

  const audienceDeltaPct = useMemo(() => {
    if (audiencePoints.length < 2) return 0;
    const first = audiencePoints[0].value || 1;
    return (audienceDelta / first) * 100;
  }, [audienceDelta, audiencePoints]);

  const activeSeries =
    metric === "impressions"
      ? impressionsSeries
      : metric === "engagements"
        ? engagementsSeries
        : clicksSeries;
  const activeIsSnapshot = !!activeSeries?.isSnapshot;

  const trend = useMemo(() => {
    // A snapshot is one aggregate total, not a real series — computing a
    // "first half vs second half" delta from it is fabricated, not a trend.
    if (activeIsSnapshot) return 0;
    const arr = points[metric];
    if (!arr || arr.length < 2) return 0;
    const mid = Math.floor(arr.length / 2);
    const sumOf = (pts: { value: number }[]) =>
      pts.reduce((a, b) => a + b.value, 0);
    const first = sumOf(arr.slice(0, mid));
    const second = sumOf(arr.slice(mid));
    if (first === 0) return second > 0 ? 100 : 0;
    return ((second - first) / first) * 100;
  }, [points, metric, activeIsSnapshot]);

  const engagementRate =
    totals.impressions > 0
      ? (totals.engagements / totals.impressions) * 100
      : 0;

  return (
    <div className={styles.shell}>
      <ChannelsPanel
        channels={channels}
        enabled={enabledSet}
        collapsed={panelCollapsed}
        mode="single"
        hideActions
        onToggleChannel={(id) => setChannelId(id)}
        onToggleCollapse={() => setPanelCollapsed((v) => !v)}
      />

      <section className={styles.root}>
        <header className={styles.header}>
          <div className={styles.title}>
            <span className={styles.eyebrow}>{t("analytics.eyebrow")}</span>
            <h1 className={styles.h1}>{t("analytics.title")}</h1>
            <p className={styles.subtitle}>
              {channel
                ? `${channel.name} · ${channel.platform}`
                : t("analytics.subtitle")}
            </p>
          </div>

          <div className={styles.headerControls}>
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={() => fetchData(true)}
              disabled={loading}
              title={
                lastRefresh
                  ? `Last refresh: ${lastRefresh.toLocaleTimeString()}`
                  : "Force refresh (bypass cache)"
              }
            >
              {loading ? "↻" : "↻"} Refresh
            </button>
            <div className={styles.segmented} role="tablist" aria-label={t("analytics.range")}>
              {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={range === r}
                  className={
                    styles.segment +
                    (range === r ? " " + styles.segmentActive : "")
                  }
                  onClick={() => setRange(r)}
                >
                  {t(RANGE_LABEL[r] as any)}
                </button>
              ))}
            </div>
          </div>
        </header>

        {!channel || !labels ? (
          channels.length === 0 ? (
            <EmptyState
              icon="analytics"
              title={t("empty.analyticsTitle")}
              description={t("empty.analyticsDesc")}
              actionLabel={t("channels.add")}
              actionHref="/calendar"
            />
          ) : (
            <div className={styles.empty}>
              {t("analytics.empty")}
            </div>
          )
        ) : loading ? (
          <div className={styles.empty}>{t("common.loading")}</div>
        ) : error ? (
          <div className={styles.empty}>{error}</div>
        ) : (
          <>
            <div className={styles.kpiRow}>
              <Kpi
                label={labels.impressionsLabel}
                value={compactNumber(totals.impressions)}
                active={metric === "impressions"}
                onClick={() => setMetric("impressions")}
              />
              <Kpi
                label={labels.engagementsLabel}
                value={compactNumber(totals.engagements)}
                active={metric === "engagements"}
                onClick={() => setMetric("engagements")}
              />
              <Kpi
                label={labels.clicksLabel}
                value={compactNumber(totals.clicks)}
                active={metric === "clicks"}
                onClick={() => setMetric("clicks")}
              />
              <Kpi
                label={labels.showEngagementRate ? t("analytics.engagementRate") : labels.audienceLabel}
                value={
                  labels.showEngagementRate
                    ? `${engagementRate.toFixed(1)}%`
                    : compactNumber(audienceLatest)
                }
                hint={
                  labels.showEngagementRate
                    ? labels.audienceLabel + ": " + compactNumber(audienceLatest)
                    : undefined
                }
              />
            </div>

            <div className={styles.chartGrid}>
              <div className={styles.chartCard}>
                <div className={styles.chartHead}>
                  <div>
                    <div className={styles.chartTitle}>
                      {t("analytics.overTime", {
                        metric:
                          metric === "impressions"
                            ? labels.impressionsLabel
                            : metric === "engagements"
                              ? labels.engagementsLabel
                              : labels.clicksLabel,
                      })}
                    </div>
                    <div className={styles.chartSub}>
                      {activeIsSnapshot
                        ? t("analytics.snapshotNote")
                        : trend === 0
                          ? t("analytics.flatTrend")
                          : t("analytics.trendVsFirstHalf", {
                              arrow: trend > 0 ? "▲" : "▼",
                              pct: Math.abs(trend).toFixed(1),
                            })}
                    </div>
                  </div>
                </div>
                {points[metric].length === 0 ? (
                  <div className={styles.empty}>
                    {t("analytics.noRangeData")}
                  </div>
                ) : activeIsSnapshot ? (
                  <div className={styles.statBig}>
                    {compactNumber(sumSeries(points[metric]))}
                  </div>
                ) : (
                  <LineChart data={points[metric]} />
                )}
              </div>

              <div className={styles.chartCard}>
                <div className={styles.chartHead}>
                  <div>
                    <div className={styles.chartTitle}>
                      {labels.audienceLabel}
                    </div>
                    <div className={styles.chartSub}>
                      {audiencePoints.length === 0
                        ? t("analytics.noAudienceData")
                        : t("analytics.audienceSummary", {
                            total: compactNumber(audienceLatest),
                            arrow: audienceDelta >= 0 ? "▲" : "▼",
                            delta: compactNumber(Math.abs(audienceDelta)),
                            pct:
                              (audienceDeltaPct >= 0 ? "+" : "") +
                              audienceDeltaPct.toFixed(1),
                          })}
                    </div>
                  </div>
                </div>
                {audiencePoints.length === 0 ? (
                  <div className={styles.empty}>-</div>
                ) : (
                  <LineChart data={audiencePoints} />
                )}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.sectionHead}>
                <span className={styles.sectionTitle}>{t("analytics.seriesBreakdown")}</span>
                <span className={styles.sectionSub}>
                  {t("analytics.rawLabels", { platform: channel.platform })}
                </span>
              </div>

              {!data || data.length === 0 ? (
                <div className={styles.empty}>
                  {unsupported
                    ? t("analytics.unsupportedProvider", { platform: channel.platform })
                    : t("analytics.noProviderData")}
                </div>
              ) : (
                <ul className={styles.postList}>
                  {data.map((s, i) => {
                    const pts = seriesPoints(s);
                    const total = sumSeries(pts);
                    const last = pts[pts.length - 1];
                    return (
                      <li key={i} className={styles.postRow}>
                        <ChannelAvatar channel={channel} size={28} radius={8} />
                        <div className={styles.postMain}>
                          <span className={styles.postTitle}>{s.label}</span>
                          <span className={styles.postMeta}>
                            {t("analytics.dataPoints", { count: pts.length })}
                            {last
                              ? ` · ${t("analytics.lastPoint", { date: shortDay(last.date) })}`
                              : ""}
                          </span>
                        </div>
                        <div className={styles.postStats}>
                          <span className={styles.statBig}>
                            {compactNumber(total)}
                          </span>
                          <span className={styles.statSmall}>
                            {typeof s.percentageChange === "number"
                              ? `${s.percentageChange >= 0 ? "+" : ""}${s.percentageChange.toFixed(1)}%`
                              : ""}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ---------- KPI ---------- */

interface KpiProps {
  label: string;
  value: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
}

function Kpi({ label, value, hint, active, onClick }: KpiProps) {
  const Tag = (onClick ? "button" : "div") as "button" | "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={
        styles.kpi +
        (onClick ? " " + styles.kpiClickable : "") +
        (active ? " " + styles.kpiActive : "")
      }
    >
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
      {hint && <span className={styles.kpiHint}>{hint}</span>}
    </Tag>
  );
}

/* ---------- Generic line chart ---------- */

interface LineChartPoint {
  date: Date;
  value: number;
}

function LineChart({ data }: { data: LineChartPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const width = 800;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 44 };

  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const values = data.map((d) => d.value);
  const max = Math.max(1, ...values);
  const min = Math.min(...values, max);
  // Use a baseline that gives the line breathing room (10% below min, 10% above max).
  const yMin = Math.max(0, Math.floor(min - (max - min) * 0.1));
  const yMax = Math.ceil(max + (max - min || max * 0.05) * 0.1);
  const yRange = yMax - yMin || 1;

  const ySteps = 4;
  const yTicks: number[] = [];
  for (let i = 0; i <= ySteps; i++) {
    yTicks.push(Math.round(yMin + (yRange / ySteps) * i));
  }

  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const points = data.map((s, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + innerH - ((s.value - yMin) / yRange) * innerH;
    return { x, y, value: s.value, date: s.date };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${
          padding.top + innerH
        } L ${points[0].x} ${padding.top + innerH} Z`
      : "";

  const xLabelIdx =
    data.length <= 2
      ? data.map((_, i) => i)
      : [0, Math.floor(data.length / 2), data.length - 1];

  return (
    <div className={styles.chartWrap}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
      >
        {yTicks.map((t, i) => {
          const y = padding.top + innerH - ((t - yMin) / yRange) * innerH;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="rgba(0,0,0,0.06)"
                strokeWidth={1}
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                className={styles.axisLabel}
                textAnchor="end"
              >
                {compactNumber(t)}
              </text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill="rgba(0,0,0,0.05)" />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--fg)"
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {points.map((p, i) => {
          const slotW = stepX || 1;
          return (
            <rect
              key={i}
              x={p.x - slotW / 2}
              y={padding.top}
              width={slotW}
              height={innerH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          );
        })}

        {hover !== null && points[hover] && (
          <g>
            <line
              x1={points[hover].x}
              x2={points[hover].x}
              y1={padding.top}
              y2={padding.top + innerH}
              stroke="rgba(0,0,0,0.25)"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <circle
              cx={points[hover].x}
              cy={points[hover].y}
              r={4}
              fill="var(--bg)"
              stroke="var(--fg)"
              strokeWidth={1.5}
            />
          </g>
        )}

        {xLabelIdx.map((i) => {
          const p = points[i];
          if (!p) return null;
          return (
            <text
              key={"xl-" + i}
              x={p.x}
              y={height - 8}
              className={styles.axisLabel}
              textAnchor={
                i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"
              }
            >
              {shortDay(p.date)}
            </text>
          );
        })}
      </svg>

      {hover !== null && points[hover] && (
        <div
          className={styles.tooltip}
          style={{ left: `${(points[hover].x / width) * 100}%` }}
        >
          <span className={styles.tooltipDate}>{shortDay(points[hover].date)}</span>
          <span className={styles.tooltipValue}>{compactNumber(points[hover].value)}</span>
        </div>
      )}
    </div>
  );
}
