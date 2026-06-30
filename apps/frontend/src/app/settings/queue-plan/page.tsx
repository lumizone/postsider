"use client";

import { useEffect, useState } from "react";
import { PageHeader, Card } from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import { listChannels } from "@/lib/integrations";
import type { Channel } from "@/lib/calendar-data";
import {
  QueueSlot,
  getQueuePlan,
  saveQueuePlan,
  minutesToHHMM,
  hhmmToMinutes,
} from "@/lib/queue-plan-api";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  fontSize: 13,
  background: "var(--bg)",
  color: "var(--fg)",
};
const primaryBtn: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 12,
  cursor: "pointer",
};

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
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

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
        setError(e instanceof Error ? e.message : "Could not load channels");
      } finally {
        setLoading(false);
      }
    })();
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
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSavingId(null);
    }
  };

  if (!canManage) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.queuePlan")}
        subtitle="You don't have permission to manage the queue plan."
      />
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settings.queuePlan")}
        subtitle="Set recurring posting times per channel (times are in UTC). Use Add to queue in the composer to fill the next open slot."
      />
      {error && (
        <div style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>{error}</div>
      )}
      {loading ? (
        <Card title="">
          <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>{t("common.loading")}</div>
        </Card>
      ) : channels.length === 0 ? (
        <Card title="">
          <div style={{ padding: "30px 0", textAlign: "center", color: "var(--muted)", fontSize: 14 }}>No channels connected yet.</div>
        </Card>
      ) : (
        channels.map((c) => {
          const slots = plans[c.id] || [];
          return (
            <Card key={c.id} title={c.name}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {slots.length === 0 && (
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>No slots yet. Add one to enable queuing for this channel.</div>
                )}
                {slots.map((s, i) => {
                  const active = s.days && s.days.length ? s.days : [0, 1, 2, 3, 4, 5, 6];
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <input type="time" style={inputStyle} value={minutesToHHMM(s.time)} onChange={(e) => setTime(c.id, i, e.target.value)} />
                      <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>UTC</span>
                      <div style={{ display: "flex", gap: 4 }}>
                        {DAY_LABELS.map((lbl, d) => (
                          <button key={d} type="button" style={dayChip(active.includes(d))} onClick={() => toggleDay(c.id, i, d)}>{lbl[0]}</button>
                        ))}
                      </div>
                      <button type="button" style={{ ...ghostBtn, color: "#DC2626", borderColor: "rgba(220,38,38,0.25)" }} onClick={() => removeSlot(c.id, i)}>Remove</button>
                    </div>
                  );
                })}
                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <button type="button" style={ghostBtn} onClick={() => addSlot(c.id)}>+ Add slot</button>
                  <button type="button" style={primaryBtn} onClick={() => save(c.id)} disabled={savingId === c.id}>
                    {savingId === c.id ? "Saving…" : savedId === c.id ? "Saved" : "Save"}
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
