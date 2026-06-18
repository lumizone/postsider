"use client";

import { useEffect } from "react";
import styles from "./add-channel-modal.module.css";
import { PlatformIcon } from "./platform-icon";
import { useT } from "@/lib/i18n";

interface PlatformOption {
  /** Identifier passed back when picked. */
  id: string;
  /** Visible label under the icon. */
  label: string;
  /** Used to look up the brand colour and glyph in `platform-icon.tsx`. */
  iconKey: string;
}

/**
 * All providers wired up in `libraries/nestjs-libraries/src/integrations/social`.
 * Sorted by popularity / how often people are likely to connect them.
 */
const ALL_PLATFORMS: PlatformOption[] = [
  // Tier 1 — mainstream social
  { id: "x", label: "X", iconKey: "X" },
  { id: "instagram", label: "Instagram", iconKey: "Instagram" },
  { id: "facebook", label: "Facebook", iconKey: "Facebook" },
  { id: "tiktok", label: "TikTok", iconKey: "TikTok" },
  { id: "youtube", label: "YouTube", iconKey: "YouTube" },
  { id: "linkedin", label: "LinkedIn", iconKey: "LinkedIn" },
  { id: "linkedin-page", label: "LinkedIn Page", iconKey: "LinkedInPage" },
  { id: "threads", label: "Threads", iconKey: "Threads" },
  {
    id: "instagram-standalone",
    label: "Instagram Personal",
    iconKey: "InstagramStandalone",
  },
  { id: "pinterest", label: "Pinterest", iconKey: "Pinterest" },
  // Reddit hidden for now — re-add when we get to it.
  // { id: "reddit", label: "Reddit", iconKey: "Reddit" },

  // Tier 2 — chat / community
  { id: "discord", label: "Discord", iconKey: "Discord" },
  { id: "slack", label: "Slack", iconKey: "Slack" },
  { id: "telegram", label: "Telegram", iconKey: "Telegram" },

  // Tier 3 — video / streaming
  { id: "twitch", label: "Twitch", iconKey: "Twitch" },
  // Kick hidden until the integration works — re-add when fixed.
  { id: "rumble", label: "Rumble", iconKey: "Rumble" },

  // Tier 4 — alt / federated social
  { id: "bluesky", label: "Bluesky", iconKey: "Bluesky" },
  { id: "mastodon", label: "Mastodon", iconKey: "Mastodon" },
  { id: "wrapcast", label: "Farcaster", iconKey: "Farcaster" },
  { id: "nostr", label: "Nostr", iconKey: "Nostr" },
  { id: "lemmy", label: "Lemmy", iconKey: "Lemmy" },
  // VK hidden for now — re-add when we get to it.
  // { id: "vk", label: "VK", iconKey: "VK" },
  { id: "mewe", label: "MeWe", iconKey: "MeWe" },

  // Tier 5 — productivity / business
  { id: "gmail", label: "Gmail", iconKey: "Gmail" },
  { id: "gmb", label: "Google Business", iconKey: "GoogleBusiness" },
  { id: "blogger", label: "Blogger", iconKey: "Blogger" },
  { id: "notion", label: "Notion", iconKey: "Notion" },
  { id: "listmonk", label: "Listmonk", iconKey: "Listmonk" },

  // Tier 6 — blogging
  { id: "medium", label: "Medium", iconKey: "Medium" },
  { id: "wordpress", label: "WordPress", iconKey: "WordPress" },
  { id: "ghost", label: "Ghost", iconKey: "Ghost" },
  { id: "hashnode", label: "Hashnode", iconKey: "Hashnode" },
  { id: "devto", label: "Dev.to", iconKey: "DevTo" },
  { id: "bear-blog", label: "Bear Blog", iconKey: "BearBlog" },
  { id: "mataroa", label: "Mataroa", iconKey: "Mataroa" },
  { id: "writeas", label: "Write.as", iconKey: "WriteAs" },

  // Tier 7 — design / niche
  { id: "dribbble", label: "Dribbble", iconKey: "Dribbble" },
  { id: "skool", label: "Skool", iconKey: "Skool" },
  { id: "whop", label: "Whop", iconKey: "Whop" },
  { id: "moltbook", label: "Moltbook", iconKey: "Moltbook" },
];

interface AddChannelModalProps {
  onClose: () => void;
  onPick: (platformId: string, label: string) => void;
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function AddChannelModal({ onClose, onPick }: AddChannelModalProps) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t("channels.add")}
      onClick={onClose}
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div>
            <span className={styles.eyebrow}>{t("channels.connect")}</span>
            <span className={styles.title}>{t("channels.add")}</span>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <CloseIcon />
          </button>
        </header>

        <div className={styles.grid}>
          {ALL_PLATFORMS.map((opt) => {
            return (
              <button
                type="button"
                key={opt.id}
                className={styles.tile}
                onClick={() => onPick(opt.id, opt.label)}
                title={opt.label}
              >
                <span className={styles.icon}>
                  <PlatformIcon platform={opt.iconKey} size={42} />
                </span>
                <span className={styles.tileTitle}>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
