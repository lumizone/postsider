"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  PageHeader,
  Card,
  Avatar,
  StatusChip,
  settingsStyles as s,
} from "@/components/settings-ui";
import {
  getTeam,
  inviteMember,
  removeMember,
  changeRole,
  type TeamMember,
} from "@/lib/team-api";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";

type InviteRole = "USER" | "ADMIN";

export default function UsersSettingsPage() {
  const t = useT();

  const roleLabel = (role: TeamMember["role"]) =>
    role === "SUPERADMIN"
      ? t("settingsUsers.roleOwner")
      : role === "ADMIN"
        ? t("settingsUsers.roleAdmin")
        : t("settingsUsers.roleMember");

  const { user } = useAuth();
  const isOwner = user?.role === "SUPERADMIN";
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("USER");
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    password: string | null;
    message: string;
    role: InviteRole;
  } | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTeam();
      setMembers(res?.users ?? []);
    } catch (err) {
      // Show a friendly plan/permission message rather than a raw "HTTP 402".
      const { planLimitMessage } = await import("@/lib/plan-errors");
      setError(planLimitMessage(err, "Could not load team"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onInvite = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inviteEmail || inviting) return;
    setInviting(true);
    setError(null);
    setInviteResult(null);
    try {
      const res = await inviteMember({
        email: inviteEmail,
        role: inviteRole,
        sendEmail: false,
      });
      // Snapshot the role used for THIS invite — the PDF must not read the live
      // select value, which the admin can change before downloading.
      setInviteResult({ ...res, role: inviteRole });
      setInviteEmail("");
      void refresh();
    } catch (err) {
      const { planLimitMessage } = await import("@/lib/plan-errors");
      setError(planLimitMessage(err, "Invite failed"));
    } finally {
      setInviting(false);
    }
  };

  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const onRemove = async (id: string) => {
    if (!canManage) return;
    setRemoveBusy(true);
    try {
      await removeMember(id);
      setMembers((prev) => prev.filter((m) => m.user.id !== id));
      setRemoveTarget(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove");
      setRemoveTarget(null);
    } finally {
      setRemoveBusy(false);
    }
  };

  const onChangeRole = async (
    userId: string,
    newRole: "USER" | "ADMIN",
  ) => {
    try {
      await changeRole(userId, newRole);
      setMembers((prev) =>
        prev.map((m) =>
          m.user.id === userId ? { ...m, role: newRole } : m,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change role");
    }
  };

  const onDownloadPdf = () => {
    if (!inviteResult?.password) return;
    import("@/lib/generate-credentials-pdf").then(({ downloadCredentialsPdf }) => {
      downloadCredentialsPdf({
        email: inviteResult.email,
        password: inviteResult.password!,
        role:
          inviteResult.role === "ADMIN"
            ? t("settingsUsers.roleAdmin")
            : t("settingsUsers.roleMember"),
        platformUrl:
          typeof window !== "undefined"
            ? window.location.origin
            : "http://localhost:4200",
      });
    });
  };

  // Members (USER role) shouldn't see this page at all — but if they
  // navigate here directly, show a friendly message instead of nothing.
  if (!canManage) {
    return (
      <>
        <PageHeader
          eyebrow={t("settings.eyebrow")}
          title={t("settingsUsers.title")}
          subtitle={t("settingsUsers.noPermission")}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("settingsUsers.title")}
        subtitle={t("settingsUsers.subtitle")}
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

      <Card title={t("settingsUsers.inviteTitle")}>
        <form onSubmit={onInvite}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              alignItems: "end",
            }}
          >
            <div className={s.field} style={{ flex: "1 1 220px", minWidth: 0 }}>
              <label className={s.label} htmlFor="invite-email">
                {t("settingsUsers.inviteEmail")}
              </label>
              <input
                id="invite-email"
                type="email"
                placeholder={t("settingsUsers.emailPlaceholder")}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className={s.input}
                required
              />
            </div>
            <div className={s.field} style={{ flex: "0 1 140px" }}>
              <label className={s.label} htmlFor="invite-role">
                {t("settingsUsers.inviteRole")}
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as InviteRole)}
                className={s.select}
              >
                <option value="USER">{t("settingsUsers.roleMember")}</option>
                {isOwner && <option value="ADMIN">{t("settingsUsers.roleAdmin")}</option>}
              </select>
            </div>
            <button
              type="submit"
              className={s.btnPrimary}
              disabled={inviting}
            >
              {inviting ? t("settingsUsers.inviting") : t("settingsUsers.inviteBtn")}
            </button>
          </div>
        </form>

        {inviteResult && (
          <div
            style={{
              marginTop: 16,
              padding: 18,
              border: "1px solid var(--line-soft)",
              borderRadius: "var(--radius-md)",
              background: "rgba(0,0,0,0.02)",
              fontSize: 13,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              {inviteResult.message}
            </span>
            {inviteResult.password ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "90px 1fr",
                    gap: "6px 14px",
                    fontFamily: "monospace",
                    fontSize: 13,
                    padding: "12px 14px",
                    background: "#fff",
                    border: "1px solid var(--line-soft)",
                    borderRadius: "var(--radius-md)",
                  }}
                >
                  <span style={{ color: "var(--muted)", fontFamily: "inherit" }}>{t("settingsUsers.credEmail")}</span>
                  <span>{inviteResult.email}</span>
                  <span style={{ color: "var(--muted)", fontFamily: "inherit" }}>{t("settingsUsers.credPassword")}</span>
                  <span style={{ fontWeight: 700, letterSpacing: "0.5px" }}>
                    {inviteResult.password}
                  </span>
                </div>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>
                  {t("settingsUsers.credNote")}
                </span>
                <button
                  type="button"
                  onClick={onDownloadPdf}
                  className={s.btnPrimary}
                  style={{ alignSelf: "flex-start" }}
                >
                  {"↓ "}
                  {t("settingsUsers.downloadCard")}
                </button>
              </>
            ) : (
              <span style={{ color: "var(--muted)" }}>
                {t("settingsUsers.existingUserNote")}
              </span>
            )}
          </div>
        )}
      </Card>

      <Card
        title={t("settingsUsers.membersTitle")}
        subtitle={loading ? t("common.loading") : t("settingsUsers.peopleCount", { count: members.length })}
      >
        {loading ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>{t("common.loading")}</div>
        ) : members.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted)" }}>
            {t("settingsUsers.noUsers")}
          </div>
        ) : (
          members.map((m) => {
            const isYou = m.user.id === user?.id;
            const isMemberOwner = m.role === "SUPERADMIN";
            const displayName = m.user.email.split("@")[0];
            return (
              <div key={m.user.id} className={s.memberRow}>
                <Avatar name={displayName} />
                <div className={s.memberMain}>
                  <span className={s.memberName}>
                    {displayName}
                    {isYou && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          color: "var(--muted)",
                          fontWeight: 500,
                        }}
                      >
                        {t("settingsUsers.youChip")}
                      </span>
                    )}
                  </span>
                  <span className={s.memberMeta}>{m.user.email}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    minWidth: 0,
                  }}
                >
                  {isMemberOwner ? (
                    <StatusChip variant="filled">{t("settingsUsers.roleOwner")}</StatusChip>
                  ) : isOwner && !isYou ? (
                    <select
                      value={m.role}
                      onChange={(e) =>
                        void onChangeRole(
                          m.user.id,
                          e.target.value as "USER" | "ADMIN",
                        )
                      }
                      className={s.select}
                      // No inline font-size: it beat the phone rule that keeps
                      // fields at 16px, and iOS zoomed the page on focus.
                      style={{ width: 130 }}
                    >
                      <option value="USER">{t("settingsUsers.roleMember")}</option>
                      <option value="ADMIN">{t("settingsUsers.roleAdmin")}</option>
                    </select>
                  ) : (
                    <StatusChip variant="muted">
                      {roleLabel(m.role)}
                    </StatusChip>
                  )}
                </div>
                <div className={s.memberActions}>
                  <button
                    type="button"
                    className={s.btnDanger}
                    onClick={() =>
                      setRemoveTarget({
                        id: m.user.id,
                        name: m.user.email || t("settingsUsers.thisMember"),
                      })
                    }
                    disabled={!canManage || isMemberOwner || isYou}
                    title={
                      isMemberOwner
                        ? t("settingsUsers.ownerLocked")
                        : isYou
                          ? t("settingsUsers.cannotRemoveSelf")
                          : t("settingsUsers.removeFromOrg")
                    }
                  >
                    {t("common.remove")}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </Card>

      <Card title={t("settingsUsers.rolesTitle")} subtitle={t("settingsUsers.rolesSubtitle")}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "100px 1fr",
            rowGap: 12,
            columnGap: 16,
            fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 600 }}>{t("settingsUsers.roleOwner")}</span>
          <span style={{ color: "var(--muted)" }}>
            {t("settingsUsers.roleOwnerDesc")}
          </span>
          <span style={{ fontWeight: 600 }}>{t("settingsUsers.roleAdmin")}</span>
          <span style={{ color: "var(--muted)" }}>
            {t("settingsUsers.roleAdminDesc")}
          </span>
          <span style={{ fontWeight: 600 }}>{t("settingsUsers.roleMember")}</span>
          <span style={{ color: "var(--muted)" }}>
            {t("settingsUsers.roleMemberDesc")}
          </span>
        </div>
      </Card>

      {removeTarget && (
        <ConfirmDialog
          danger
          busy={removeBusy}
          title={t("settingsUsers.removeConfirmTitle")}
          body={t("settingsUsers.removeConfirmBody", { name: removeTarget.name })}
          confirmLabel={t("settingsUsers.removeBtn")}
          onConfirm={() => void onRemove(removeTarget.id)}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </>
  );
}
