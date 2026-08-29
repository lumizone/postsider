// Maps a provider identifier to a preview "family" that determines the chrome
// and media framing used in the composer preview. Pure (no React) so it can be
// unit-tested with the standalone jest config.

export type PreviewFamily =
  | "microblog"
  | "video"
  | "instagram"
  | "linkedin"
  | "facebook"
  | "article"
  | "email"
  | "community";

const MAP: Record<string, PreviewFamily> = {
  x: "microblog",
  twitter: "microblog",
  threads: "microblog",
  bluesky: "microblog",
  mastodon: "microblog",
  "mastodon-custom": "microblog",
  wrapcast: "microblog",
  farcaster: "microblog",
  nostr: "microblog",
  moltbook: "microblog",
  tiktok: "video",
  youtube: "video",
  instagram: "instagram",
  "instagram-standalone": "instagram",
  linkedin: "linkedin",
  "linkedin-page": "linkedin",
  facebook: "facebook",
  medium: "article",
  devto: "article",
  hashnode: "article",
  wordpress: "article",
  ghost: "article",
  notion: "article",
  mataroa: "article",
  writeas: "article",
  blogger: "article",
  listmonk: "email",
  discord: "community",
  slack: "community",
  telegram: "community",
  lemmy: "community",
  whop: "community",
  twitch: "community",
  pinterest: "community",
  dribbble: "community",
  gmb: "community",
};

export function familyFor(identifier: string | null | undefined): PreviewFamily {
  if (!identifier) return "community";
  const id = identifier.toLowerCase();
  if (MAP[id]) return MAP[id];
  // Fall back to the base segment (e.g. "mastodon-custom" -> "mastodon").
  const base = id.split("-")[0];
  return MAP[base] ?? "community";
}
