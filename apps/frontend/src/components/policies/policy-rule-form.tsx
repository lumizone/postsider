"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { settingsStyles as s } from "@/components/settings-ui";
import { ApiError } from "@/lib/api";
import { useT, type MessageKey } from "@/lib/i18n";
import type { PolicyApiKeyChoice, PolicyInput, PolicyRule } from "@/lib/policies-api";
import {
  POLICY_ACTOR_TYPE_LIST,
  POLICY_CONDITION_LIST,
  POLICY_EFFECT_LIST,
  emptyForm,
  formFromRule,
  toInput,
  validateForm,
  type PolicyFormState,
} from "@/lib/policies-model";
import styles from "./policies.module.css";

export interface PolicyChannelChoice {
  id: string;
  name: string;
  identifier: string;
}

interface Props {
  /** The rule being edited, or null for a new rule. */
  rule: PolicyRule | null;
  apiKeys: PolicyApiKeyChoice[];
  channels: PolicyChannelChoice[];
  onSave: (input: PolicyInput) => Promise<void>;
  onClose: () => void;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function toggle<T>(list: T[], value: T, on: boolean): T[] {
  const without = list.filter((v) => v !== value);
  return on ? [...without, value] : without;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function PolicyRuleForm({ rule, apiKeys, channels, onSave, onClose }: Props) {
  const t = useT();
  const uid = useId();
  const [form, setForm] = useState<PolicyFormState>(() =>
    rule ? formFromRule(rule) : { ...emptyForm(), timezone: browserZone() }
  );
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors = useMemo(() => validateForm(form), [form]);
  const shown = submitted ? errors : {};

  const panelRef = useRef<HTMLDivElement | null>(null);
  // Captured during the first render, before autoFocus moves focus into the form.
  const openerRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null
  );
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus goes into the dialog on open, Tab wraps inside it, Escape closes it
  // (not while saving) and focus returns to the opener on close.
  useEffect(() => {
    const opener = openerRef.current;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!panelRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  const set = <K extends keyof PolicyFormState>(key: K, value: PolicyFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const setCondition = (condition: PolicyFormState["condition"]) =>
    setForm((f) => ({
      ...f,
      condition,
      timezone: condition === "OUTSIDE_WINDOW" && !f.timezone ? browserZone() : f.timezone,
    }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setServerError(null);
    if (Object.keys(validateForm(form)).length > 0) return;
    setBusy(true);
    try {
      await onSave(toInput(form));
    } catch (err) {
      // The server stays the authority: show its own message as plain text.
      setServerError(
        err instanceof ApiError && err.status === 403
          ? t("policies.forbidden")
          : err instanceof Error && err.message
            ? err.message
            : t("policies.saveError")
      );
      setBusy(false);
    }
  };

  const fieldId = (name: string) => `${uid}-${name}`;
  const errText = (field: string): string | null => {
    const suffix = shown[field];
    return suffix ? t(`policies.validation.${suffix}` as MessageKey) : null;
  };
  const aria = (field: string) => ({
    "aria-invalid": shown[field] ? true : undefined,
    "aria-describedby": shown[field] ? `${fieldId(field)}-err` : undefined,
  });
  const err = (field: string) =>
    shown[field] ? (
      <div id={`${fieldId(field)}-err`} className={styles.fieldError} role="alert">
        {errText(field)}
      </div>
    ) : null;
  const cls = (base: string, field: string) => base + (shown[field] ? " " + styles.invalid : "");

  // Keep ids of a deleted key or channel visible so saving does not drop them silently.
  const keyOptions = optionsWithUnknown(
    apiKeys.map((k) => ({ id: k.id, label: k.name })),
    form.appliesToApiKeyIds,
    t("policies.form.unknownItem")
  );
  const channelOptions = optionsWithUnknown(
    channels.map((c) => ({ id: c.id, label: c.name })),
    form.appliesToIntegrationIds,
    t("policies.form.unknownItem")
  );

  return (
    <div className={styles.overlay} onClick={() => !busy && onClose()}>
      <div
        ref={panelRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={`${uid}-title`} className={styles.modalTitle}>
          {rule ? t("policies.form.editTitle") : t("policies.form.createTitle")}
        </h2>

        <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
          {serverError && (
            <div role="alert" className={styles.banner} style={{ margin: 0 }}>
              {serverError}
            </div>
          )}

          <div className={s.field}>
            <label className={s.label} htmlFor={fieldId("name")}>
              {t("policies.form.name")}
            </label>
            <input
              id={fieldId("name")}
              type="text"
              className={cls(s.input, "name")}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={t("policies.form.namePlaceholder")}
              autoFocus
              {...aria("name")}
            />
            {err("name")}
          </div>

          <div className={styles.pair}>
            <div className={s.field}>
              <label className={s.label} htmlFor={fieldId("effect")}>
                {t("policies.form.effect")}
              </label>
              <select
                id={fieldId("effect")}
                className={s.select}
                value={form.effect}
                onChange={(e) => set("effect", e.target.value as PolicyFormState["effect"])}
              >
                {POLICY_EFFECT_LIST.map((v) => (
                  <option key={v} value={v}>
                    {t(`policies.effect.${v}` as MessageKey)}
                  </option>
                ))}
              </select>
            </div>
            <div className={s.field}>
              <label className={s.label} htmlFor={fieldId("priority")}>
                {t("policies.form.priority")}
              </label>
              <input
                id={fieldId("priority")}
                type="text"
                inputMode="numeric"
                className={cls(s.input, "priority")}
                value={form.priority}
                onChange={(e) => set("priority", e.target.value)}
                {...aria("priority")}
              />
              <div className={s.hint}>{t("policies.form.priorityHint")}</div>
              {err("priority")}
            </div>
          </div>

          <div className={s.field}>
            <label className={s.label} htmlFor={fieldId("condition")}>
              {t("policies.form.condition")}
            </label>
            <select
              id={fieldId("condition")}
              className={s.select}
              value={form.condition}
              onChange={(e) => setCondition(e.target.value as PolicyFormState["condition"])}
            >
              {POLICY_CONDITION_LIST.map((v) => (
                <option key={v} value={v}>
                  {t(`policies.condition.${v}` as MessageKey)}
                </option>
              ))}
            </select>
          </div>

          {form.condition === "CONTAINS_WORDS" && (
            <div className={s.field}>
              <label className={s.label} htmlFor={fieldId("words")}>
                {t("policies.form.words")}
              </label>
              <textarea
                id={fieldId("words")}
                className={cls(s.textarea, "words")}
                value={form.words}
                onChange={(e) => set("words", e.target.value)}
                rows={4}
                {...aria("words")}
              />
              <div className={s.hint}>{t("policies.form.wordsHint")}</div>
              {err("words")}
            </div>
          )}

          {form.condition === "OUTSIDE_WINDOW" && (
            <fieldset className={styles.fieldset}>
              <div className={s.hint}>{t("policies.form.windowHint")}</div>
              <div className={s.field}>
                <span className={s.label} id={fieldId("days-label")}>
                  {t("policies.form.days")}
                </span>
                <div className={styles.checks} role="group" aria-labelledby={fieldId("days-label")} {...aria("windowDays")}>
                  {DAY_KEYS.map((key, day) => (
                    <label key={key} className={styles.check}>
                      <input
                        type="checkbox"
                        checked={form.windowDays.includes(day)}
                        onChange={(e) => set("windowDays", toggle(form.windowDays, day, e.target.checked))}
                      />
                      {t(`policies.day.${key}` as MessageKey)}
                    </label>
                  ))}
                </div>
                {err("windowDays")}
              </div>
              <div className={styles.pair}>
                <div className={s.field}>
                  <label className={s.label} htmlFor={fieldId("windowStart")}>
                    {t("policies.form.windowStart")}
                  </label>
                  <input
                    id={fieldId("windowStart")}
                    type="text"
                    inputMode="numeric"
                    placeholder="09:00"
                    className={cls(s.input, "windowStart")}
                    value={form.windowStart}
                    onChange={(e) => set("windowStart", e.target.value)}
                    {...aria("windowStart")}
                  />
                  {err("windowStart")}
                </div>
                <div className={s.field}>
                  <label className={s.label} htmlFor={fieldId("windowEnd")}>
                    {t("policies.form.windowEnd")}
                  </label>
                  <input
                    id={fieldId("windowEnd")}
                    type="text"
                    inputMode="numeric"
                    placeholder="17:00"
                    className={cls(s.input, "windowEnd")}
                    value={form.windowEnd}
                    onChange={(e) => set("windowEnd", e.target.value)}
                    {...aria("windowEnd")}
                  />
                  {err("windowEnd")}
                </div>
              </div>
              <div className={s.field}>
                <label className={s.label} htmlFor={fieldId("timezone")}>
                  {t("policies.form.timezone")}
                </label>
                <input
                  id={fieldId("timezone")}
                  type="text"
                  className={cls(s.input, "timezone")}
                  value={form.timezone}
                  onChange={(e) => set("timezone", e.target.value)}
                  placeholder="Europe/Warsaw"
                  autoCapitalize="off"
                  spellCheck={false}
                  {...aria("timezone")}
                />
                <div className={s.hint}>{t("policies.form.timezoneHint")}</div>
                {err("timezone")}
              </div>
            </fieldset>
          )}

          {form.condition === "DAILY_CAP_EXCEEDED" && (
            <div className={styles.pair}>
              <div className={s.field}>
                <label className={s.label} htmlFor={fieldId("capMax")}>
                  {t("policies.form.capMax")}
                </label>
                <input
                  id={fieldId("capMax")}
                  type="text"
                  inputMode="numeric"
                  className={cls(s.input, "capMax")}
                  value={form.capMax}
                  onChange={(e) => set("capMax", e.target.value)}
                  {...aria("capMax")}
                />
                {err("capMax")}
              </div>
              <div className={s.field}>
                <label className={s.label} htmlFor={fieldId("capScope")}>
                  {t("policies.form.capScope")}
                </label>
                <select
                  id={fieldId("capScope")}
                  className={s.select}
                  value={form.capScope}
                  onChange={(e) => set("capScope", e.target.value as PolicyFormState["capScope"])}
                >
                  <option value="organization">{t("policies.form.scopeOrganization")}</option>
                  <option value="channel">{t("policies.form.scopeChannel")}</option>
                </select>
              </div>
            </div>
          )}

          <fieldset className={styles.fieldset}>
            <legend className={styles.legend}>{t("policies.form.filtersTitle")}</legend>
            {err("filters")}

            <div className={s.field}>
              <span className={s.label} id={fieldId("actors-label")}>
                {t("policies.form.actorTypes")}
              </span>
              <div className={styles.checks} role="group" aria-labelledby={fieldId("actors-label")}>
                {POLICY_ACTOR_TYPE_LIST.map((v) => (
                  <label key={v} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={form.appliesToActorTypes.includes(v)}
                      onChange={(e) => set("appliesToActorTypes", toggle(form.appliesToActorTypes, v, e.target.checked))}
                    />
                    {t(`policies.actorType.${v}` as MessageKey)}
                  </label>
                ))}
              </div>
              <div className={s.hint}>{t("policies.form.actorTypesNote")}</div>
            </div>

            <ChoiceList
              label={t("policies.form.apiKeys")}
              hint={t("policies.form.emptyMeansAll")}
              none={t("policies.form.noneAvailable")}
              options={keyOptions}
              selected={form.appliesToApiKeyIds}
              onChange={(ids) => set("appliesToApiKeyIds", ids)}
            />

            <ChoiceList
              label={t("policies.form.channels")}
              hint={t("policies.form.emptyMeansAll")}
              none={t("policies.form.noneAvailable")}
              options={channelOptions}
              selected={form.appliesToIntegrationIds}
              onChange={(ids) => set("appliesToIntegrationIds", ids)}
            />

            <div className={s.field}>
              <label className={s.label} htmlFor={fieldId("providers")}>
                {t("policies.form.providers")}
              </label>
              <input
                id={fieldId("providers")}
                type="text"
                className={s.input}
                value={form.appliesToProviders}
                onChange={(e) => set("appliesToProviders", e.target.value)}
                placeholder="x, linkedin"
                autoCapitalize="off"
                spellCheck={false}
              />
              <div className={s.hint}>{t("policies.form.providersHint")}</div>
            </div>
          </fieldset>

          <label className={styles.check}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            {t("policies.form.enabled")}
          </label>

          {submitted && Object.keys(errors).length > 0 && (
            <div className={styles.fieldError} role="alert">
              {t("policies.validation.fixErrors")}
            </div>
          )}

          <div className={styles.footer}>
            <button type="button" className={s.btnGhost} onClick={onClose} disabled={busy}>
              {t("policies.form.cancel")}
            </button>
            <button type="submit" className={s.btnPrimary} disabled={busy}>
              {busy ? t("common.saving") : t("policies.form.save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function optionsWithUnknown(
  known: Array<{ id: string; label: string }>,
  selected: string[],
  unknownLabel: string
): Array<{ id: string; label: string }> {
  const ids = new Set(known.map((k) => k.id));
  const extra = selected.filter((id) => !ids.has(id)).map((id) => ({ id, label: unknownLabel }));
  return [...known, ...extra];
}

function ChoiceList({
  label,
  hint,
  none,
  options,
  selected,
  onChange,
}: {
  label: string;
  hint: string;
  none: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const uid = useId();
  return (
    <div className={s.field}>
      <span className={s.label} id={`${uid}-label`}>
        {label}
      </span>
      {options.length === 0 ? (
        <div className={s.hint}>{none}</div>
      ) : (
        <div className={styles.checkScroll} role="group" aria-labelledby={`${uid}-label`}>
          {options.map((o) => (
            <label key={o.id} className={styles.check}>
              <input
                type="checkbox"
                checked={selected.includes(o.id)}
                onChange={(e) => onChange(toggle(selected, o.id, e.target.checked))}
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
      <div className={s.hint}>{hint}</div>
    </div>
  );
}
