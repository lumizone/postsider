"use client";

import { useEffect, useState } from "react";
import styles from "./custom-fields-modal.module.css";
import type { CustomFieldDef } from "@/lib/integrations";
import { useT } from "@/lib/i18n";

interface CustomFieldsModalProps {
  provider: string;
  label: string;
  fields: CustomFieldDef[];
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
  submitting?: boolean;
  error?: string | null;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CustomFieldsModal({
  provider,
  label,
  fields,
  onClose,
  onSubmit,
  submitting = false,
  error = null,
}: CustomFieldsModalProps) {
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const f of fields) {
      initial[f.key] = f.defaultValue ?? "";
    }
    return initial;
  });

  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    for (const f of fields) {
      const val = values[f.key]?.trim() ?? "";
      // Fields with validation that allows empty (like /^.*$/) are optional
      const allowsEmpty = f.validation?.includes("^.*$") || f.label?.includes("optional");
      if (!val && !allowsEmpty) {
        errors[f.key] = t("channels.fieldRequired", { field: f.label });
        continue;
      }
      if (val && f.validation) {
        try {
          const match = f.validation.match(/^\/(.+)\/([gimsuy]*)$/);
          if (match) {
            const re = new RegExp(match[1], match[2]);
            if (!re.test(val)) {
              errors[f.key] = t("channels.fieldInvalid", {
                field: f.label.toLowerCase().replace(' (optional)', ''),
              });
            }
          }
        } catch {
          // skip broken regex
        }
      }
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!validate()) return;
    onSubmit(values);
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t("channels.connectName", { name: label })}
      onClick={onClose}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <span className={styles.eyebrow}>{t("channels.connect")}</span>
            <span className={styles.title}>{label}</span>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <CloseIcon />
          </button>
        </header>

        <form onSubmit={handleSubmit} className={styles.form}>
          {fields.map((f) => (
            <div key={f.key} className={styles.field}>
              <label htmlFor={`cf-${f.key}`} className={styles.label}>
                {f.label}
              </label>
              <input
                id={`cf-${f.key}`}
                type={f.type === "password" ? "password" : "text"}
                className={styles.input}
                value={values[f.key] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
                placeholder={f.defaultValue || f.label}
                autoComplete={f.type === "password" ? "off" : "on"}
                disabled={submitting}
              />
              {validationErrors[f.key] && (
                <span className={styles.error}>{validationErrors[f.key]}</span>
              )}
            </div>
          ))}

          {error && <div className={styles.formError}>{error}</div>}

          <button
            type="submit"
            className={styles.submitBtn}
            disabled={submitting}
          >
            {submitting ? t("channels.connecting") : t("channels.connect")}
          </button>
        </form>
      </div>
    </div>
  );
}
