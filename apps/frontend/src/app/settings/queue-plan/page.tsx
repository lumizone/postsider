"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card, settingsStyles as s } from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { listChannels } from "@/lib/integrations";
import type { Channel } from "@/lib/calendar-data";
import {
  QueueSlot,
  getQueuePlan,
  saveQueuePlan,
  minutesToHHMM,
  hhmmToMinutes,
} from "@/lib/queue-plan-api";

function dayChip(active: boolean): React.CSSProperties {
  return {
    width: 34,
    height: 28,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    border: `1px solid ${active ? "var(--fg)" : "var(--line-soft)"}`,
    background: active ? "var(--fg)" : "var(--bg)",
    color: active ? "var(--bg)" : "var(--muted)",
  };
}

export default function QueuePlanPage() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  // Localized weekday labels, index 0 = Sunday (matches the slot day numbers).
  const dayLabels = useMemo(() => {
    const narrow = new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" });
    const long = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
    return Array.from({ length: 7 }, (_, d) => {
      const date = new Date(Date.UTC(2023, 0, 1 + d)); // 2023-01-01 is a Sunday
      return { narrow: narrow.format(date), long: long.format(date) };
    });
  }, [locale]);

  const [channels, setChannels] = useState<Channel[]>([]);
  const [plans, setPlans] = useState<Record<string, QueueSlot[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { channels } = await listChannels();
        setChannels(channels);
        const entries = await Promise.all(
          channels.map(async (c) => {
            try {
              const { slots } = await getQueuePlan(c.id);
              return [c.id, Array.isArray(slots) ? slots : []] as const;
            } catch {
              return [c.id, []] as const;
            }
          })
        );
        setPlans(Object.fromEntries(entries));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("settingsQueuePlan.loadError"));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (id: string, slots: QueueSlot[]) =>
    setPlans((p) => ({ ...p, [id]: slots }));

  const addSlot = (id: string) =>
    update(id, [...(plans[id] || []), { time: 540, days: [1, 2, 3, 4, 5] }]);

  const removeSlot = (id: string, i: number) =>
    update(id, (plans[id] || []).filter((_, idx) => idx !== i));

  const setTime = (id: string, i: number, hhmm: string) =>
    update(
      id,
      (plans[id] || []).map((s, idx) =>
        idx === i ? { ...s, time: hhmmToMinutes(hhmm) } : s
      )
    );

  const toggleDay = (id: string, i: number, day: number) =>
    update(
      id,
      (plans[id] || []).map((s, idx) => {
        if (idx !== i) return s;
        const days = s.days && s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
        const next = days.includes(day)
          ? days.filter((d) => d !== day)
          : [...days, day].sort((a, b) => a - b);
        return { ...s, days: next };
      })
    );

  const save = async (id: string) => {
    setSavingId(id);
    setError(null);
    try {
      await saveQueuePlan(id, plans[id] || []);
      setSavedId(id);
      setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("settingsQueuePlan.saveError"));
    } finally {
      setSavingId(null);
    }
  };

  if (!canManage) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.queuePlan")}
        subtitle={t("settingsQueuePlan.noPermission")}
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.queuePlan")}
        subtitle={t("settingsQueuePlan.subtitle")}
      />
      {error && (
        <div role="alert" style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>{error}</div>
      )}
      {loading ? (
        <Card title="">
          <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading")}</div>
        </Card>
      ) : channels.length === 0 ? (
        <Card title="">
          <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>{t("settingsQueuePlan.noChannels")}</div>
        </Card>
      ) : (
        channels.map((c) => {
          const slots = plans[c.id] || [];
          return (
            <Card key={c.id} title={c.name}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {slots.length === 0 && (
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("settingsQueuePlan.noSlots")}</div>
                )}
                {slots.map((slot, i) => {
                  const active = slot.days && slot.days.length ? slot.days : [0, 1, 2, 3, 4, 5, 6];
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <input type="time" className={s.input} style={{ width: 120 }} value={minutesToHHMM(slot.time)} onChange={(e) => setTime(c.id, i, e.target.value)} />
                      <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>UTC</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {dayLabels.map((lbl, d) => (
                          <button
                            key={d}
                            type="button"
                            style={dayChip(active.includes(d))}
                            title={lbl.long}
                            aria-label={lbl.long}
                            aria-pressed={active.includes(d)}
                            onClick={() => toggleDay(c.id, i, d)}
                          >
                            {lbl.narrow}
                          </button>
                        ))}
                      </div>
                      <button type="button" className={s.btnDanger} onClick={() => removeSlot(c.id, i)}>{t("common.remove")}</button>
                    </div>
                  );
                })}
                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <button type="button" className={s.btnGhost} onClick={() => addSlot(c.id)}>{t("settingsQueuePlan.addSlot")}</button>
                  <button type="button" className={s.btnPrimary} onClick={() => save(c.id)} disabled={savingId === c.id}>
                    {savingId === c.id ? t("settingsQueuePlan.saving") : savedId === c.id ? t("settingsQueuePlan.saved") : t("common.save")}
                  </button>
                </div>
              </div>
            </Card>
          );
        })
      )}
    </>
  );
}
