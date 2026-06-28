"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/settings-ui";
import { listChannels } from "@/lib/integrations";
import { defaultSettingsFor } from "@/lib/provider-requirements";
import { uploadMedia, UploadedMediaResponse } from "@/lib/media-api";
import {
  buildPostBody,
  buildJson,
  buildCurl,
  RequestImage,
} from "@/lib/api-request-builder";

type IntegrationRow = { id: string; name: string; identifier: string };

const rid = () => Math.random().toString(36).slice(2, 12);
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const input: React.CSSProperties = {
  padding: "9px 12px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  fontSize: 13,
  background: "var(--bg)",
  color: "var(--fg)",
  width: "100%",
};
const ghost: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 13,
  cursor: "pointer",
};

export function ApiRequestGenerator() {
  const [rows, setRows] = useState<IntegrationRow[]>([]);
  const [integrationId, setIntegrationId] = useState("");
  const [content, setContent] = useState("Hello from the API");
  const [datetime, setDatetime] = useState(nowLocal());
  const [type, setType] = useState<"schedule" | "now" | "draft">("schedule");
  const [image, setImage] = useState<RequestImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<"curl" | "json">("curl");
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // group + value id are stable for the session so the output does not churn.
  const ids = useMemo(() => ({ group: rid(), valueId: rid() }), []);

  useEffect(() => {
    listChannels()
      .then(({ raw }) => {
        const mapped = (raw || []).map((i) => ({ id: i.id, name: i.name, identifier: i.identifier }));
        setRows(mapped);
        if (mapped[0]) setIntegrationId(mapped[0].id);
      })
      .catch(() => {});
  }, []);

  const selected = rows.find((r) => r.id === integrationId);

  const { curl, json } = useMemo(() => {
    const body = buildPostBody({
      integrationId: integrationId || "YOUR_CHANNEL_ID",
      content,
      date: datetime ? `${datetime}:00` : nowLocal() + ":00",
      type,
      settings: selected ? (defaultSettingsFor(selected.identifier) as Record<string, unknown>) : {},
      image,
      group: ids.group,
      valueId: ids.valueId,
    });
    return { curl: buildCurl(body, BASE), json: buildJson(body) };
  }, [integrationId, content, datetime, type, image, selected, ids]);

  const onUpload = async (file?: File | null) => {
    if (!file) return;
    setUploading(true);
    try {
      const res: UploadedMediaResponse = await uploadMedia(file);
      setImage({ id: res.id, path: res.path, alt: res.alt, thumbnail: res.thumbnail });
    } catch {
      // ignore — user can retry
    } finally {
      setUploading(false);
    }
  };

  const copy = (text: string, which: string) => {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1800);
    });
  };

  return (
    <Card title="Request generator">
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
        Build a ready-to-use request for <code style={{ background: "rgba(0,0,0,0.04)", padding: "1px 5px", borderRadius: 4 }}>POST /public/v1/posts</code>. Pick a channel, write your post, attach an image, then copy the curl or JSON. Paste your API key (from the card above) in place of <code>ps_YOUR_API_KEY</code>.
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--muted)" }}>
            Channel
            <select style={input} value={integrationId} onChange={(e) => setIntegrationId(e.target.value)}>
              {rows.length === 0 && <option value="">No channels connected</option>}
              {rows.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({r.identifier})</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--muted)" }}>
            Type
            <select style={input} value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="schedule">schedule</option>
              <option value="now">now</option>
              <option value="draft">draft</option>
            </select>
          </label>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--muted)" }}>
          Text
          <textarea style={{ ...input, minHeight: 70, resize: "vertical" }} value={content} onChange={(e) => setContent(e.target.value)} />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12, color: "var(--muted)" }}>
            Date
            <input type="datetime-local" style={input} value={datetime} onChange={(e) => setDatetime(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={(e) => onUpload(e.target.files?.[0])} />
            <button type="button" style={ghost} onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Uploading…" : image ? "Replace image" : "Add image"}
            </button>
            {image && (
              <button type="button" style={{ ...ghost, color: "#DC2626", borderColor: "rgba(220,38,38,0.25)" }} onClick={() => setImage(null)}>Remove</button>
            )}
          </div>
        </div>
        {image && (
          <div style={{ fontSize: 11, color: "var(--muted)", wordBreak: "break-all" }}>image: {image.path}</div>
        )}
      </div>

      <div style={{ marginTop: 18, border: "1px solid var(--line-soft)", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--line-soft)", padding: "6px 8px" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {(["curl", "json"] as const).map((tb) => (
              <button key={tb} type="button" onClick={() => setTab(tb)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: tab === tb ? "var(--fg)" : "transparent", color: tab === tb ? "var(--bg)" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "uppercase" }}>{tb}</button>
            ))}
          </div>
          <button type="button" style={ghost} onClick={() => copy(tab === "curl" ? curl : json, tab)}>
            {copied === tab ? "Copied" : "Copy"}
          </button>
        </div>
        <pre style={{ margin: 0, padding: "14px 16px", fontSize: 12, lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre", color: "var(--fg)" }}>{tab === "curl" ? curl : json}</pre>
      </div>
    </Card>
  );
}
