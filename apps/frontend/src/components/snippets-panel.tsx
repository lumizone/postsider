"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InfoTip } from "./info-tip";
import {
  HashtagGroup,
  CaptionTemplate,
  UtmPreset,
  getHashtagGroups,
  getCaptionTemplates,
  getUtmPresets,
} from "@/lib/composer-helpers-api";

type Tab = "hashtags" | "templates" | "utm";

interface Props {
  /** Provider identifiers currently selected, used to filter platform-specific groups. */
  selectedPlatforms: string[];
  onInsertText: (text: string) => void;
  onApplyUtm: (preset: UtmPreset) => void;
  onClose: () => void;
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "7px 8px",
  fontSize: 12,
  fontWeight: active ? 700 : 500,
  border: "none",
  borderBottom: active ? "2px solid var(--fg)" : "2px solid transparent",
  background: "transparent",
  color: active ? "var(--fg)" : "var(--muted)",
  cursor: "pointer",
});

const itemRow: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  cursor: "pointer",
  marginBottom: 8,
};

export function SnippetsPanel({ selectedPlatforms, onInsertText, onApplyUtm, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("hashtags");
  const [groups, setGroups] = useState<HashtagGroup[]>([]);
  const [templates, setTemplates] = useState<CaptionTemplate[]>([]);
  const [presets, setPresets] = useState<UtmPreset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([getHashtagGroups(), getCaptionTemplates(), getUtmPresets()])
      .then(([g, t, u]) => {
        if (!alive) return;
        setGroups(g || []);
        setTemplates(t || []);
        setPresets(u || []);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const platformsLower = selectedPlatforms.map((p) => p.toLowerCase());
  const visibleGroups = groups.filter(
    (g) => !g.platform || platformsLower.includes(g.platform.toLowerCase())
  );

  const empty = (label: string) => (
    <div style={{ padding: "20px 4px", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
      {label}
      <div style={{ marginTop: 8 }}>
        <Link href="/settings/hashtag-groups" style={{ color: "var(--fg)", fontWeight: 600 }}>
          Manage in Settings
        </Link>
      </div>
    </div>
  );

  return (
    <div
      style={{
        width: 300,
        flexShrink: 0,
        border: "1px solid var(--line-soft)",
        borderRadius: 12,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
        maxHeight: "100%",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--line-soft)" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>
          Insert snippet
          <InfoTip textKey="infoTip.snippets" />
        </span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 16, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--line-soft)" }}>
        <button type="button" style={tabBtn(tab === "hashtags")} onClick={() => setTab("hashtags")}>Hashtags</button>
        <button type="button" style={tabBtn(tab === "templates")} onClick={() => setTab("templates")}>Templates</button>
        <button type="button" style={tabBtn(tab === "utm")} onClick={() => setTab("utm")}>UTM</button>
      </div>

      <div style={{ padding: 12, overflowY: "auto" }}>
        {loading ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Loading…</div>
        ) : tab === "hashtags" ? (
          visibleGroups.length === 0 ? (
            empty("No hashtag groups for the selected channels.")
          ) : (
            visibleGroups.map((g) => (
              <button key={g.id} type="button" style={itemRow} onClick={() => onInsertText(g.hashtags.join(" "))}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{g.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.hashtags.join(" ")}</div>
              </button>
            ))
          )
        ) : tab === "templates" ? (
          templates.length === 0 ? (
            empty("No caption templates yet.")
          ) : (
            templates.map((c) => (
              <button key={c.id} type="button" style={itemRow} onClick={() => onInsertText(c.content)}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.content}</div>
              </button>
            ))
          )
        ) : presets.length === 0 ? (
          empty("No UTM presets yet.")
        ) : (
          presets.map((p) => (
            <button key={p.id} type="button" style={itemRow} onClick={() => onApplyUtm(p)}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Apply to every URL</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
