"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, Card, settingsStyles as s } from "@/components/settings-ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { FlowForm, type FlowMemberChoice } from "@/components/approval-flows/flow-form";
import styles from "@/components/approval-flows/flow-form.module.css";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useT } from "@/lib/i18n";
import {
  archiveApprovalFlow,
  createApprovalFlow,
  listApprovalFlows,
  updateApprovalFlow,
  type ApprovalFlow,
  type ApprovalFlowBody,
} from "@/lib/approval-flows-api";
import { getTeam } from "@/lib/team-api";

export default function ApprovalFlowsSettingsPage() {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";

  const [flows, setFlows] = useState<ApprovalFlow[]>([]);
  const [members, setMembers] = useState<FlowMemberChoice[] | null>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApprovalFlow | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ApprovalFlow | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = await listApprovalFlows();
      if (!alive.current) return;
      setFlows(list);
      setForbidden(false);
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(t("approvalFlows.loadError"));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void reload();
    // Member names are a convenience for the approver lists; the page works without them.
    getTeam()
      .then((res) => {
        if (cancelled) return;
        const choices = (res.users ?? [])
          .filter((m) => m.role === "ADMIN" || m.role === "SUPERADMIN")
          .map((m) => ({ id: m.user.id, label: m.user.email }));
        setMembers(choices);
      })
      .catch(() => {
        if (!cancelled) setMembers(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const errorMessage = (err: unknown, fallback: string): string => {
    const body = err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as Record<string, unknown>) : null;
    if (body?.error === "flow_in_use") return t("approvalFlows.flowInUse");
    if (body?.error === "approval_flow_limit_reached") return t("approvalFlows.limitReached");
    return err instanceof Error && err.message ? err.message : fallback;
  };

  const onSave = async (body: ApprovalFlowBody) => {
    try {
      if (editing && editing !== "new") await updateApprovalFlow(editing.id, body);
      else await createApprovalFlow(body);
    } catch (err) {
      // Re-thrown with the friendlier text so the form shows it as plain text.
      throw new Error(errorMessage(err, t("approvalFlows.saveError")));
    }
    if (!alive.current) return;
    setEditing(null);
    await reload();
  };

  const onArchive = async () => {
    if (!archiveTarget || archiveBusy) return;
    setArchiveBusy(true);
    setError(null);
    try {
      await archiveApprovalFlow(archiveTarget.id);
      if (alive.current) setFlows((prev) => prev.filter((f) => f.id !== archiveTarget.id));
    } catch (err) {
      if (alive.current) setError(errorMessage(err, t("approvalFlows.archiveError")));
    } finally {
      if (alive.current) {
        setArchiveBusy(false);
        setArchiveTarget(null);
      }
    }
  };

  if (!canManage || forbidden) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("approvalFlows.title")}
        subtitle={canManage ? t("approvalFlows.forbidden") : t("approvalFlows.noPermission")}
      />
    );
  }

  return (
    <>
      <PageHeader eyebrow={t("settings.eyebrow")} title={t("approvalFlows.title")} subtitle={t("approvalFlows.subtitle")} />

      {error && (
        <div role="alert" className={styles.banner} style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <Card
        title={t("approvalFlows.listTitle")}
        subtitle={loading ? t("common.loading") : t("approvalFlows.count", { count: flows.length })}
        actions={
          <button type="button" className={s.btnPrimary} onClick={() => setEditing("new")}>
            {t("approvalFlows.addFlow")}
          </button>
        }
      >
        {loading ? (
          <div className={styles.empty}>{t("common.loading")}</div>
        ) : flows.length === 0 ? (
          <EmptyState title={t("approvalFlows.empty.title")} description={t("approvalFlows.empty.description")} />
        ) : (
          <ul className={styles.list}>
            {flows.map((flow) => {
              const stages = [...flow.stages].sort((a, b) => a.position - b.position);
              return (
                <li key={flow.id} className={styles.row}>
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.name}>{flow.name}</div>
                    <div className={styles.meta}>
                      {flow.isDefault && <span className={styles.chip + " " + styles.chipFilled}>{t("approvalFlows.defaultMarker")}</span>}
                      <span>
                        {stages.length === 1
                          ? t("approvalFlows.stageCountOne")
                          : t("approvalFlows.stageCount", { count: stages.length })}
                      </span>
                      {flow.preventSelfApproval && <span className={styles.tag}>{t("approvalFlows.flagSelf")}</span>}
                      {flow.requireDistinctApprovers && <span className={styles.tag}>{t("approvalFlows.flagDistinct")}</span>}
                    </div>
                    <ol className={styles.stageNames}>
                      {stages.map((st) => (
                        <li key={st.position}>{st.name}</li>
                      ))}
                    </ol>
                  </div>
                  <div className={styles.rowActions}>
                    <button type="button" className={s.btnSecondary} onClick={() => setEditing(flow)}>
                      {t("approvalFlows.edit")}
                    </button>
                    <button type="button" className={s.btnGhost} onClick={() => setArchiveTarget(flow)}>
                      {t("approvalFlows.archive")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {editing && (
        <FlowForm
          flow={editing === "new" ? null : editing}
          members={members}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}

      {archiveTarget && (
        <ConfirmDialog
          danger
          busy={archiveBusy}
          title={t("approvalFlows.confirmArchive.title")}
          body={t("approvalFlows.confirmArchive.body", { name: archiveTarget.name })}
          confirmLabel={t("approvalFlows.confirmArchive.confirm")}
          onConfirm={() => void onArchive()}
          onCancel={() => !archiveBusy && setArchiveTarget(null)}
        />
      )}
    </>
  );
}
