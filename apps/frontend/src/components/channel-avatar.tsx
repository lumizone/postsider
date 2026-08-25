"use client";

import { useState, type CSSProperties } from "react";
import { type Channel } from "@/lib/calendar-data";
import { PlatformIcon } from "./platform-icon";

interface ChannelAvatarProps {
  channel: Channel;
  /** Pixel size of the avatar (square). */
  size?: number;
  /** CSS border-radius. Defaults to ~22% (rounded square) or full circle when `circular` is set. */
  radius?: number | string;
  /** Render as a perfect circle (sets radius to 50%). */
  circular?: boolean;
  /** Optional class for outer span. */
  className?: string;
  /** Optional inline style overrides. */
  style?: CSSProperties;
  /** When true, falls back to inverted (white background, black text) for the initial. */
  inverted?: boolean;
  /** Show a small platform glyph in the lower-right corner. */
  showPlatformBadge?: boolean;
}

function initial(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function pickReadableTextColor(hex: string): string {
  const m = hex.replace("#", "");
  if (m.length !== 6) return "#fff";
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#000" : "#fff";
}

export function ChannelAvatar({
  channel,
  size = 32,
  radius,
  circular,
  className,
  style,
  inverted = false,
  showPlatformBadge = false,
}: ChannelAvatarProps) {
  const [broken, setBroken] = useState(false);

  const fontSize = Math.max(9, Math.round(size * 0.36));
  const computedRadius = circular
    ? "50%"
    : radius !== undefined
      ? radius
      : Math.max(6, Math.round(size * 0.22));

  const showImage = channel.avatarUrl && !broken;
  const bg = inverted ? "var(--bg)" : channel.color;
  const fg = inverted ? "var(--fg)" : pickReadableTextColor(channel.color);

  // Container only used to position the badge; otherwise it is a transparent wrapper.
  const wrapperStyle: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    flexShrink: 0,
    width: size,
    height: size,
    ...style,
  };

  const innerStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: computedRadius,
    background: bg,
    color: fg,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize,
    fontWeight: 700,
    letterSpacing: 0,
    overflow: "hidden",
  };

  const badgeSize = Math.max(12, Math.round(size * 0.42));

  return (
    <span className={className} style={wrapperStyle} aria-hidden>
      <span style={innerStyle}>
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={channel.avatarUrl ?? undefined}
            alt=""
            width={size}
            height={size}
            onError={() => setBroken(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          initial(channel.name)
        )}
      </span>
      {showPlatformBadge && (
        <span
          style={{
            position: "absolute",
            right: -Math.round(badgeSize * 0.18),
            bottom: -Math.round(badgeSize * 0.18),
            width: badgeSize,
            height: badgeSize,
            borderRadius: "50%",
            background: "var(--bg)",
            color: "var(--fg)",
            border: "2px solid var(--bg)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxSizing: "border-box",
            overflow: "hidden",
          }}
        >
          <PlatformIcon
            platform={channel.platform}
            size={Math.max(8, Math.round(badgeSize * 0.78))}
          />
        </span>
      )}
    </span>
  );
}
