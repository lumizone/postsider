"use client";

import { useId } from "react";
import { Switch } from "@/components/settings-ui";
import { useT } from "@/lib/i18n";
import {
  KEY_ACTIONS,
  isPermissionsSaveable,
  reconcileWithKnown,
  type KeyAction,
  type KeyPermissionsState,
} from "@/lib/key-permissions-model";

export interface PermissionChannel {
  id: string;
  name: string;
}

interface Props {
  value: KeyPermissionsState;
  onChange: (next: KeyPermissionsState) => void;
  /** Enabled channels of the organization (integration ids), or null while loading or when the load failed. */
  channels: PermissionChannel[] | null;
  channelsFailed?: boolean;
  disabled?: boolean;
}

function toggle<T>(list: T[], item: T, on: boolean): T[] {
  const without = list.filter((v) => v !== item);
  return on ? [...without, item] : without;
}

/**
 * The "Permissions" block of the API key create and rename dialogs. All text
 * from the server (channel names) is rendered as plain text.
 */
export function KeyPermissionsEditor({ value, onChange, channels, channelsFailed, disabled }: Props) {
  const t = useT();
  const uid = useId();
  const known = new Set((channels ?? []).map((c) => c.id));
  // Stored ids the server would reject (deleted or disabled channels).
  const stale = channels ? value.integrationIds.filter((id) => !known.has(id)) : [];

  return (
    <div
      role="group"
      aria-labelledby={`${uid}-title`}
      style={{ display: "flex", flexDirection: "column", gap: 10, padding: "12px 0 0", borderTop: "1px solid var(--line-soft)" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div id={`${uid}-title`} style={{ fontSize: 13, fontWeight: 600 }}>
            {t("settingsApi.permissionsTitle")}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{t("settingsApi.limitToggle")}</div>
        </div>
        <Switch
          on={value.limited}
          label={t("settingsApi.limitToggle")}
          onChange={() => {
            if (!disabled) onChange({ ...value, limited: !value.limited });
          }}
        />
      </div>

      {value.limited && (
        <>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }} disabled={disabled}>
            <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", padding: 0, marginBottom: 6 }}>
              {t("settingsApi.actionsLabel")}
            </legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
              {KEY_ACTIONS.map((action: KeyAction) => (
                <label key={action} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, minHeight: 28 }}>
                  <input
                    type="checkbox"
                    checked={value.actions.includes(action)}
                    onChange={(e) => onChange({ ...value, actions: toggle(value.actions, action, e.target.checked) })}
                  />
                  {t(`settingsApi.action_${action}` as const)}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }} disabled={disabled}>
            <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", padding: 0, marginBottom: 6 }}>
              {t("settingsApi.channelsLabel")}
            </legend>
            {channelsFailed ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("settingsApi.channelsLoadFailed")}</div>
            ) : channels !== null && channels.length === 0 && stale.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("settingsApi.noChannels")}</div>
            ) : (
              <div
                style={{
                  maxHeight: 150,
                  overflowY: "auto",
                  padding: "8px 10px",
                  border: "1px solid var(--line-soft)",
                  borderRadius: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {(channels ?? []).map((c) => (
                  <label key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, overflowWrap: "anywhere" }}>
                    <input
                      type="checkbox"
                      checked={value.integrationIds.includes(c.id)}
                      onChange={(e) => onChange({ ...value, integrationIds: toggle(value.integrationIds, c.id, e.target.checked) })}
                    />
                    {c.name}
                  </label>
                ))}
                {stale.map((id) => (
                  <label key={id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)" }}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() => onChange({ ...value, integrationIds: value.integrationIds.filter((v) => v !== id) })}
                    />
                    {t("settingsApi.unavailableItem")}
                  </label>
                ))}
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--muted)" }}>
              {value.integrationIds.length === 0 ? t("settingsApi.channelsAll") : null}
            </div>
            {stale.length > 0 && (
              <div role="status" style={{ fontSize: 12, color: "var(--muted)" }}>
                {t("settingsApi.staleChannelsNote")}
              </div>
            )}
          </fieldset>

          {!isPermissionsSaveable(reconcileWithKnown(value, channels ? channels.map((c) => c.id) : null).state) && (
            <div role="alert" style={{ fontSize: 12, fontWeight: 600 }}>
              {t("settingsApi.permissionsEmptyHint")}
            </div>
          )}
          <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--muted)" }}>{t("settingsApi.permissionsScope")}</div>
        </>
      )}
    </div>
  );
}
