/**
 * Per-platform copy for analytics so each channel uses its native vocabulary
 * (Views vs Impressions vs Reach, Subscribers vs Followers, etc.).
 */

export interface PlatformLabels {
  /** Label for the "reach" metric (Impressions / Views / Reach...). */
  impressionsLabel: string;
  /** Label for the engagement metric (Likes + comments + shares, Reactions...). */
  engagementsLabel: string;
  /** Label for outbound clicks (Clicks / Link clicks / Profile visits...). */
  clicksLabel: string;
  /** Label for the audience metric (Subscribers / Followers / Page likes). */
  audienceLabel: string;
  /** Plural noun for the content unit (post / video / tweet). */
  postNoun: string;
  /** Whether the engagement-rate ratio makes sense to display for this platform. */
  showEngagementRate: boolean;
}

const DEFAULT: PlatformLabels = {
  impressionsLabel: "Impressions",
  engagementsLabel: "Engagements",
  clicksLabel: "Clicks",
  audienceLabel: "Followers",
  postNoun: "posts",
  showEngagementRate: true,
};

const TABLE: Record<string, PlatformLabels> = {
  YouTube: {
    impressionsLabel: "Views",
    engagementsLabel: "Likes",
    clicksLabel: "Subscribers gained",
    audienceLabel: "Subscribers",
    postNoun: "videos",
    showEngagementRate: true,
  },
  Facebook: {
    impressionsLabel: "Reach",
    engagementsLabel: "Reactions",
    clicksLabel: "Link clicks",
    audienceLabel: "Page likes",
    postNoun: "posts",
    showEngagementRate: true,
  },
  LinkedIn: {
    impressionsLabel: "Impressions",
    engagementsLabel: "Reactions",
    clicksLabel: "Clicks",
    audienceLabel: "Followers",
    postNoun: "posts",
    showEngagementRate: true,
  },
  X: {
    impressionsLabel: "Impressions",
    engagementsLabel: "Engagements",
    clicksLabel: "Profile visits",
    audienceLabel: "Followers",
    postNoun: "tweets",
    showEngagementRate: true,
  },
  TikTok: {
    impressionsLabel: "Views",
    engagementsLabel: "Likes",
    clicksLabel: "Profile views",
    audienceLabel: "Followers",
    postNoun: "videos",
    showEngagementRate: true,
  },
  Instagram: {
    impressionsLabel: "Impressions",
    engagementsLabel: "Likes & comments",
    clicksLabel: "Profile visits",
    audienceLabel: "Followers",
    postNoun: "posts",
    showEngagementRate: true,
  },
};

export function platformLabels(platform: string): PlatformLabels {
  return TABLE[platform] ?? DEFAULT;
}
