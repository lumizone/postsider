"use client";

import { useEffect, useState } from "react";
import {
  PageHeader,
  Card,
  ToggleRow,
  settingsStyles as s,
} from "@/components/settings-ui";
import {
  getEmailNotifications,
  getPersonal,
  updateEmailNotifications,
  updatePersonal,
  type EmailNotifications,
  type UserPersonal,
} from "@/lib/user-api";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";

const TIMEZONES: { offset: number; label: string }[] = [
  { offset: -720, label: "(UTC-12:00) Baker Island" },
  { offset: -660, label: "(UTC-11:00) Pago Pago" },
  { offset: -600, label: "(UTC-10:00) Honolulu" },
  { offset: -570, label: "(UTC-09:30) Marquesas" },
  { offset: -540, label: "(UTC-09:00) Anchorage" },
  { offset: -480, label: "(UTC-08:00) Los Angeles, Vancouver" },
  { offset: -420, label: "(UTC-07:00) Denver, Phoenix" },
  { offset: -360, label: "(UTC-06:00) Chicago, Mexico City" },
  { offset: -300, label: "(UTC-05:00) New York, Toronto, Bogotá" },
  { offset: -240, label: "(UTC-04:00) Santiago, Halifax" },
  { offset: -210, label: "(UTC-03:30) St. John's" },
  { offset: -180, label: "(UTC-03:00) São Paulo, Buenos Aires" },
  { offset: -120, label: "(UTC-02:00) South Georgia" },
  { offset: -60, label: "(UTC-01:00) Azores, Cape Verde" },
  { offset: 0, label: "(UTC+00:00) London, Dublin, Lisbon" },
  { offset: 60, label: "(UTC+01:00) Berlin, Paris, Warsaw, Madrid" },
  { offset: 120, label: "(UTC+02:00) Helsinki, Bucharest, Cairo" },
  { offset: 180, label: "(UTC+03:00) Moscow, Istanbul, Riyadh" },
  { offset: 210, label: "(UTC+03:30) Tehran" },
  { offset: 240, label: "(UTC+04:00) Dubai, Baku" },
  { offset: 270, label: "(UTC+04:30) Kabul" },
  { offset: 300, label: "(UTC+05:00) Karachi, Tashkent" },
  { offset: 330, label: "(UTC+05:30) Mumbai, Kolkata, Delhi" },
  { offset: 345, label: "(UTC+05:45) Kathmandu" },
  { offset: 360, label: "(UTC+06:00) Dhaka, Almaty" },
  { offset: 390, label: "(UTC+06:30) Yangon" },
  { offset: 420, label: "(UTC+07:00) Bangkok, Jakarta, Hanoi" },
  { offset: 480, label: "(UTC+08:00) Singapore, Hong Kong, Perth" },
  { offset: 525, label: "(UTC+08:45) Eucla" },
  { offset: 540, label: "(UTC+09:00) Tokyo, Seoul" },
  { offset: 570, label: "(UTC+09:30) Adelaide, Darwin" },
  { offset: 600, label: "(UTC+10:00) Sydney, Melbourne, Brisbane" },
  { offset: 630, label: "(UTC+10:30) Lord Howe Island" },
  { offset: 660, label: "(UTC+11:00) Solomon Islands, Noumea" },
  { offset: 720, label: "(UTC+12:00) Auckland, Fiji" },
  { offset: 765, label: "(UTC+12:45) Chatham Islands" },
  { offset: 780, label: "(UTC+13:00) Tonga, Samoa" },
  { offset: 840, label: "(UTC+14:00) Line Islands" },
];

