"use client";

import styles from "./channels-panel.module.css";
import type { Channel } from "@/lib/calendar-data";
import { ChannelAvatar } from "./channel-avatar";
import { useT } from "@/lib/i18n";

interface ChannelsPanelProps {
  channels: Channel[];
  /** Multi-select (calendar): set of enabled channel IDs. Single-select (analytics): set with at most one ID. */
  enabled: Set<string>;
  collapsed: boolean;
  onToggleChannel: (id: string) => void;
  onToggleCollapse: () => void;
  onAddChannel?: () => void;
  onCreatePost?: () => void;
  /** "multi" = toggle on/off (default). "single" = radio-style; clicking selects only that channel. */
  mode?: "multi" | "single";
  /** Hide the action buttons (Add Channel / Create Post). */
  hideActions?: boolean;
  /** Open the channel detail popup (only used in multi mode). */
  onOpenChannel?: (id: string) => void;
}

function ChevronCollapse({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d={collapsed ? "M6 3.5 10.5 8 6 12.5" : "M10 3.5 5.5 8 10 12.5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden width="14" height="14">
      <path
        d="M8 3.5v9M3.5 8h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Avatar({
  channel,
  withBadge,
  inverted = false,
}: {
  channel: Channel;
  withBadge: boolean;
  inverted?: boolean;
  /** Kept for back-compat — colour now comes from the channel. */
  color?: string;
}) {
  return (
    <ChannelAvatar
      channel={channel}
      size={32}
      radius={9}
      inverted={inverted}
      showPlatformBadge={withBadge}
    />
  );
}

export function ChannelsPanel({
  channels,
  enabled,
  collapsed,
  onToggleChannel,
  onToggleCollapse,
  onAddChannel,
  onCreatePost,
  mode = "multi",
  hideActions = false,
  onOpenChannel,
}: ChannelsPanelProps) {
  const t = useT();
  const isSingle = mode === "single";
  return (
    <aside
      className={styles.panel + (collapsed ? " " + styles.panelCollapsed : "")}
      aria-label={t("channels.add")}
    >
      <div className={styles.head}>
        {!collapsed && <span className={styles.headTitle}>{t("channels.title")}</span>}
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand channels" : "Collapse channels"}
        >
          <ChevronCollapse collapsed={collapsed} />
        </button>
      </div>

      {!collapsed && (
        <>
          {!hideActions && (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.addBtn}
                onClick={onAddChannel}
              >
                <PlusIcon /> {t("channels.add")}
              </button>
              <button
                type="button"
                className={styles.createBtn}
                onClick={onCreatePost}
              >
                <PlusIcon /> {t("channels.createPost")}
              </button>
            </div>
          )}

          {!hideActions && <div className={styles.divider} />}

          <div
            className={styles.list}
            role={isSingle ? "radiogroup" : "listbox"}
            aria-multiselectable={isSingle ? undefined : true}
          >
            {channels.length === 0 && (
              <div className={styles.empty}>{t("channels.noChannels")}</div>
            )}
            {channels.map((c) => {
              const isOn = enabled.has(c.id);
              const handleRowClick = () => {
                if (isSingle) {
                  onToggleChannel(c.id);
                } else if (onOpenChannel) {
                  onOpenChannel(c.id);
                } else {
                  onToggleChannel(c.id);
                }
              };
              return (
                <button
                  type="button"
                  key={c.id}
                  role={isSingle ? "radio" : "option"}
                  aria-checked={isSingle ? isOn : undefined}
                  aria-selected={isSingle ? undefined : isOn}
                  className={
                    styles.row +
                    (isSingle && isOn ? " " + styles.rowActive : "")
                  }
                  onClick={handleRowClick}
                  title={`${c.name} · ${c.platform}`}
                >
                  <Avatar
                    channel={c}
                    withBadge
                    inverted={isSingle && isOn}
                    color={c.color}
                  />
                  <span className={styles.rowText}>
                    <span className={styles.name}>{c.name}</span>
                    <span className={styles.platform}>{c.platform}</span>
                  </span>
                  {!isSingle && (
                    <span
                      className={styles.colorDot}
                      style={{ background: c.color }}
                      aria-hidden
                    />
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      {collapsed && (
        <div className={styles.collapsedList}>
          {channels.map((c) => {
            const isOn = enabled.has(c.id);
            const handleClick = () => {
              if (isSingle) {
                onToggleChannel(c.id);
              } else if (onOpenChannel) {
                onOpenChannel(c.id);
              } else {
                onToggleChannel(c.id);
              }
            };
            return (
              <button
                type="button"
                key={c.id}
                className={
                  styles.collapsedRow +
                  (!isOn && !isSingle ? " " + styles.collapsedRowDisabled : "") +
                  (isSingle && isOn ? " " + styles.collapsedRowActive : "")
                }
                onClick={handleClick}
                title={`${c.name} · ${c.platform}`}
                aria-pressed={isOn}
              >
                <Avatar
                  channel={c}
                  withBadge={false}
                  inverted={isSingle && isOn}
                  color={c.color}
                />
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
