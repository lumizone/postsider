"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  PageHeader,
  Card,
  settingsStyles as s,
} from "@/components/settings-ui";
import {
  getOrganizationProfile,
  updateOrganizationProfile,
  type OrganizationProfile,
} from "@/lib/organization-api";
import { uploadMedia, backendMediaToUrl } from "@/lib/media-api";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";

// Falls back to a short list on runtimes without Intl.supportedValuesOf
// (older browsers) rather than hand-maintaining every IANA zone — mirrors
// the same fallback in settings/queue-plan.
const FALLBACK_ZONES = [
  "UTC", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "Europe/London", "Europe/Paris", "Europe/Warsaw",
  "Europe/Berlin", "Asia/Tokyo", "Asia/Singapore", "Asia/Kolkata",
  "Australia/Sydney",
];

export default function OrganizationSettingsPage() {
  const t = useT();
  const { user, refresh } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const zoneOptions = useMemo<string[]>(() => {
    try {
      const zones = (Intl as any).supportedValuesOf?.("timeZone") ?? [];
      return zones.length ? zones : FALLBACK_ZONES;
    } catch {
      return FALLBACK_ZONES;
    }
  }, []);

  const [profile, setProfile] = useState<OrganizationProfile | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    getOrganizationProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t("settingsOrganization.loadError"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canManage]);

  if (!canManage) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsOrganization.title")}
        subtitle={t("settingsOrganization.noPermission")}
      />
    );
  }

  const save = async (patch: Partial<OrganizationProfile> = {}) => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const next = { ...profile, ...patch };
      const saved = await updateOrganizationProfile(next);
      setProfile(saved);
      setSavedAt(Date.now());
      // The sidebar brand mark reads orgLogo off the cached /user/self
      // payload (auth-context), not this page's own state — without this,
      // uploading a new logo saved fine but never appeared in the sidebar
      // until the next full page load / login.
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settingsOrganization.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const onPickLogo = () => fileInputRef.current?.click();

  const onLogoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !profile) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadMedia(file);
      const url = backendMediaToUrl(uploaded);
      await save({ logo: url });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settingsOrganization.uploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsOrganization.title")}
        subtitle={t("settingsOrganization.subtitle")}
      />

      {error && (
        <div
          role="alert"
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

      <Card title={t("settingsOrganization.profileCard")}>
        {profile == null ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("common.loading")}</div>
        ) : (
          <>
            <div className={s.field} style={{ marginBottom: 16 }}>
              <label className={s.label}>{t("settingsOrganization.logo")}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 12,
                    border: "1px solid var(--line-soft)",
                    background: "var(--bg)",
                    display: "grid",
                    placeItems: "center",
                    overflow: "hidden",
                    flexShrink: 0,
                  }}
                >
                  {profile.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.logo}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      {profile.name?.[0]?.toUpperCase() ?? "?"}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className={s.btnSecondary}
                      onClick={onPickLogo}
                      disabled={uploading}
                    >
                      {uploading ? t("settingsOrganization.uploading") : t("settingsOrganization.uploadLogo")}
                    </button>
                    {profile.logo && (
                      <button
                        type="button"
                        className={s.btnSecondary}
                        onClick={() => void save({ logo: null })}
                        disabled={uploading || saving}
                      >
                        {t("settingsOrganization.removeLogo")}
                      </button>
                    )}
                  </div>
                  <span className={s.hint}>{t("settingsOrganization.logoHint")}</span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={onLogoSelected}
                  style={{ display: "none" }}
                />
              </div>
            </div>

            <div className={s.fieldGrid}>
              <div className={s.field}>
                <label className={s.label} htmlFor="org-name">
                  {t("settingsOrganization.orgName")}
                </label>
                <input
                  id="org-name"
                  value={profile.name}
                  onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                  className={s.input}
                />
              </div>
            </div>
            <div className={s.field} style={{ marginTop: 12 }}>
              <label className={s.label} htmlFor="org-desc">
                {t("settingsOrganization.orgDescription")}
              </label>
              <textarea
                id="org-desc"
                value={profile.description}
                onChange={(e) => setProfile({ ...profile, description: e.target.value })}
                className={s.input}
                rows={3}
              />
              <span className={s.hint}>{t("settingsOrganization.orgDescriptionHint")}</span>
            </div>

            <div className={s.cardActions}>
              {savedAt && (
                <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>
                  {t("settingsOrganization.saved")}
                </span>
              )}
              <button
                type="button"
                className={s.btnPrimary}
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? t("settingsOrganization.saving") : t("settingsOrganization.save")}
              </button>
            </div>
          </>
        )}
      </Card>

      {profile && (
        <Card
          title={t("settingsOrganization.brandCard")}
          subtitle={t("settingsOrganization.brandSubtitle")}
        >
          <div className={s.field}>
            <label className={s.label} htmlFor="brand-voice">{t("settingsOrganization.brandVoice")}</label>
            <textarea id="brand-voice" className={s.input} rows={3} value={profile.brandVoice ?? ""} onChange={(e) => setProfile({ ...profile, brandVoice: e.target.value })} placeholder={t("settingsOrganization.brandVoicePlaceholder")} />
            <span className={s.hint}>{t("settingsOrganization.brandVoiceHint")}</span>
          </div>
          <div className={s.field} style={{ marginTop: 12 }}>
            <label className={s.label} htmlFor="brand-audience">{t("settingsOrganization.brandAudience")}</label>
            <textarea id="brand-audience" className={s.input} rows={2} value={profile.brandAudience ?? ""} onChange={(e) => setProfile({ ...profile, brandAudience: e.target.value })} placeholder={t("settingsOrganization.brandAudiencePlaceholder")} />
          </div>
          <div className={s.field} style={{ marginTop: 12 }}>
            <label className={s.label} htmlFor="brand-rules">{t("settingsOrganization.brandRules")}</label>
            <textarea id="brand-rules" className={s.input} rows={3} value={profile.brandRules ?? ""} onChange={(e) => setProfile({ ...profile, brandRules: e.target.value })} placeholder={t("settingsOrganization.brandRulesPlaceholder")} />
          </div>
          <div className={s.field} style={{ marginTop: 12 }}>
            <label className={s.label} htmlFor="brand-forbidden">{t("settingsOrganization.brandForbiddenWords")}</label>
            <input id="brand-forbidden" className={s.input} value={profile.brandForbiddenWords ?? ""} onChange={(e) => setProfile({ ...profile, brandForbiddenWords: e.target.value })} placeholder={t("settingsOrganization.brandForbiddenWordsPlaceholder")} />
          </div>
          <div className={s.cardActions}>
            <button type="button" className={s.btnPrimary} onClick={() => void save()} disabled={saving}>
              {saving ? t("settingsOrganization.saving") : t("settingsOrganization.save")}
            </button>
          </div>
        </Card>
      )}

      {profile && (
        <Card
          title={t("settingsOrganization.defaultsCard")}
        >
          <div className={s.field}>
            <label className={s.label} htmlFor="org-tz">
              {t("settingsOrganization.defaultTimezone")}
            </label>
            <select
              id="org-tz"
              value={profile.defaultTimezone ?? ""}
              onChange={(e) => void save({ defaultTimezone: e.target.value || null })}
              className={s.select}
            >
              <option value="">{t("settingsOrganization.noDefaultTimezone")}</option>
              {zoneOptions.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <span className={s.hint}>{t("settingsOrganization.defaultTimezoneHint")}</span>
          </div>

          <div className={s.field} style={{ marginTop: 18 }}>
            <label
              style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={!!profile.agencyMode}
                onChange={(e) => void save({ agencyMode: e.target.checked })}
                style={{ accentColor: "var(--fg)" }}
              />
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {t("settingsOrganization.agencyMode")}
              </span>
            </label>
            <span className={s.hint}>{t("settingsOrganization.agencyModeHint")}</span>
          </div>
        </Card>
      )}

      <div style={{ fontSize: 12, color: "var(--muted)", padding: "4px 2px" }}>
        {t("settingsOrganization.dangerHint")}{" "}
        <Link href="/settings/security" style={{ color: "var(--fg)", fontWeight: 600 }}>
          {t("settingsOrganization.dangerLinkLabel")}
        </Link>
        .
      </div>
    </>
  );
}
