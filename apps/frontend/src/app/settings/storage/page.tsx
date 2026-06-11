"use client";

import { useEffect, useState } from "react";
import {
  PageHeader,
  Card,
  settingsStyles as s,
} from "@/components/settings-ui";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
interface StorageConfig {
  uploadDirectory?: string;
  publicUrl?: string;
  bucket?: string;
  region?: string;
  bucketUrl?: string;
  accountId?: string;
}

interface StorageStats {
  total: number;
  images: number;
  videos: number;
  totalBytes: number;
}

interface StorageInfo {
  provider: "local" | "cloudflare";
  config: StorageConfig;
  stats: StorageStats;
}

function formatBytes(b: number): string {
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(2) + " GB";
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(0) + " KB";
  return b + " B";
}

const LIMITS = [
  { value: 0, label: "Unlimited" },
  { value: 1_073_741_824, label: "1 GB" },
  { value: 5_368_709_120, label: "5 GB" },
  { value: 10_737_418_240, label: "10 GB" },
  { value: 21_474_836_480, label: "20 GB" },
  { value: 53_687_091_200, label: "50 GB" },
  { value: 107_374_182_400, label: "100 GB" },
];

const RETENTION_OPTIONS = [
  { value: 0, label: "Never delete" },
  { value: 30, label: "30 days" },
  { value: 60, label: "60 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
  { value: 365, label: "1 year" },
];

export default function StorageSettingsPage() {
  const t = useT();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local settings (persisted to localStorage for now — no backend endpoint yet)
  const [limit, setLimit] = useState(0);
  const [retention, setRetention] = useState(0);
  const [cleanOrphans, setCleanOrphans] = useState(false);

  const reloadStorage = async () => {
    const res = await api.get<StorageInfo>("/settings/storage");
    setInfo(res);
  };

  useEffect(() => {
    setLoading(true);
    api
      .get<StorageInfo>("/settings/storage")
      .then((res) => setInfo(res))
      .catch((err) =>
        setError(err instanceof Error ? err.message : t("settingsStorage.loadError")),
      )
      .finally(() => setLoading(false));

    // Restore prefs
    try {
      const stored = localStorage.getItem("postsider:storage-prefs");
      if (stored) {
        const p = JSON.parse(stored);
        if (p.limit !== undefined) setLimit(p.limit);
        if (p.retention !== undefined) setRetention(p.retention);
        if (p.cleanOrphans !== undefined) setCleanOrphans(p.cleanOrphans);
      }
    } catch {}
  }, []);

  const savePrefs = (next: { limit: number; retention: number; cleanOrphans: boolean }) => {
    setLimit(next.limit);
    setRetention(next.retention);
    setCleanOrphans(next.cleanOrphans);
    try {
      localStorage.setItem("postsider:storage-prefs", JSON.stringify(next));
    } catch {}
  };

  if (loading) {
    return <PageHeader eyebrow={t("settings.eyebrow")} title={t("settingsStorage.title")} subtitle={t("common.loading")} />;
  }

  if (error || !info) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsStorage.title")}
        subtitle={error || t("settingsStorage.loadError")}
      />
    );
  }

  const { provider, config, stats } = info;
  const isLocal = provider === "local";
  const limitActive = limit > 0;
  const usedPct = limitActive ? Math.min(100, (stats.totalBytes / limit) * 100) : 0;
  const imgPct = stats.total > 0 ? (stats.images / stats.total) * 100 : 0;
  const vidPct = stats.total > 0 ? (stats.videos / stats.total) * 100 : 0;

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsStorage.title")}
        subtitle={t("settingsStorage.subtitleFull")}
      />

      {/* ─── Usage ─────────────────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <div
          style={{
            padding: "28px 28px 24px",
            borderRadius: 20,
            border: "1px solid var(--line-soft)",
            background: "linear-gradient(135deg, rgba(0,0,0,0.015) 0%, rgba(0,0,0,0) 100%)",
          }}
        >
          {/* Header row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 20,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 6 }}>
                {t("settingsStorage.storageUsed")}
              </div>
              <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>
                {stats.total === 0 ? "0 B" : formatBytes(stats.totalBytes)}
              </div>
              {limitActive && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                  {t("settingsStorage.ofLimit", { limit: LIMITS.find((l) => l.value === limit)?.label ?? formatBytes(limit) })}
                </div>
              )}
            </div>
            <div
              style={{
                padding: "6px 14px",
                borderRadius: 99,
                background: isLocal ? "rgba(0,0,0,0.05)" : "rgba(37,99,235,0.08)",
                fontSize: 12,
                fontWeight: 600,
                color: isLocal ? "var(--fg)" : "#2563EB",
              }}
            >
              {isLocal ? t("settingsStorage.localDisk") : "Cloudflare R2"}
            </div>
          </div>

          {/* Bar */}
          <div
            style={{
              height: 8,
              borderRadius: 99,
              background: "rgba(0,0,0,0.06)",
              overflow: "hidden",
              marginBottom: 18,
            }}
          >
            {limitActive ? (
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(usedPct, stats.total > 0 ? 2 : 0)}%`,
                  background: usedPct > 90 ? "#EF4444" : usedPct > 70 ? "#F59E0B" : "#0F0F0F",
                  borderRadius: 99,
                  transition: "width 300ms ease",
                }}
              />
            ) : (
              <div style={{ height: "100%", display: "flex" }}>
                {imgPct > 0 && (
                  <div style={{ height: "100%", width: `${imgPct}%`, background: "#0F0F0F" }} />
                )}
                {vidPct > 0 && (
                  <div style={{ height: "100%", width: `${vidPct}%`, background: "#737373" }} />
                )}
                {stats.total > 0 && imgPct + vidPct < 100 && (
                  <div style={{ height: "100%", width: `${100 - imgPct - vidPct}%`, background: "#D4D4D4" }} />
                )}
              </div>
            )}
          </div>

          {/* Breakdown */}
          <div style={{ display: "flex", gap: 28, fontSize: 13 }}>
            <Stat color="#0F0F0F" label={t("media.images")} value={stats.images} />
            <Stat color="#737373" label={t("media.videos")} value={stats.videos} />
            <Stat
              color="#D4D4D4"
              label={t("settingsStorage.other")}
              value={Math.max(0, stats.total - stats.images - stats.videos)}
            />
            <div style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12, alignSelf: "center" }}>
              {t("settingsStorage.filesTotal", { count: stats.total })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Limit ─────────────────────────────────────────────── */}
      <Card title={t("settingsStorage.limitTitle")} subtitle={t("settingsStorage.limitSubtitle")}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <select
            value={limit}
            onChange={(e) =>
              savePrefs({ limit: Number(e.target.value), retention, cleanOrphans })
            }
            className={s.select}
            style={{ width: 180 }}
          >
            {LIMITS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          {limitActive && (
            <span style={{ fontSize: 12, color: usedPct > 90 ? "#EF4444" : "var(--muted)" }}>
              {t("settingsStorage.pctUsed", { pct: usedPct.toFixed(1) })}
            </span>
          )}
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--muted)" }}>
          {t("settingsStorage.limitNote")}
        </p>
      </Card>

      {/* ─── Auto-cleanup ──────────────────────────────────────── */}
      <Card title={t("settingsStorage.cleanupTitle")} subtitle={t("settingsStorage.cleanupSubtitle")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Retention */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{t("settingsStorage.deleteUnusedAfter")}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("settingsStorage.deleteUnusedDesc")}
              </span>
            </div>
            <select
              value={retention}
              onChange={(e) =>
                savePrefs({ limit, retention: Number(e.target.value), cleanOrphans })
              }
              className={s.select}
              style={{ width: 150 }}
            >
              {RETENTION_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {/* Orphan cleanup */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{t("settingsStorage.cleanOrphans")}</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("settingsStorage.cleanOrphansDesc")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => savePrefs({ limit, retention, cleanOrphans: !cleanOrphans })}
              style={{
                width: 44,
                height: 24,
                borderRadius: 99,
                border: "none",
                background: cleanOrphans ? "var(--fg)" : "rgba(0,0,0,0.1)",
                position: "relative",
                cursor: "pointer",
                transition: "background 150ms ease",
              }}
              role="switch"
              aria-checked={cleanOrphans}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: cleanOrphans ? 23 : 3,
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  transition: "left 150ms ease",
                }}
              />
            </button>
          </div>
        </div>
      </Card>

      {/* ─── Manual cleanup ─────────────────────────────────── */}
      <Card title={t("settingsStorage.manualTitle")} subtitle={t("settingsStorage.manualSubtitle")}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <CleanupAction
            title={t("settingsStorage.deleteUnusedTitle")}
            description={t("settingsStorage.deleteUnusedActionDesc")}
            buttonLabel={t("settingsStorage.cleanNow")}
            variant="secondary"
            onRun={async () => {
              const res = await api.post<{ deleted: number }>(
                "/media/cleanup/unused",
                {},
              );
              await reloadStorage();
              alert(
                res.deleted > 0
                  ? t("settingsStorage.removedUnused", { count: res.deleted })
                  : t("settingsStorage.noUnused"),
              );
            }}
          />
          <CleanupAction
            title={t("settingsStorage.deleteAllTitle")}
            description={t("settingsStorage.deleteAllDesc")}
            buttonLabel={t("settingsStorage.deleteEverything")}
            variant="danger"
            confirmWord="DELETE"
            onRun={async () => {
              const res = await api.post<{ deleted: number }>(
                "/media/cleanup/all",
                {},
              );
              await reloadStorage();
              alert(
                res.deleted > 0
                  ? t("settingsStorage.removedFiles", { count: res.deleted })
                  : t("settingsStorage.noFiles"),
              );
            }}
          />
        </div>
      </Card>

      {/* ─── Provider details ──────────────────────────────────── */}
      <Card title={t("settingsStorage.providerConfig")}>
        {isLocal ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ConfigRow label={t("settingsStorage.directory")} value={config.uploadDirectory || "./uploads"} />
            <ConfigRow label={t("settingsStorage.publicUrl")} value={config.publicUrl || "—"} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ConfigRow label={t("settingsStorage.bucket")} value={config.bucket || "—"} />
            <ConfigRow label={t("settingsStorage.region")} value={config.region || "auto"} />
            <ConfigRow label={t("settingsStorage.bucketUrl")} value={config.bucketUrl || "—"} />
            <ConfigRow label={t("settingsStorage.accountId")} value={config.accountId || "—"} />
          </div>
        )}
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(0,0,0,0.025)",
            fontSize: 12,
            color: "var(--muted)",
            lineHeight: 1.6,
          }}
        >
          {isLocal ? (
            <>
              To switch to Cloudflare R2, set <code>STORAGE_PROVIDER=&quot;cloudflare&quot;</code> in
              your <code>.env</code> file along with your R2 credentials, then restart
              the backend.
            </>
          ) : (
            <>
              To switch back to local disk, set <code>STORAGE_PROVIDER=&quot;local&quot;</code> and
              <code>UPLOAD_DIRECTORY=&quot;./uploads&quot;</code> in your <code>.env</code>, then
              restart the backend.
            </>
          )}
        </div>
      </Card>
    </>
  );
}

/* ─── Sub-components ─── */

function Stat({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 14,
        padding: "10px 0",
        borderBottom: "1px solid rgba(0,0,0,0.04)",
        fontSize: 13,
      }}
    >
      <span style={{ width: 100, color: "var(--muted)", fontWeight: 500, flexShrink: 0 }}>
        {label}
      </span>
      <code style={{ wordBreak: "break-all", fontSize: 12 }}>{value}</code>
    </div>
  );
}

function CleanupAction({
  title,
  description,
  buttonLabel,
  variant,
  confirmWord,
  onRun,
  disabled = false,
  disabledNote,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  variant: "secondary" | "danger";
  /** If set, shows a confirmation modal requiring the user to type this word. */
  confirmWord?: string;
  onRun: () => Promise<void>;
  /** When true the action is not yet available and the button is inert. */
  disabled?: boolean;
  /** Optional note shown next to a disabled action explaining why. */
  disabledNote?: string;
}) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [typed, setTyped] = useState("");

  const handle = async () => {
    if (disabled) {
      return;
    }
    if (confirmWord) {
      setShowConfirm(true);
      setTyped("");
      return;
    }
    setRunning(true);
    try {
      await onRun();
    } finally {
      setRunning(false);
    }
  };

  const executeConfirmed = async () => {
    setShowConfirm(false);
    setTyped("");
    setRunning(true);
    try {
      await onRun();
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 0",
          borderBottom: "1px solid rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{description}</span>
          {disabled && disabledNote && (
            <span style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic", marginTop: 2 }}>
              {disabledNote}
            </span>
          )}
        </div>
        <button
          type="button"
          className={variant === "danger" ? s.btnDanger : s.btnSecondary}
          onClick={handle}
          disabled={running || disabled}
          title={disabled && disabledNote ? disabledNote : undefined}
          style={disabled ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
        >
          {running ? t("settingsStorage.running") : disabled ? t("settingsStorage.comingSoon") : buttonLabel}
        </button>
      </div>

      {showConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            display: "grid",
            placeItems: "center",
            background: "rgba(0,0,0,0.4)",
            backdropFilter: "blur(4px)",
          }}
          onClick={() => setShowConfirm(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              background: "var(--bg)",
              borderRadius: 16,
              padding: "28px 24px 22px",
              boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 700 }}>
                {t("settingsStorage.confirmTitle")}
              </span>
              <span style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
                {t("settingsStorage.confirmBody1")} <strong>{t("settingsStorage.confirmBodyStrong")}</strong> {t("settingsStorage.confirmBody2")}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>
                {t("settingsStorage.typeLabel")} <span style={{ fontFamily: "monospace", color: "var(--fg)", fontWeight: 800, fontSize: 14 }}>{confirmWord}</span> {t("settingsStorage.toConfirmLabel")}
              </label>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmWord}
                autoFocus
                style={{
                  padding: "10px 12px",
                  border: "1px solid var(--line-soft)",
                  borderRadius: "var(--radius-md)",
                  fontSize: 14,
                  fontFamily: "monospace",
                  background: "var(--bg)",
                  color: "var(--fg)",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  border: "1px solid var(--line-soft)",
                  background: "var(--bg)",
                  color: "var(--fg)",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={typed !== confirmWord}
                onClick={executeConfirmed}
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: typed === confirmWord ? "#DC2626" : "rgba(220,38,38,0.3)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: typed === confirmWord ? "pointer" : "not-allowed",
                  transition: "background 150ms ease, opacity 150ms ease",
                }}
              >
                {t("settingsStorage.deleteEverything")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
