"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader,
  Card,
  settingsStyles as s,
} from "@/components/settings-ui";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import { disconnectAllChannels, deleteAccount } from "@/lib/danger-api";
import { setAuthToken, setOrgId } from "@/lib/api";

export default function SecuritySettingsPage() {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("security.title")}
        subtitle={canManage ? t("security.subtitleFull") : t("security.subtitle")}
      />
      <PasswordCard />
      {canManage && <DangerZone />}
    </>
  );
}

function PasswordCard() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async () => {
    setMsg(null);
    setErr(null);
    if (next !== confirm) {
      setErr(t("security.noMatch"));
      return;
    }
    if (next.length < 3) {
      setErr(t("security.minLength"));
      return;
    }
    setSaving(true);
    try {
      const { changePassword } = await import("@/lib/password-api");
      await changePassword(current, next);
      setMsg(t("security.passwordChanged"));
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t("security.passwordTitle")} subtitle={t("security.passwordSubtitle")}>
      <div className={s.fieldGrid}>
        <div className={s.field}>
          <label className={s.label} htmlFor="pwd-current">
            {t("security.currentPassword")}
          </label>
          <input
            id="pwd-current"
            type="password"
            className={s.input}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pwd-new">
            {t("security.newPassword")}
          </label>
          <input
            id="pwd-new"
            type="password"
            className={s.input}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={3}
          />
        </div>
        <div className={s.field}>
          <label className={s.label} htmlFor="pwd-confirm">
            {t("security.confirmPassword")}
          </label>
          <input
            id="pwd-confirm"
            type="password"
            className={s.input}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            minLength={3}
          />
        </div>
      </div>
      {err && (
        <div style={{ marginTop: 8, fontSize: 13, color: "#c0392b" }}>
          {err}
        </div>
      )}
      {msg && (
        <div style={{ marginTop: 8, fontSize: 13, color: "#27ae60" }}>
          {msg}
        </div>
      )}
      <div className={s.cardActions}>
        <button
          type="button"
          className={s.btnPrimary}
          onClick={onSubmit}
          disabled={saving}
        >
          {saving ? t("security.changing") : t("security.changePassword")}
        </button>
      </div>
    </Card>
  );
}

type DangerAction = "channels" | "account" | null;

function DangerZone() {
  const t = useT();
  const router = useRouter();
  const [action, setAction] = useState<DangerAction>(null);

  return (
    <>
      <section
        style={{
          borderRadius: "var(--radius-lg)",
          border: "1px solid rgba(220, 38, 38, 0.3)",
          background: "rgba(220, 38, 38, 0.02)",
          padding: "22px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: "#dc2626" }}>
          {t("security.dangerZone")}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 8 }}>
          {t("security.dangerSubtitle")}
        </div>

        <DangerRow
          title={t("security.disconnectTitle")}
          description={t("security.disconnectDesc")}
          buttonLabel={t("security.disconnectBtn")}
          onClick={() => setAction("channels")}
        />
        <div style={{ height: 1, background: "rgba(220,38,38,0.15)", margin: "4px 0" }} />
        <DangerRow
          title={t("security.deleteTitle")}
          description={t("security.deleteDesc")}
          buttonLabel={t("security.deleteBtn")}
          onClick={() => setAction("account")}
        />
      </section>

      {action === "channels" && (
        <DangerModal
          title={t("security.disconnectConfirmTitle")}
          body={t("security.disconnectConfirmBody")}
          confirmWord="DISCONNECT"
          confirmLabel={t("security.disconnectBtn")}
          onClose={() => setAction(null)}
          onConfirm={async () => {
            await disconnectAllChannels();
            setAction(null);
            window.location.reload();
          }}
        />
      )}

      {action === "account" && (
        <DangerModal
          title={t("security.deleteConfirmTitle")}
          body={t("security.deleteConfirmBody")}
          confirmWord="DELETE"
          confirmLabel={t("security.deleteBtn")}
          onClose={() => setAction(null)}
          onConfirm={async () => {
            await deleteAccount();
            setAuthToken(null);
            setOrgId(null);
            router.replace("/login");
          }}
        />
      )}
    </>
  );
}

function DangerRow({
  title,
  description,
  buttonLabel,
  onClick,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "10px 0",
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{description}</span>
      </div>
      <button
        type="button"
        onClick={onClick}
        style={{
          height: 36,
          padding: "0 16px",
          borderRadius: "var(--radius-pill)",
          border: "1px solid rgba(220, 38, 38, 0.4)",
          background: "var(--bg)",
          color: "#dc2626",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "background 140ms var(--ease), color 140ms var(--ease)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "#dc2626";
          e.currentTarget.style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--bg)";
          e.currentTarget.style.color = "#dc2626";
        }}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function DangerModal({
  title,
  body,
  confirmWord,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmWord: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ready = typed.trim().toUpperCase() === confirmWord;

  const run = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(4px)",
        padding: 16,
      }}
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--bg)",
          borderRadius: 16,
          padding: "26px 24px 22px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: "#dc2626" }}>
            {title}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
            {body}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>
            {t("security.typeToConfirm", { word: confirmWord })}
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--line-soft)",
              fontSize: 14,
              background: "var(--bg)",
              color: "var(--fg)",
            }}
          />
        </div>

        {err && (
          <div style={{ fontSize: 13, color: "#c0392b" }}>{err}</div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "1px solid var(--line-soft)",
              background: "var(--bg)",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={run}
            disabled={!ready || busy}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              background: ready ? "#dc2626" : "rgba(220,38,38,0.4)",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: ready && !busy ? "pointer" : "not-allowed",
            }}
          >
            {busy ? t("common.working") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
