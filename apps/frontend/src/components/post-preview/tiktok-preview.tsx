"use client";

import { ChannelAvatar } from "../channel-avatar";
import type { Channel } from "@/lib/calendar-data";
import { privacyLevelLabel } from "@/lib/provider-requirements";
import { useT } from "@/lib/i18n";
import type { PreviewMedia } from "./post-preview-panel";

/**
 * TikTok-shaped preview of the post that is about to go out.
 *
 * The Content Sharing Guidelines ask for a preview of the to-be-posted content
 * plus full awareness of the publishing settings, so the frame repeats the
 * creator the post goes to, the chosen privacy level and the commercial label
 * TikTok will apply. All of it is read-only: it mirrors the composer state.
 */
export function TikTokPreview({
  channel,
  nickname,
  avatarUrl,
  body,
  media,
  settings,
}: {
  channel: Channel;
  /** Creator nickname from `creator_info`, when it has loaded. */
  nickname?: string;
  avatarUrl?: string;
  body: string;
  media: PreviewMedia[];
  settings: Record<string, unknown>;
}) {
  const t = useT();
  const first = media[0];
  const displayName = nickname || channel.name;
  const privacy = privacyLevelLabel(settings.privacy_level as string | undefined);
  const isVideo = first?.kind === "video";
  const branded = Boolean(settings.brand_content_toggle);
  const promotional = Boolean(settings.brand_organic_toggle);
  const label = branded
    ? isVideo
      ? t("createPost.tiktok.labelPaidPartnershipVideo")
      : t("createPost.tiktok.labelPaidPartnershipPhoto")
    : promotional
      ? isVideo
        ? t("createPost.tiktok.labelPromotionalVideo")
        : t("createPost.tiktok.labelPromotionalPhoto")
      : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <article
        style={{
          border: "1px solid var(--line-soft)",
          borderRadius: 14,
          padding: 12,
          background: "#000",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ChannelAvatar channel={channel} size={30} circular showPlatformBadge />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
              @{displayName}
            </span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
              TikTok
            </span>
          </div>
        </header>

        {/* Vertical 9:16 frame, the shape TikTok plays. */}
        <div
          style={{
            width: "100%",
            aspectRatio: "9 / 16",
            maxHeight: 380,
            borderRadius: 10,
            overflow: "hidden",
            background: "#111",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {first ? (
            first.kind === "video" ? (
              <video
                src={first.url}
                controls
                muted
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={first.url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            )
          ) : (
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>
              {t("createPost.tiktok.previewNoMedia")}
            </span>
          )}
          {media.length > 1 && (
            <span
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(0,0,0,0.6)",
                color: "#fff",
                fontSize: 11,
              }}
            >
              1/{media.length}
            </span>
          )}
        </div>

        {body.trim().length > 0 && (
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.45,
              color: "#fff",
              whiteSpace: "pre-wrap",
            }}
          >
            {body}
          </p>
        )}
      </article>

      {/* What the creator is agreeing to, restated next to the preview. */}
      <dl
        style={{
          margin: 0,
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 8px",
          fontSize: 12,
        }}
      >
        <dt style={{ color: "var(--muted)" }}>
          {t("createPost.tiktok.previewPostingAs")}
        </dt>
        <dd style={{ margin: 0 }}>{nickname || channel.name}</dd>

        <dt style={{ color: "var(--muted)" }}>
          {t("createPost.tiktok.previewPrivacy")}
        </dt>
        <dd style={{ margin: 0 }}>
          {privacy ?? t("createPost.tiktok.previewPrivacyUnset")}
        </dd>

        <dt style={{ color: "var(--muted)" }}>
          {t("createPost.tiktok.disclosureMaster")}
        </dt>
        <dd style={{ margin: 0 }}>
          {label ?? t("createPost.tiktok.previewDisclosureNone")}
        </dd>
      </dl>
    </div>
  );
}
