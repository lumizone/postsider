"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader, Card, settingsStyles as s } from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n";
import { InfoTip } from "@/components/info-tip";
import { listChannels } from "@/lib/integrations";
import type { Channel } from "@/lib/calendar-data";
import {
  QueueSlot,
  getQueuePlan,
  saveQueuePlan,
  minutesToHHMM,
  hhmmToMinutes,
} from "@/lib/queue-plan-api";
import { getTeam, type TeamMember } from "@/lib/team-api";
import {
  getChannelAssignments,
  setChannelAssignments,
} from "@/lib/channel-assignment-api";

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
  const [timezones, setTimezones] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [failedPlanIds, setFailedPlanIds] = useState<Set<string>>(new Set());
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Falls back to a short list on runtimes without Intl.supportedValuesOf
  // (older browsers) rather than hand-maintaining every IANA zone.
  const zoneOptions = useMemo<string[]>(() => {
    try {
      return (Intl as any).supportedValuesOf?.("timeZone") ?? [];
    } catch {
      return [];
    }
  }, []);
  const FALLBACK_ZONES = [
    "UTC", "America/New_York", "America/Chicago", "America/Denver",
    "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Warsaw",
    "Europe/Berlin", "Asia/Tokyo", "Asia/Singapore", "Asia/Kolkata",
    "Australia/Sydney",
  ];

  useEffect(() => {
    (async () => {
      try {
        const { channels } = await listChannels();
        setChannels(channels);
        const planResults = await Promise.all(
          channels.map(async (c) => {
            try {
              const { slots, timezone } = await getQueuePlan(c.id);
              return {
                id: c.id,
                slots: Array.isArray(slots) ? slots : ([] as QueueSlot[]),
                timezone: timezone || "UTC",
                failed: false,
              };
            } catch {
              return { id: c.id, slots: [] as QueueSlot[], timezone: "UTC", failed: true };
            }
          })
        );
        const failedPlans = planResults.filter((entry) => entry.failed);
        if (failedPlans.length > 0) {
          setError(t("settingsQueuePlan.loadError"));
        }
        const nextPlans: Record<string, QueueSlot[]> = {};
        const nextTimezones: Record<string, string> = {};
        const failedIds = new Set<string>();
        for (const e of planResults) {
          if (e.failed) {
            failedIds.add(e.id);
            continue;
          }
          nextPlans[e.id] = e.slots;
          nextTimezones[e.id] = e.timezone;
        }
        setPlans(nextPlans);
        setTimezones(nextTimezones);
        setFailedPlanIds(failedIds);

        const [{ users: members }, assignmentEntries] = await Promise.all([
          getTeam().catch(() => ({ users: [] as TeamMember[] })),
          Promise.all(
            channels.map(async (c) => {
              try {
                const { users } = await getChannelAssignments(c.id);
                return { id: c.id, userIds: users.map((u) => u.id) };
              } catch {
                return { id: c.id, userIds: [] as string[] };
              }
            })
          ),
        ]);
        setTeam(members);
        const nextAssignments: Record<string, string[]> = {};
        for (const a of assignmentEntries) nextAssignments[a.id] = a.userIds;
        setAssignments(nextAssignments);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("settingsQueuePlan.loadError"));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAttempt, t]);

  const toggleAssignment = (channelId: string, userId: string) =>
    setAssignments((prev) => {
      const current = prev[channelId] || [];
      const next = current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId];
      return { ...prev, [channelId]: next };
    });

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
        // An explicit [] is "no days", NOT "all days" — `s.days && s.days.length`
        // fell back to the full week for an explicitly empty array, so
        // deselecting the last day silently re-activated every day.
        const days = Array.isArray(s.days) ? s.days : [0, 1, 2, 3, 4, 5, 6];
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
      await Promise.all([
        saveQueuePlan(id, plans[id] || [], timezones[id]),
        setChannelAssignments(id, assignments[id] || []),
      ]);
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
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontWeight: 600, textDecoration: "underline" }}>
            {t("calendar.retry")}
          </button>
        </div>
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
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
                  {t("settingsQueuePlan.timezone")}
                  <select
                    className={s.input}
                    value={timezones[c.id] || "UTC"}
                    onChange={(e) => setTimezones((tz) => ({ ...tz, [c.id]: e.target.value }))}
                  >
                    {(zoneOptions.length > 0 ? zoneOptions : FALLBACK_ZONES).map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                </label>
                {slots.length === 0 && (
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("settingsQueuePlan.noSlots")}</div>
                )}
                {slots.map((slot, i) => {
                  const active = Array.isArray(slot.days) ? slot.days : [0, 1, 2, 3, 4, 5, 6];
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <input type="time" className={s.input} style={{ width: 120 }} value={minutesToHHMM(slot.time)} onChange={(e) => setTime(c.id, i, e.target.value)} />
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
                {team.length > 0 && (
                  <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 10, marginTop: 4 }}>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                      {t("settingsQueuePlan.assignedTo")}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {team.map((m) => (
                        <label key={m.user.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={(assignments[c.id] || []).includes(m.user.id)}
                            onChange={() => toggleAssignment(c.id, m.user.id)}
                          />
                          {m.user.email}
                        </label>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
                      {(assignments[c.id] || []).length === 0
                        ? t("settingsQueuePlan.assignedNone")
                        : t("settingsQueuePlan.assignedSome")}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                  <button type="button" className={s.btnGhost} onClick={() => addSlot(c.id)}>{t("settingsQueuePlan.addSlot")}</button>
                  <InfoTip textKey="infoTip.slot" />
                   <button type="button" className={s.btnPrimary} onClick={() => save(c.id)} disabled={savingId === c.id || failedPlanIds.has(c.id)}>
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
