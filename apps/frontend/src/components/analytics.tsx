"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { rowsToCsv, downloadCsv } from "@/lib/csv-export";

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

function fullRange(d: Date): string {
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

/* ── URL state ─────────────────────────────────────────────────────────────── */

function readQuery(): { channel?: string; period?: string } {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  return {
    channel: q.get("channel") ?? undefined,
    period: q.get("period") ?? undefined,
  };
}

function writeQuery(channel: string | null, period: string) {
  if (typeof window === "undefined") return;
  const q = new URLSearchParams();
  if (channel) q.set("channel", channel);
  q.set("period", period);
  window.history.replaceState({}, "", `${window.location.pathname}?${q.toString()}`);
}

/* ── Small presentational bits ─────────────────────────────────────────────── */

function Sparkline({
  data,
  accent = false,
}: {
  data: { value: number }[];
  accent?: boolean;
}) {
  const w = 96;
  const h = 28;
  const values = data.map((d) => d.value);
  const max = Math.max(1, ...values);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const stepX = data.length > 1 ? w / (data.length - 1) : w;
  const pts = data.map((d, i) => ({
    x: i * stepX,
    y: h - 3 - ((d.value - min) / range) * (h - 6),
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const stroke = accent ? "var(--accent)" : "var(--fg)";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className={styles.sparkline}>
      {pts.length > 1 && (
        <path
          d={`${line} L ${w} ${h} L 0 ${h} Z`}
          fill={accent ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "rgb(var(--tint) / 0.05)"}
        />
      )}
      {pts.length > 1 && (
        <path d={line} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      )}
    </svg>
  );
}

function GrowthBadge({ pct }: { pct: number | null }) {
  const t = useT();
  if (pct == null || !isFinite(pct)) {
    return <span className={styles.growthBadge + " " + styles.growthNeutral}>—</span>;
  }
  if (pct === 0) {
    return <span className={styles.growthBadge + " " + styles.growthNeutral}>0.0%</span>;
  }
  const up = pct > 0;
  return (
    <span className={styles.growthBadge + (up ? " " + styles.growthUp : " " + styles.growthDown)}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className={styles.infoTip} tabIndex={0}>
      <svg viewBox="0 0 16 16" fill="none" width="12" height="12" aria-hidden>
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 7.2v3.3M8 5.6v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span className={styles.infoTipText}>{text}</span>
    </span>
  );
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
  const [unsupported, setUnsupported] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // Custom date range (start → today). Overrides the 7/30/90 segmented control.
  const [customStart, setCustomStart] = useState<Date | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const customRef = useRef<HTMLDivElement | null>(null);

  // Close the custom date picker on outside click / Escape.
  useEffect(() => {
    if (!customOpen) return;
    const onDown = (e: MouseEvent) => {
      if (customRef.current && !customRef.current.contains(e.target as Node)) {
        setCustomOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCustomOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [customOpen]);

  // Auto-select first channel once they load, restoring ?channel= / ?period=
  // from the URL so a refresh or a shared link keeps the same view.
  useEffect(() => {
    if (channels.length === 0) return;
    const q = readQuery();
    if (q.period === "7d" || q.period === "30d" || q.period === "90d") {
      setRange(q.period);
    }
    if (channelId == null) {
      const match = channels.find((c) => c.id === q.channel);
      const next = match ? match.id : channels[0].id;
      setChannelId(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels]);

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

  const effectiveDays = useMemo(() => {
    if (customStart) {
      const ms = Date.now() - customStart.getTime();
      return Math.max(1, Math.ceil(ms / 86_400_000));
    }
    return RANGE_DAYS[range];
  }, [customStart, range]);

  const fetchData = (force: boolean) => {
    if (!channel) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchIntegrationAnalytics(channel.id, effectiveDays, force)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, effectiveDays]);

  const impressionsSeries = useMemo(
    () => pickSeriesByLabel(data ?? [], ["impression", "view", "reach"]),
    [data],
  );
  const engagementsSeries = useMemo(
    () => pickSeriesByLabel(data ?? [], ["engage", "like", "reaction"]),
    [data],
  );
  const clicksSeries = useMemo(
    () => pickSeriesByLabel(data ?? [], ["click", "profile", "subscriber"]),
    [data],
  );
  const audienceSeries = useMemo(
    () => pickSeriesByLabel(data ?? [], ["follower", "subscriber", "audience", "page like"]),
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
    return audiencePoints[audiencePoints.length - 1].value - audiencePoints[0].value;
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
    if (activeIsSnapshot) return 0;
    const arr = points[metric];
    if (!arr || arr.length < 2) return 0;
    const mid = Math.floor(arr.length / 2);
    const sumOf = (pts: { value: number }[]) => pts.reduce((a, b) => a + b.value, 0);
    const first = sumOf(arr.slice(0, mid));
    const second = sumOf(arr.slice(mid));
    if (first === 0) return second > 0 ? 100 : 0;
    return ((second - first) / first) * 100;
  }, [points, metric, activeIsSnapshot]);

  const engagementRate =
    totals.impressions > 0
      ? (totals.engagements / totals.impressions) * 100
      : 0;

  const exportCsv = () => {
    if (!data || data.length === 0 || !channel) return;
    const rows: (string | number)[][] = [];
    for (const series of data) {
      for (const point of series.data) {
        rows.push([series.label, point.date, point.total]);
      }
    }
    const csv = rowsToCsv(["Metric", "Date", "Value"], rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`${channel.name}-analytics-${effectiveDays}d-${stamp}.csv`, csv);
  };

  const selectChannel = (id: string) => {
    setChannelId(id);
    writeQuery(id, customStart ? "custom" : range);
  };

  const selectRange = (r: Range) => {
    setRange(r);
    setCustomStart(null);
    writeQuery(channelId, r);
  };

  const applyCustomStart = (d: Date) => {
    setCustomStart(d);
    setCustomOpen(false);
    writeQuery(channelId, "custom");
  };

  const rangeLabelText = customStart
    ? `${fullRange(customStart)} – ${fullRange(new Date())}`
    : t("analytics.custom");

  return (
    <div className={styles.shell}>
      <ChannelsPanel
        channels={channels}
        enabled={enabledSet}
        collapsed={panelCollapsed}
        mode="single"
        hideActions
        onToggleChannel={selectChannel}
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
              className={styles.actionBtn}
              onClick={exportCsv}
              disabled={!data || data.length === 0}
              title={t("analytics.exportCsvHint")}
            >
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14" aria-hidden>
                <path d="M8 2.5v7M5 6.5 8 9.5l3-3M3 13.5h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t("analytics.exportCsv")}
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => fetchData(true)}
              disabled={loading}
              title={lastRefresh ? `Last refresh: ${lastRefresh.toLocaleTimeString()}` : "Force refresh (bypass cache)"}
            >
              <svg viewBox="0 0 16 16" fill="none" width="14" height="14" aria-hidden>
                <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t("analytics.refresh")}
            </button>

            <div className={styles.segmented} role="tablist" aria-label={t("analytics.range")}>
              {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  role="tab"
                  aria-selected={range === r && !customStart}
                  className={
                    styles.segment +
                    (range === r && !customStart ? " " + styles.segmentActive : "")
                  }
                  onClick={() => selectRange(r)}
                >
                  {t(RANGE_LABEL[r] as any)}
                </button>
              ))}
            </div>

            <div className={styles.customWrap} ref={customRef}>
              <button
                type="button"
                className={styles.customBtn + (customStart ? " " + styles.customBtnActive : "")}
                onClick={() => setCustomOpen((v) => !v)}
                aria-expanded={customOpen}
              >
                <svg viewBox="0 0 16 16" fill="none" width="14" height="14" aria-hidden>
                  <rect x="2.5" y="3" width="11" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M2.5 6h11M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                {rangeLabelText}
                <svg viewBox="0 0 16 16" fill="none" width="12" height="12" aria-hidden>
                  <path d="M4 6.5 8 10.5 12 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {customOpen && (
                <div className={styles.customMenu}>
                  <label className={styles.customLabel}>{t("analytics.fromDate")}</label>
                  <input
                    type="date"
                    className={styles.customInput}
                    value={customStart ? iso(customStart) : iso(new Date(Date.now() - 30 * 86_400_000))}
                    onChange={(e) => {
                      const d = new Date(e.target.value);
                      if (!isNaN(d.getTime())) applyCustomStart(d);
                    }}
                  />
                </div>
              )}
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
            <div className={styles.empty}>{t("analytics.empty")}</div>
          )
        ) : loading ? (
          <AnalyticsSkeleton />
        ) : error ? (
          <ErrorCard message={error} onRetry={() => fetchData(true)} />
        ) : !data || data.length === 0 ? (
          unsupported ? (
            <div className={styles.stateCard}>
              <div className={styles.stateTitle}>{t("analytics.noProviderData")}</div>
              <div className={styles.stateDesc}>
                {t("analytics.unsupportedProvider", { platform: channel.platform })}
              </div>
            </div>
          ) : (
            <div className={styles.stateCard}>
              <div className={styles.stateTitle}>{t("analytics.noDataYet")}</div>
              <div className={styles.stateDesc}>{t("analytics.noDataYetDesc")}</div>
            </div>
          )
        ) : (
          <>
            <div className={styles.kpiRow}>
              <Kpi
                label={labels.impressionsLabel}
                value={compactNumber(totals.impressions)}
                spark={points.impressions}
                accent
                info={t("analytics.impressionsInfo")}
                active={metric === "impressions"}
                onClick={() => setMetric("impressions")}
              />
              <Kpi
                label={labels.engagementsLabel}
                value={compactNumber(totals.engagements)}
                spark={points.engagements}
                info={t("analytics.engagementsInfo")}
                active={metric === "engagements"}
                onClick={() => setMetric("engagements")}
              />
              <Kpi
                label={labels.clicksLabel}
                value={compactNumber(totals.clicks)}
                spark={points.clicks}
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
                info={labels.showEngagementRate ? t("analytics.engagementRateInfo") : undefined}
                hint={
                  labels.showEngagementRate
                    ? `${labels.audienceLabel}: ${compactNumber(audienceLatest)}`
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
                        : `${labels.impressionsLabel}: ${compactNumber(sumSeries(points[metric]))}`}
                    </div>
                  </div>
                  {!activeIsSnapshot && <GrowthBadge pct={trend} />}
                </div>
                {points[metric].length === 0 ? (
                  <div className={styles.empty}>{t("analytics.noRangeData")}</div>
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
                    <div className={styles.chartTitle}>{labels.audienceLabel}</div>
                    <div className={styles.chartSub}>
                      {audiencePoints.length === 0
                        ? t("analytics.noAudienceData")
                        : `${compactNumber(audienceLatest)} total`}
                    </div>
                  </div>
                  {audiencePoints.length >= 2 && <GrowthBadge pct={audienceDeltaPct} />}
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

              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.th + " " + styles.thSeries}>{t("analytics.series")}</th>
                      <th className={styles.th + " " + styles.thNum}>{t("analytics.value")}</th>
                      <th className={styles.th + " " + styles.thNum}>{t("analytics.change")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((s, i) => {
                      const pts = seriesPoints(s);
                      const total = sumSeries(pts);
                      const last = pts[pts.length - 1];
                      return (
                        <tr key={i} className={styles.tr}>
                          <td className={styles.td}>
                            <span className={styles.tdSeries}>
                              <ChannelAvatar channel={channel} size={28} radius={8} />
                              <span className={styles.tdSeriesText}>
                                <span className={styles.tdTitle}>{s.label}</span>
                                <span className={styles.tdMeta}>
                                  {t("analytics.dataPoints", { count: pts.length })}
                                  {last ? ` · ${t("analytics.lastPoint", { date: shortDay(last.date) })}` : ""}
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className={styles.td + " " + styles.tdNum}>
                            <span className={styles.tdValue}>{compactNumber(total)}</span>
                          </td>
                          <td className={styles.td + " " + styles.tdNum}>
                            <GrowthBadge
                              pct={
                                typeof s.percentageChange === "number"
                                  ? s.percentageChange
                                  : null
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ── ISO date helper for the custom range input ─────────────────────────────── */
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/* ── Loading / error / zero states ──────────────────────────────────────────── */

function AnalyticsSkeleton() {
  return (
    <div className={styles.skeletonWrap} aria-hidden>
      <div className={styles.kpiRow}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={styles.kpi + " " + styles.skeleton} />
        ))}
      </div>
      <div className={styles.chartGrid}>
        <div className={styles.chartCard + " " + styles.skeletonTall} />
        <div className={styles.chartCard + " " + styles.skeletonTall} />
      </div>
      <div className={styles.card + " " + styles.skeletonTall} />
    </div>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT();
  return (
    <div className={styles.stateCard}>
      <div className={styles.stateTitle}>{t("analytics.couldntLoad")}</div>
      <div className={styles.stateDesc}>{message || t("analytics.tryRefresh")}</div>
      <button type="button" className={styles.actionBtn} onClick={onRetry} style={{ marginTop: 8 }}>
        {t("calendar.retry")}
      </button>
    </div>
  );
}

/* ---------- KPI ---------- */

interface KpiProps {
  label: string;
  value: string;
  hint?: string;
  spark?: { value: number }[];
  accent?: boolean;
  info?: string;
  active?: boolean;
  onClick?: () => void;
}

function Kpi({ label, value, hint, spark, accent, info, active, onClick }: KpiProps) {
  const Tag = (onClick ? "button" : "div") as "button" | "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={
        styles.kpi +
        (onClick ? " " + styles.kpiClickable : "") +
        (active ? " " + styles.kpiActive : "") +
        (accent ? " " + styles.kpiAccent : "")
      }
    >
      <span className={styles.kpiLabel}>
        {label}
        {info && <InfoTip text={info} />}
      </span>
      <span className={styles.kpiValue}>{value}</span>
      {hint && <span className={styles.kpiHint}>{hint}</span>}
      {spark && spark.length > 1 && (
        <span className={styles.kpiSpark}>
          <Sparkline data={spark} accent={accent} />
        </span>
      )}
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
                stroke="rgb(var(--tint) / 0.06)"
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

        {areaPath && <path d={areaPath} fill="rgb(var(--tint) / 0.05)" />}
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
              stroke="rgb(var(--tint) / 0.25)"
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
