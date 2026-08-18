"use client";

import { useState } from "react";
import { ChannelAvatar } from "../channel-avatar";
import type { Channel } from "@/lib/calendar-data";
import { familyFor } from "./preview-families";
import { mediaAspectRatio, previewFold, truncateBody } from "./preview-utils";

export interface PreviewMedia {
  id: string;
  kind: "image" | "video";
  url: string;
}

interface Props {
  channels: Channel[];
  activeTarget: string;
  bodyFor: (channelId: string) => string;
  media: PreviewMedia[];
  threadParts: string[];
  maxLenFor: (channel: Channel) => number;
  identifierFor: (channel: Channel) => string | undefined;
}

export function PostPreviewPanel({
  channels,
  activeTarget,
  bodyFor,
  media,
  threadParts,
  maxLenFor,
  identifierFor,
}: Props) {
  const [tab, setTab] = useState<string | null>(null);

  if (channels.length === 0) {
    return (
      <span style={{ fontSize: 13, color: "var(--muted)" }}>
        Select at least one channel.
      </span>
    );
  }

  const active =
    channels.find((c) => c.id === (tab ?? activeTarget)) ?? channels[0];
  const identifier = identifierFor(active);
  const family = familyFor(identifier);
  const max = maxLenFor(active);
  const body = bodyFor(active.id);
  const over = max > 0 && body.length > max;
  const aspect = mediaAspectRatio(family, (active as any).postType);
  const fold = previewFold(family);
  const folded = fold > 0 ? truncateBody(body, fold) : { text: body, truncated: false };
  const visibleThread = threadParts.filter((p) => p.trim().length > 0);
  const isMicroblog = family === "microblog";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {channels.length > 1 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {channels.map((c) => {
            const on = c.id === active.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setTab(c.id)}
                title={c.name}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: `1px solid ${on ? "var(--fg)" : "var(--line-soft)"}`,
                  background: on ? "var(--fg)" : "var(--bg)",
                  color: on ? "var(--bg)" : "var(--muted)",
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      <article style={{ border: "1px solid var(--line-soft)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10, background: "var(--bg)" }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChannelAvatar channel={active} size={30} circular showPlatformBadge />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{active.name}</span>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{active.platform}</span>
          </div>
        </header>

        {body.trim().length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>Start writing for a preview.</p>
        ) : (
          <p style={{ margin: 0, fontSize: 14, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
            {folded.text}
            {folded.truncated && <span style={{ color: "var(--muted)" }}> …more</span>}
          </p>
        )}

        {media.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {media.slice(0, 1).map((m) => (
              <span
                key={m.id}
                style={{
                  width: "100%",
                  aspectRatio: m.kind === "video" ? "auto" : aspect,
                  maxHeight: m.kind === "video" ? 420 : undefined,
                  borderRadius: 10,
                  overflow: "hidden",
                  background: "#000",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {m.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <video src={m.url} controls muted playsInline style={{ width: "100%", maxHeight: 420, objectFit: "contain" }} />
                )}
              </span>
            ))}
            {media.length > 1 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {media.slice(1, 4).map((m) => (
                  <span key={m.id} style={{ width: 88, aspectRatio: aspect, borderRadius: 8, overflow: "hidden", background: "#000", display: "block" }}>
                    {m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <video src={m.url} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    )}
                  </span>
                ))}
                {media.length > 4 && (
                  <span style={{ fontSize: 12, color: "var(--muted)", alignSelf: "center" }}>+{media.length - 4}</span>
                )}
              </div>
            )}
          </div>
        )}

        {visibleThread.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, borderLeft: isMicroblog ? "2px solid var(--line-soft)" : "none", paddingLeft: isMicroblog ? 10 : 0 }}>
            {visibleThread.map((p, i) => (
              <p key={i} style={{ margin: 0, fontSize: 13, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
                {isMicroblog ? "" : "↳ "}{p}
              </p>
            ))}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", fontSize: 11, color: over ? "#DC2626" : "var(--muted)", fontWeight: over ? 600 : 400 }}>
          {body.length}{max > 0 ? ` / ${max}` : ""}{over ? " · over limit" : ""}
        </div>
      </article>
    </div>
  );
}
