"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Switch, settingsStyles as s } from "@/components/settings-ui";
import { ApiError } from "@/lib/api";
import type { ApprovalFlow, ApprovalFlowBody } from "@/lib/approval-flows-api";
import {
  FLOW_LIMITS,
  FLOW_MIN_ROLE_LIST,
  emptyFlow,
  emptyStage,
  flowToDraft,
  moveStage,
  toRequestBody,
  validateFlow,
  type FlowDraft,
  type StageDraft,
} from "@/lib/approval-flows-model";
import { useT, type MessageKey } from "@/lib/i18n";
import styles from "./flow-form.module.css";

export interface FlowMemberChoice {
  id: string;
  label: string;
}

interface Props {
  /** The flow being edited, or null for a new flow. */
  flow: ApprovalFlow | null;
  /** Admin and owner members only (the USER role can never decide). null = could not be loaded. */
  members: FlowMemberChoice[] | null;
  onSave: (body: ApprovalFlowBody) => Promise<void>;
  onClose: () => void;
}

function toggle(list: string[], value: string, on: boolean): string[] {
  const without = list.filter((v) => v !== value);
  return on ? [...without, value] : without;
}

export function FlowForm({ flow, members, onSave, onClose }: Props) {
  const t = useT();
  const uid = useId();
  const [draft, setDraft] = useState<FlowDraft>(() => (flow ? flowToDraft(flow) : emptyFlow()));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors = useMemo(() => validateFlow(draft), [draft]);
  const errorByField = useMemo(() => {
    const m: Record<string, MessageKey> = {};
    for (const e of errors) if (!m[e.field]) m[e.field] = e.key;
    return m;
  }, [errors]);
  const shown = submitted ? errorByField : ({} as Record<string, MessageKey>);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const setFlag = <K extends keyof FlowDraft>(key: K, value: FlowDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const setStage = (index: number, patch: Partial<StageDraft>) =>
    setDraft((d) => ({ ...d, stages: d.stages.map((st, i) => (i === index ? { ...st, ...patch } : st)) }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setServerError(null);
    if (validateFlow(draft).length > 0) return;
    setBusy(true);
    try {
      await onSave(toRequestBody(draft));
    } catch (err) {
      // The server stays the authority: its own message is plain text, never markup.
      setServerError(
        err instanceof ApiError && err.status === 403
          ? t("approvalFlows.forbidden")
          : err instanceof Error && err.message
            ? err.message
            : t("approvalFlows.saveError")
      );
      setBusy(false);
    }
  };

  const id = (name: string) => `${uid}-${name}`;
  const aria = (field: string) => ({
    "aria-invalid": shown[field] ? true : undefined,
    "aria-describedby": shown[field] ? `${id(field)}-err` : undefined,
  });
  const err = (field: string) =>
    shown[field] ? (
      <div id={`${id(field)}-err`} className={styles.fieldError} role="alert">
        {t(shown[field])}
      </div>
    ) : null;
  const cls = (base: string, field: string) => base + (shown[field] ? " " + styles.invalid : "");

  return (
    <div className={styles.overlay} onClick={() => !busy && onClose()}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id("title")}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={id("title")} className={styles.modalTitle}>
          {flow ? t("approvalFlows.form.editTitle") : t("approvalFlows.form.createTitle")}
        </h2>

        <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
          {serverError && (
            <div role="alert" className={styles.banner}>
              {serverError}
            </div>
          )}

          <div className={s.field}>
            <label className={s.label} htmlFor={id("name")}>
              {t("approvalFlows.form.name")}
            </label>
            <input
              id={id("name")}
              type="text"
              className={cls(s.input, "name")}
              value={draft.name}
              onChange={(e) => setFlag("name", e.target.value)}
              placeholder={t("approvalFlows.form.namePlaceholder")}
              autoFocus
              {...aria("name")}
            />
            {err("name")}
          </div>

          <SwitchRow
            title={t("approvalFlows.form.isDefault")}
            hint={t("approvalFlows.form.isDefaultHint")}
            on={draft.isDefault}
            onChange={() => setFlag("isDefault", !draft.isDefault)}
          />
          <SwitchRow
            title={t("approvalFlows.form.preventSelf")}
            hint={t("approvalFlows.form.preventSelfHint")}
            on={draft.preventSelfApproval}
            onChange={() => setFlag("preventSelfApproval", !draft.preventSelfApproval)}
          />
          <SwitchRow
            title={t("approvalFlows.form.distinct")}
            hint={t("approvalFlows.form.distinctHint")}
            on={draft.requireDistinctApprovers}
            onChange={() => setFlag("requireDistinctApprovers", !draft.requireDistinctApprovers)}
          />

          <div className={styles.stagesHead}>
            <div className={styles.stagesTitle}>{t("approvalFlows.form.stagesTitle")}</div>
            <div className={s.hint}>{t("approvalFlows.form.stagesHint")}</div>
            {err("stages")}
          </div>

          <ol className={styles.stageList}>
            {draft.stages.map((st, i) => {
              const last = draft.stages.length - 1;
              // Keep ids of members who left visible so saving does not drop them silently.
              const known = new Set((members ?? []).map((m) => m.id));
              const options = [
                ...(members ?? []),
                ...st.approverUserIds.filter((x) => !known.has(x)).map((x) => ({ id: x, label: t("approvalFlows.form.unknownMember") })),
              ];
              return (
                <li key={i} className={styles.stage}>
                  <div className={styles.stageBar}>
                    <span className={styles.stageBadge}>{t("approvalFlows.form.stageLabel", { position: i + 1 })}</span>
                    <div className={styles.stageActions}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={t("approvalFlows.form.moveUp")}
                        title={t("approvalFlows.form.moveUp")}
                        disabled={i === 0 || busy}
                        onClick={() => setDraft((d) => ({ ...d, stages: moveStage(d.stages, i, i - 1) }))}
                      >
                        {"↑"}
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        aria-label={t("approvalFlows.form.moveDown")}
                        title={t("approvalFlows.form.moveDown")}
                        disabled={i === last || busy}
                        onClick={() => setDraft((d) => ({ ...d, stages: moveStage(d.stages, i, i + 1) }))}
                      >
                        {"↓"}
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        disabled={draft.stages.length <= FLOW_LIMITS.stagesMin || busy}
                        onClick={() => setDraft((d) => ({ ...d, stages: d.stages.filter((_, k) => k !== i) }))}
                      >
                        {t("approvalFlows.form.removeStage")}
                      </button>
                    </div>
                  </div>

                  <div className={styles.pair}>
                    <div className={s.field}>
                      <label className={s.label} htmlFor={id(`s${i}-name`)}>
                        {t("approvalFlows.form.stageName")}
                      </label>
                      <input
                        id={id(`s${i}-name`)}
                        type="text"
                        className={cls(s.input, `stages.${i}.name`)}
                        value={st.name}
                        onChange={(e) => setStage(i, { name: e.target.value })}
                        placeholder={t("approvalFlows.form.stageNamePlaceholder")}
                        {...{
                          "aria-invalid": shown[`stages.${i}.name`] ? true : undefined,
                          "aria-describedby": shown[`stages.${i}.name`] ? `${id(`s${i}-name`)}-err` : undefined,
                        }}
                      />
                      {shown[`stages.${i}.name`] && (
                        <div id={`${id(`s${i}-name`)}-err`} className={styles.fieldError} role="alert">
                          {t(shown[`stages.${i}.name`])}
                        </div>
                      )}
                    </div>
                    <div className={s.field}>
                      <label className={s.label} htmlFor={id(`s${i}-role`)}>
                        {t("approvalFlows.form.minRole")}
                      </label>
                      <select
                        id={id(`s${i}-role`)}
                        className={s.select}
                        value={st.minRole}
                        onChange={(e) => setStage(i, { minRole: e.target.value as StageDraft["minRole"] })}
                      >
                        {FLOW_MIN_ROLE_LIST.map((r) => (
                          <option key={r} value={r}>
                            {t(`approvalFlows.form.role_${r}` as MessageKey)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className={s.field}>
                    <span className={s.label} id={id(`s${i}-approvers`)}>
                      {t("approvalFlows.form.approvers")}
                    </span>
                    {options.length === 0 ? (
                      <div className={s.hint}>{members === null ? t("approvalFlows.form.membersLoadFailed") : t("approvalFlows.form.approversNone")}</div>
                    ) : (
                      <div className={styles.checkScroll} role="group" aria-labelledby={id(`s${i}-approvers`)}>
                        {options.map((m) => (
                          <label key={m.id} className={styles.check}>
                            <input
                              type="checkbox"
                              checked={st.approverUserIds.includes(m.id)}
                              onChange={(e) => setStage(i, { approverUserIds: toggle(st.approverUserIds, m.id, e.target.checked) })}
                            />
                            {m.label}
                          </label>
                        ))}
                      </div>
                    )}
                    {members === null && options.length > 0 && <div className={s.hint}>{t("approvalFlows.form.membersLoadFailed")}</div>}
                    <div className={s.hint}>{t("approvalFlows.form.approversHint")}</div>
                    {shown[`stages.${i}.approverUserIds`] && (
                      <div className={styles.fieldError} role="alert">
                        {t(shown[`stages.${i}.approverUserIds`])}
                      </div>
                    )}
                  </div>

                  <SwitchRow
                    title={t("approvalFlows.form.allowAutomation")}
                    on={st.allowAutomation}
                    onChange={() => setStage(i, { allowAutomation: !st.allowAutomation })}
                  />
                  <SwitchRow
                    title={t("approvalFlows.form.allowGuest")}
                    on={st.allowGuest}
                    onChange={() => setStage(i, { allowGuest: !st.allowGuest })}
                  />
                </li>
              );
            })}
          </ol>

          <div>
            <button
              type="button"
              className={s.btnSecondary}
              disabled={draft.stages.length >= FLOW_LIMITS.stagesMax || busy}
              onClick={() => setDraft((d) => ({ ...d, stages: [...d.stages, emptyStage()] }))}
            >
              {t("approvalFlows.form.addStage")}
            </button>
          </div>

          {submitted && errors.length > 0 && (
            <div className={styles.fieldError} role="alert">
              {t("approvalFlows.validation.fixErrors")}
            </div>
          )}

          <div className={styles.footer}>
            <button type="button" className={s.btnGhost} onClick={onClose} disabled={busy}>
              {t("approvalFlows.form.cancel")}
            </button>
            <button type="submit" className={s.btnPrimary} disabled={busy}>
              {busy ? t("common.saving") : t("approvalFlows.form.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SwitchRow({ title, hint, on, onChange }: { title: string; hint?: string; on: boolean; onChange: () => void }) {
  return (
    <div className={styles.switchRow}>
      <div>
        <div className={styles.switchTitle}>{title}</div>
        {hint && <div className={styles.switchHint}>{hint}</div>}
      </div>
      <Switch on={on} onChange={onChange} label={title} />
    </div>
  );
}
