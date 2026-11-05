"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, Card, Switch, settingsStyles as s } from "@/components/settings-ui";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { PolicyRuleForm } from "@/components/policies/policy-rule-form";
import { PolicyDryRunPanel } from "@/components/policies/policy-dry-run-panel";
import styles from "@/components/policies/policies.module.css";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useT, type MessageKey } from "@/lib/i18n";
import { useChannels } from "@/lib/use-channels";
import {
  createPolicy,
  deletePolicy,
  listApiKeyChoices,
  listPolicies,
  updatePolicy,
  type PolicyApiKeyChoice,
  type PolicyInput,
  type PolicyRule,
} from "@/lib/policies-api";
import { ruleSummary } from "@/lib/policies-model";

export default function PoliciesSettingsPage() {
  const t = useT();
  const { user } = useAuth();
  const canManage = user?.role === "ADMIN" || user?.role === "SUPERADMIN";
  const { raw: rawChannels } = useChannels();

  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [apiKeys, setApiKeys] = useState<PolicyApiKeyChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PolicyRule | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PolicyRule | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const list = await listPolicies();
      if (!alive.current) return;
      setRules(list);
      setForbidden(false);
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(t("policies.loadError"));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void reload();
    // Key names are a convenience for the filters; the page works without them.
    listApiKeyChoices()
      .then((keys) => {
        if (!cancelled) setApiKeys(keys);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const channelChoices = rawChannels.map((c) => ({ id: c.id, name: c.name, identifier: c.identifier }));

  const onToggle = async (rule: PolicyRule) => {
    if (toggling.has(rule.id)) return;
    const next = !rule.enabled;
    setError(null);
    setToggling((p) => new Set(p).add(rule.id));
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: next } : r)));
    try {
      const saved = await updatePolicy(rule.id, { enabled: next });
      if (alive.current) setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, ...saved } : r)));
    } catch (err) {
      if (!alive.current) return;
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
      setError(err instanceof Error && err.message ? err.message : t("policies.toggleError"));
    } finally {
      if (alive.current) {
        setToggling((p) => {
          const n = new Set(p);
          n.delete(rule.id);
          return n;
        });
      }
    }
  };

  const onSave = async (input: PolicyInput) => {
    if (editing && editing !== "new") await updatePolicy(editing.id, input);
    else await createPolicy(input);
    if (!alive.current) return;
    setEditing(null);
    await reload();
  };

  const onDelete = async () => {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await deletePolicy(deleteTarget.id);
      if (alive.current) setRules((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    } catch (err) {
      if (alive.current) setError(err instanceof Error && err.message ? err.message : t("policies.deleteError"));
    } finally {
      if (alive.current) {
        setDeleteBusy(false);
        setDeleteTarget(null);
      }
    }
  };

  if (!canManage || forbidden) {
    return (
      <PageHeader
        eyebrow={t("settings.eyebrow")}
        title={t("policies.title")}
        subtitle={canManage ? t("policies.forbidden") : t("policies.noPermission")}
      />
    );
  }

  const chipClass = (effect: string) => styles.chip + (effect === "BLOCK" ? " " + styles.chipFilled : "");

  return (
    <>
      <PageHeader eyebrow={t("settings.eyebrow")} title={t("policies.title")} subtitle={t("policies.subtitle")} />

      {error && (
        <div role="alert" className={styles.banner}>
          {error}
        </div>
      )}

      <Card
        title={t("policies.listTitle")}
        subtitle={loading ? t("common.loading") : t("policies.count", { count: rules.length })}
        actions={
          <button type="button" className={s.btnPrimary} onClick={() => setEditing("new")}>
            {t("policies.addRule")}
          </button>
        }
      >
        {loading ? (
          <div className={styles.empty}>{t("common.loading")}</div>
        ) : rules.length === 0 ? (
          <EmptyState title={t("policies.empty.title")} description={t("policies.empty.description")} />
        ) : (
          <ul className={styles.list}>
            {rules.map((rule) => {
              const sum = ruleSummary(rule);
              const counts: Record<string, number> = {
                actorTypes: rule.appliesToActorTypes.length,
                apiKeys: rule.appliesToApiKeyIds.length,
                channels: rule.appliesToIntegrationIds.length,
                providers: rule.appliesToProviders.length,
              };
              return (
                <li key={rule.id} className={styles.row + (rule.enabled ? "" : " " + styles.rowOff)}>
                  <Switch
                    on={rule.enabled}
                    label={t("policies.toggleLabel", { name: rule.displayName })}
                    onChange={() => void onToggle(rule)}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className={styles.name} title={rule.displayName}>
                      {rule.displayName}
                    </div>
                    <div className={styles.meta}>
                      <span className={chipClass(sum.effect)}>{t(`policies.effect.${sum.effect}` as MessageKey)}</span>
                      <span>{t(`policies.condition.${sum.condition}` as MessageKey)}</span>
                      <span>{t("policies.priorityValue", { value: rule.priority })}</span>
                      {!rule.enabled && <span className={styles.tag}>{t("policies.disabled")}</span>}
                      {!sum.filters.includes("actorTypes") && (
                        <span className={styles.tag}>{t("policies.filter.automation")}</span>
                      )}
                      {sum.filters.map((key) => (
                        <span key={key} className={styles.tag}>
                          {t(`policies.filter.${key}` as MessageKey, { count: counts[key] })}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className={styles.rowActions}>
                    <button type="button" className={s.btnSecondary} onClick={() => setEditing(rule)}>
                      {t("policies.edit")}
                    </button>
                    <button type="button" className={s.btnGhost} onClick={() => setDeleteTarget(rule)}>
                      {t("policies.delete")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <PolicyDryRunPanel channels={channelChoices} apiKeys={apiKeys} />

      {editing && (
        <PolicyRuleForm
          rule={editing === "new" ? null : editing}
          apiKeys={apiKeys}
          channels={channelChoices}
          onSave={onSave}
          onClose={() => setEditing(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          danger
          busy={deleteBusy}
          title={t("policies.confirmDelete.title")}
          body={t("policies.confirmDelete.body", { name: deleteTarget.displayName })}
          confirmLabel={t("policies.confirmDelete.confirm")}
          onConfirm={() => void onDelete()}
          onCancel={() => !deleteBusy && setDeleteTarget(null)}
        />
      )}
    </>
  );
}
