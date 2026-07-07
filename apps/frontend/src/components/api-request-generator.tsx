"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/settings-ui";
import { listChannels } from "@/lib/integrations";
import { defaultSettingsFor } from "@/lib/provider-requirements";
import { uploadMedia, UploadedMediaResponse } from "@/lib/media-api";
import { ChannelAvatar } from "@/components/channel-avatar";
import { type Channel } from "@/lib/calendar-data";
import {
  buildMultiPostBody,
  buildJson,
  buildCurl,
  RequestImage,
} from "@/lib/api-request-builder";
import styles from "./api-request-generator.module.css";

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
 * Settings -> API "Request generator". The same compose form as the calendar
 * (multi-select channels with their icons, content editor, date, media) but the
 * action is a live `POST /public/v1/posts` curl/JSON instead of publishing.
 */
export function ApiRequestGenerator() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [content, setContent] = useState("Hello from the API");
  const [datetime, setDatetime] = useState(nowLocal());
  const [type, setType] = useState<"schedule" | "now" | "draft">("schedule");
  const [image, setImage] = useState<RequestImage | null>(null);
  const [uploading, setUploading] = useState(false);
  const [tab, setTab] = useState<"curl" | "json">("curl");
  const [copied, setCopied] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Stable ids: one group for the whole request, one value id per channel.
  const groupId = useMemo(() => rid(), []);
  const valueIds = useRef<Record<string, string>>({});

  useEffect(() => {
    listChannels()
      .then(({ channels: chans }) => {
        setChannels(chans);
        if (chans[0]) setSelectedIds(new Set([chans[0].id]));
      })
      .catch(() => {});
  }, []);

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { curl, json } = useMemo(() => {
    const selected = channels.filter((c) => selectedIds.has(c.id));
    const chans =
      selected.length > 0
        ? selected.map((c) => ({
            integrationId: c.id,
            settings: defaultSettingsFor(c.identifier) as Record<
              string,
              unknown
            >,
            valueId: (valueIds.current[c.id] ??= rid()),
          }))
        : [
            {
              integrationId: "YOUR_CHANNEL_ID",
              settings: {},
              valueId: "value_id",
            },
          ];
    const body = buildMultiPostBody({
      channels: chans,
      content,
      date: datetime ? `${datetime}:00` : nowLocal() + ":00",
      type,
      image,
      group: groupId,
    });
    return { curl: buildCurl(body, BASE), json: buildJson(body) };
  }, [channels, selectedIds, content, datetime, type, image, groupId]);

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
        The same compose form as the calendar: pick one or more channels, write
        your post, attach media. The result is a ready-to-send{" "}
        <code className={styles.codeInline}>POST /public/v1/posts</code> request
        instead of publishing. Replace{" "}
        <code className={styles.codeInline}>ps_YOUR_API_KEY</code> with your key
        from the card above.
      </p>

      <div className={styles.grid}>
        {/* LEFT — the calendar compose form */}
        <div className={styles.panel}>
          <p className={styles.panelTitle}>
            Channels
            {selectedIds.size > 0 && (
              <span className={styles.selectedCount}>
                {"  ·  "}
                {selectedIds.size} selected
              </span>
            )}
          </p>
          {channels.length === 0 ? (
            <div className={styles.channelEmpty}>No channels connected yet.</div>
          ) : (
            <div className={styles.channelStrip}>
              {channels.map((c) => {
                const on = selectedIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={
                      styles.channelChip +
                      (on ? " " + styles.channelChipOn : "")
                    }
                    onClick={() => toggle(c.id)}
                    title={`${c.name} · ${c.platform}`}
                    aria-pressed={on}
                  >
                    <ChannelAvatar
                      channel={c}
                      size={40}
                      circular
                      showPlatformBadge
                      inverted={!on}
                    />
                    <span className={styles.channelChipName}>{c.name}</span>
                  </button>
                );
              })}
            </div>
          )}

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
            <label className={styles.field} style={{ width: 130 }}>
              Type
              <select
                className={styles.select}
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

          <div className={styles.rowEnd}>
            <div className={styles.imgNote}>
              {image ? `media: ${image.path}` : "No media attached"}
            </div>
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
                {uploading
                  ? "Uploading…"
                  : image
                    ? "Replace media"
                    : "Insert media"}
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