export default function GeneralSettingsPage() {
  const { user, refresh } = useAuth();
  const t = useT();
  const [personal, setPersonal] = useState<UserPersonal | null>(null);
  const [emailNotifs, setEmailNotifs] = useState<EmailNotifications | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getPersonal(), getEmailNotifications()])
      .then(([p, n]) => {
        if (cancelled) return;
        setPersonal(p);
        setEmailNotifs(n);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t("settingsGeneral.loadError"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveProfile = async () => {
    if (!personal) return;
    setSaving(true);
    setError(null);
    try {
      await updatePersonal(personal);
      setSavedAt(Date.now());
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settingsGeneral.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const toggleNotif = async (key: keyof EmailNotifications) => {
    if (!emailNotifs) return;
    const next = { ...emailNotifs, [key]: !emailNotifs[key] };
    setEmailNotifs(next);
    try {
      await updateEmailNotifications(next);
    } catch (err) {
      // Revert on failure.
      setEmailNotifs(emailNotifs);
      setError(err instanceof Error ? err.message : t("settingsGeneral.saveError"));
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsGeneral.title")}
        subtitle={t("settingsGeneral.subtitleFull")}
      />

      {error && (
        <div
          style={{
            margin: "0 0 16px",
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            background: "rgba(192, 57, 43, 0.08)",
            color: "#c0392b",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <Card title={t("settingsGeneral.profile")}>
        {personal == null ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("common.loading")}</div>
        ) : (
          <>
            <div className={s.fieldGrid}>
              <div className={s.field}>
                <label className={s.label} htmlFor="user-email">
                  {t("auth.email")}
                </label>
                <input
                  id="user-email"
                  defaultValue={user?.email ?? ""}
                  disabled
                  className={s.input}
                />
                <span className={s.hint}>{t("settingsGeneral.emailHint")}</span>
              </div>
              <div className={s.field}>
                <label className={s.label} htmlFor="user-name">
                  {t("settingsGeneral.firstName")}
                </label>
                <input
                  id="user-name"
                  value={personal.name ?? ""}
                  onChange={(e) =>
                    setPersonal({ ...personal, name: e.target.value })
                  }
                  className={s.input}
                />
              </div>
              <div className={s.field}>
                <label className={s.label} htmlFor="user-last">
                  {t("settingsGeneral.lastName")}
                </label>
                <input
                  id="user-last"
                  value={personal.lastName ?? ""}
                  onChange={(e) =>
                    setPersonal({ ...personal, lastName: e.target.value })
                  }
                  className={s.input}
                />
              </div>
              <div className={s.field}>
                <label className={s.label} htmlFor="user-tz">
                  {t("settingsGeneral.timezone")}
                </label>
                <select
                  id="user-tz"
                  value={String(personal.timezone)}
                  onChange={(e) =>
                    setPersonal({
                      ...personal,
                      timezone: parseInt(e.target.value, 10),
                    })
                  }
                  className={s.select}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.offset} value={tz.offset}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className={s.field} style={{ marginTop: 12 }}>
              <label className={s.label} htmlFor="user-bio">
                {t("settingsGeneral.bio")}
              </label>
              <textarea
                id="user-bio"
                value={personal.bio ?? ""}
                onChange={(e) =>
                  setPersonal({ ...personal, bio: e.target.value })
                }
                className={s.input}
                rows={3}
              />
            </div>
            <div className={s.cardActions}>
              {savedAt && (
                <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
                  {t("settingsGeneral.savedIndicator")}
                </span>
              )}
              <button
                type="button"
                className={s.btnPrimary}
                onClick={saveProfile}
                disabled={saving}
              >
                {saving ? t("settingsGeneral.saving") : t("settingsGeneral.save")}
              </button>
            </div>
          </>
        )}
      </Card>

      <Card title={t("settingsGeneral.emailNotifs")}>
        {emailNotifs == null ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("common.loading")}</div>
        ) : (
          <>
            <ToggleRow
              title={t("settingsGeneral.notifSuccessTitle")}
              description={t("settingsGeneral.notifSuccessDesc")}
              on={emailNotifs.sendSuccessEmails}
              onChange={() => void toggleNotif("sendSuccessEmails")}
            />
            <ToggleRow
              title={t("settingsGeneral.notifFailTitle")}
              description={t("settingsGeneral.notifFailDesc")}
              on={emailNotifs.sendFailureEmails}
              onChange={() => void toggleNotif("sendFailureEmails")}
            />
            <ToggleRow
              title={t("settingsGeneral.notifStreakTitle")}
              description={t("settingsGeneral.notifStreakDesc")}
              on={emailNotifs.sendStreakEmails}
              onChange={() => void toggleNotif("sendStreakEmails")}
            />
          </>
        )}
      </Card>
    </>
  );
}
