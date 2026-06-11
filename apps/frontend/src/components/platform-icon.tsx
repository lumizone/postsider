import type { CSSProperties } from "react";
import {
  siGhost,
  siGmail,
  siNotion,
  siRumble,
} from "simple-icons";

interface PlatformIconProps {
  /** Logical platform name (e.g. "X", "BearBlog"). */
  platform: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Mapping of internal platform names → public PNG/SVG asset path. Drop a new
 * file in `apps/frontend/public/platforms/` and add the entry here.
 */
const ICON_PATHS: Record<string, string> = {
  Bluesky: "/platforms/bluesky.png",
  DevTo: "/platforms/devto.png",
  Discord: "/platforms/discord.png",
  Dribbble: "/platforms/dribbble.png",
  Facebook: "/platforms/facebook.png",
  Farcaster: "/platforms/wrapcast.png",
  GoogleBusiness: "/platforms/gmb.png",
  Blogger: "/platforms/blogger.svg",
  Hashnode: "/platforms/hashnode.png",
  Instagram: "/platforms/instagram.png",
  InstagramStandalone: "/platforms/instagram-standalone.png",
  Kick: "/platforms/kick.png",
  Lemmy: "/platforms/lemmy.png",
  LinkedIn: "/platforms/linkedin.png",
  LinkedInPage: "/platforms/linkedin-page.png",
  Listmonk: "/platforms/listmonk.png",
  Mastodon: "/platforms/mastodon.png",
  MastodonCustom: "/platforms/mastodon-custom.png",
  Medium: "/platforms/medium.png",
  MeWe: "/platforms/mewe.png",
  Moltbook: "/platforms/moltbook.png",
  Nostr: "/platforms/nostr.png",
  Pinterest: "/platforms/pinterest.png",
  Reddit: "/platforms/reddit.png",
  Skool: "/platforms/skool.png",
  Slack: "/platforms/slack.png",
  Telegram: "/platforms/telegram.png",
  Threads: "/platforms/threads.png",
  TikTok: "/platforms/tiktok.png",
  Twitch: "/platforms/twitch.png",
  VK: "/platforms/vk.png",
  Whop: "/platforms/whop.png",
  WordPress: "/platforms/wordpress.png",
  X: "/platforms/x.png",
  YouTube: "/platforms/youtube.svg",
};

/**
 * SVG path data + brand colour for platforms that don't have a PNG asset.
 * Sourced from `simple-icons` where possible, otherwise hand-drawn.
 */
const SVG_FALLBACKS: Record<
  string,
  { path: string; bg: string; fg: string }
> = {
  Gmail: { path: siGmail.path, bg: "#fff", fg: "#EA4335" },
  Notion: { path: siNotion.path, bg: "#fff", fg: "#000" },
  Ghost: { path: siGhost.path, bg: "#15171A", fg: "#fff" },
  Rumble: { path: siRumble.path, bg: "#85C742", fg: "#fff" },
  BearBlog: {
    // Bear face — fallback because there is no `simple-icons` entry.
    path:
      "M5 8a3 3 0 0 1 3-3 3 3 0 0 1 1.5.4 4.5 4.5 0 0 1 5 0A3 3 0 0 1 16 5a3 3 0 0 1 3 3v.5a5.5 5.5 0 1 1-14 0V8Zm6 5a1 1 0 0 0 2 0 1 1 0 0 0-2 0Z",
    bg: "#FFD60A",
    fg: "#000",
  },
  Mataroa: {
    path: "M4 19V6l4 5h2l4-5v13",
    bg: "#fff",
    fg: "#000",
  },
  WriteAs: {
    path: "M4 16 14 6l4 4L8 20H4v-4Zm12-12 4 4-2 2-4-4 2-2Z",
    bg: "#5BC4BE",
    fg: "#000",
  },
};

export function PlatformIcon({
  platform,
  size = 14,
  className,
  style,
}: PlatformIconProps) {
  const src = ICON_PATHS[platform];

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          display: "block",
          ...style,
        }}
        aria-hidden
      />
    );
  }

  const fallback = SVG_FALLBACKS[platform];
  if (fallback) {
    return (
      <span
        aria-hidden
        className={className}
        style={{
          width: size,
          height: size,
          background: fallback.bg,
          color: fallback.fg,
          borderRadius: Math.max(4, Math.round(size * 0.22)),
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          ...style,
        }}
      >
        <svg
          role="img"
          aria-hidden
          viewBox="0 0 24 24"
          width={Math.round(size * 0.66)}
          height={Math.round(size * 0.66)}
          fill="currentColor"
        >
          <path d={fallback.path} />
        </svg>
      </span>
    );
  }

  return (
    <svg
      role="img"
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={style}
      fill="currentColor"
    >
      <circle cx="12" cy="12" r="6" />
    </svg>
  );
}

/** Background colour for the tile that hosts the platform icon. */
export function platformBadgeColor(_platform: string): { bg: string; fg: string } {
  return { bg: "rgba(0, 0, 0, 0.04)", fg: "var(--fg)" };
}
