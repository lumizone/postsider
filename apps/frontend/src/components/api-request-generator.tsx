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
import styles from "./api-request-generator.module.css";

type IntegrationRow = { id: string; name: string; identifier: string };

const rid = () => Math.random().toString(36).slice(2, 12);
const BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

function nowLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/**
 * Settings -> API "Request generator". A composer-style two-panel form (compose
 * on the left, live request on the right) that produces the ready-to-send
 * `POST /public/v1/posts` curl/JSON instead of publishing.
 */
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
        const mapped = (raw || []).map((i) => ({
          id: i.id,
          name: i.name,
          identifier: i.identifier,
        }));
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
      settings: selected
        ? (defaultSettingsFor(selected.identifier) as Record<string, unknown>)
        : {},
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
      <p className={styles.intro}>
        Compose a post just like the calendar, then copy the ready-to-send{" "}
        <code className={styles.codeInline}>POST /public/v1/posts</code> request
        instead of publishing. Replace{" "}
        <code className={styles.codeInline}>ps_YOUR_API_KEY</code> with your key
        from the card above.
      </p>

      <div className={styles.grid}>
        {/* LEFT — compose (mirrors the composer) */}
        <div className={styles.panel}>
          <p className={styles.panelTitle}>Compose</p>

          <div className={styles.row2}>
            <label className={styles.field}>
              Channel
              <select
                className={styles.input}
                value={integrationId}
                onChange={(e) => setIntegrationId(e.target.value)}
              >
                {rows.length === 0 && (
                  <option value="">No channels connected</option>
                )}
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.identifier})
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Type
              <select
                className={styles.input}
                value={type}
                onChange={(e) =>
                  setType(e.target.value as "schedule" | "now" | "draft")
                }
              >
                <option value="schedule">schedule</option>
                <option value="now">now</option>
                <option value="draft">draft</option>
              </select>
            </label>
          </div>

          <label className={styles.field}>
            Post content
            <textarea
              className={`${styles.input} ${styles.editor}`}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What do you want to publish?"
            />
          </label>

          <div className={styles.rowEnd}>
            <label className={styles.field}>
              Date &amp; time
              <input
                type="datetime-local"
                className={styles.input}
                value={datetime}
                onChange={(e) => setDatetime(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                style={{ display: "none" }}
                onChange={(e) => onUpload(e.target.files?.[0])}
              />
              <button
                type="button"
                className={styles.ghost}
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? "Uploading…" : image ? "Replace media" : "Add media"}
              </button>
              {image && (
                <button
                  type="button"
                  className={`${styles.ghost} ${styles.removeBtn}`}
                  onClick={() => setImage(null)}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          {image && <div className={styles.imgNote}>media: {image.path}</div>}
        </div>

        {/* RIGHT — live request output */}
        <div className={styles.output}>
          <div className={styles.outputHead}>
            <div className={styles.tabs}>
              {(["curl", "json"] as const).map((tb) => (
                <button
                  key={tb}
                  type="button"
                  onClick={() => setTab(tb)}
                  className={`${styles.tab} ${
                    tab === tb ? styles.tabActive : ""
                  }`}
                >
                  {tb}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.copyBtn}
              onClick={() => copy(tab === "curl" ? curl : json, tab)}
            >
              {copied === tab ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className={styles.codeBlock}>{tab === "curl" ? curl : json}</pre>
        </div>
      </div>
    </Card>
  );
}
