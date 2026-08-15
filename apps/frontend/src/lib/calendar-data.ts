/**
 * Demo data layer for the calendar. Wire to the backend API later.
 */

export interface ChannelAudienceSnapshot {
  date: string; // YYYY-MM-DD
  total: number;
}

export interface Channel {
  id: string;
  name: string;
  platform:
    | "YouTube"
    | "Facebook"
    | "LinkedIn"
    | "X"
    | "TikTok"
    | "Instagram"
    | string;
  /**
   * Backend provider identifier (e.g. "tiktok", "linkedin-page",
   * "instagram-standalone"). Drives per-provider posting requirements and
   * settings fields. Optional because demo channels don't carry it.
   */
  identifier?: string;
  /**
   * Whether the account is verified / premium (currently used for X, where
   * premium accounts get a higher character limit).
   */
  verified?: boolean;
  /** Calendar accent colour. Plain hex string. */
  color: string;
  /** Profile picture from the connected account, or null when unavailable. */
  avatarUrl?: string | null;
  /** Current audience size (subscribers / followers / page likes). */
  audience: number;
  /** Daily snapshots for the last 90 days, oldest → newest. */
  audienceHistory: ChannelAudienceSnapshot[];
}

export const CHANNEL_COLOR_PALETTE: { value: string; label: string }[] = [
  { value: "#0F0F0F", label: "Ink" },
  { value: "#737373", label: "Graphite" },
  { value: "#2563EB", label: "Blue" },
  { value: "#0EA5E9", label: "Sky" },
  { value: "#10B981", label: "Emerald" },
  { value: "#84CC16", label: "Lime" },
  { value: "#F59E0B", label: "Amber" },
  { value: "#EF4444", label: "Red" },
  { value: "#EC4899", label: "Pink" },
  { value: "#8B5CF6", label: "Violet" },
];

export type PostStatus = "draft" | "scheduled" | "published" | "failed" | "pendingApproval";

export interface CalendarEvent {
  id: string;
  channelId: string;
  date: string; // YYYY-MM-DD (local) — empty string means draft has no scheduled date
  time: string; // HH:mm
  durationMinutes?: number;
  title: string;
  /** Optional excerpt / first line of the post body. */
  excerpt?: string;
  /** Whether the post has been published already (true) or is still scheduled. */
  published?: boolean;
  /** Explicit lifecycle status. Falls back to derived state if missing. */
  status?: PostStatus;
  /** Post group ID — used for duplicating, editing, and deleting. */
  group: string;
  /** Engagement metrics — only meaningful for published posts. */
  metrics?: {
    impressions: number;
    engagements: number;
    clicks: number;
  };
  /** Approval status — only set when the post has an active PostApproval row. */
  approvalStatus?: "pending" | "approved" | "rejected";
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

const PLATFORM_AUDIENCE_BASE: Record<string, number> = {
  YouTube: 12_400,
  Facebook: 3_800,
  LinkedIn: 2_150,
  X: 5_900,
  TikTok: 18_700,
};

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function buildAudienceHistory(
  channelId: string,
  platform: string,
): ChannelAudienceSnapshot[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = PLATFORM_AUDIENCE_BASE[platform] ?? 1_000;
  const seed = hashSeed(channelId);
  // Daily growth between 0.05% and 0.35%.
  const dailyGrowth = 0.0005 + ((seed % 30) / 10_000);

  const out: ChannelAudienceSnapshot[] = [];
  let value = base;
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    // Add a tiny day-to-day wiggle for visual life, deterministic per (channel,day).
    const noise = ((hashSeed(channelId + i) % 11) - 5) / 1000; // ±0.5%
    out.push({ date: iso(d), total: Math.round(value * (1 + noise)) });
    value = value / (1 + dailyGrowth);
  }
  return out.reverse();
}

const RAW_CHANNELS: Omit<Channel, "audience" | "audienceHistory">[] = [
  {
    id: "ch-fpv-yt",
    name: "First Person View",
    platform: "YouTube",
    color: "#EF4444",
    avatarUrl: "https://i.pravatar.cc/96?u=ch-fpv-yt",
  },
  {
    id: "ch-fpv-fb",
    name: "FPV",
    platform: "Facebook",
    color: "#2563EB",
    avatarUrl: "https://i.pravatar.cc/96?u=ch-fpv-fb",
  },
  {
    id: "ch-lukasz-li",
    name: "Łukasz Blania",
    platform: "LinkedIn",
    color: "#0EA5E9",
    avatarUrl: "https://i.pravatar.cc/96?u=ch-lukasz-li",
  },
  {
    id: "ch-fpv-x",
    name: "FPV",
    platform: "X",
    color: "#0F0F0F",
    avatarUrl: "https://i.pravatar.cc/96?u=ch-fpv-x",
  },
  {
    id: "ch-fpv-tt",
    name: "First Person View",
    platform: "TikTok",
    color: "#EC4899",
    avatarUrl: "https://i.pravatar.cc/96?u=ch-fpv-tt",
  },
];

export const DEMO_CHANNELS: Channel[] = RAW_CHANNELS.map((c) => {
  const history = buildAudienceHistory(c.id, c.platform);
  return {
    ...c,
    audience: history[history.length - 1].total,
    audienceHistory: history,
  };
});

export const DEMO_EVENTS: CalendarEvent[] = (() => {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  const ch = DEMO_CHANNELS.map((c) => c.id);

  // Build a 30-day published-history backwards from yesterday so the analytics
  // page has signal to graph. Mix of channels with stable but different shapes.
  const history: CalendarEvent[] = [];
  for (let i = 30; i >= 1; i--) {
    const day = new Date(y, m, d - i);
    const date = iso(day);
    // Two posts per day on rotating channels, with deterministic-ish metrics.
    const seed = (day.getDate() + day.getMonth() * 31) % 7;
    const ch1 = ch[(i + seed) % ch.length];
    const ch2 = ch[(i + 3 + seed) % ch.length];
    history.push({
      id: `h-${i}-a`,
      channelId: ch1,
      date,
      time: "09:00",
      durationMinutes: 30,
      title: pickHistoryTitle(i, "morning"),
      published: true,
      group: `h-${i}-a`,
      metrics: makeMetrics(i, seed, ch1),
    });
    if (i % 2 === 0) {
      history.push({
        id: `h-${i}-b`,
        channelId: ch2,
        date,
        time: "18:30",
        durationMinutes: 30,
        title: pickHistoryTitle(i, "evening"),
        published: true,
        group: `h-${i}-b`,
        metrics: makeMetrics(i + 1, seed + 1, ch2),
      });
    }
  }

  const upcoming: CalendarEvent[] = [
    { id: "e1", channelId: ch[0], date: iso(new Date(y, m, 4)), time: "09:00", durationMinutes: 30, title: "Launch teaser", status: "scheduled", group: "e1", excerpt: "Get ready — something big drops this week." },
    { id: "e2", channelId: ch[2], date: iso(new Date(y, m, 4)), time: "18:30", durationMinutes: 30, title: "Product update", status: "scheduled", group: "e2", excerpt: "v1.4 is here. Here's what changed." },
    { id: "e3", channelId: ch[1], date: iso(new Date(y, m, 12)), time: "10:00", durationMinutes: 60, title: "Newsletter", status: "scheduled", group: "e3", excerpt: "Monthly roundup for our subscribers." },
    { id: "e4", channelId: ch[3], date: iso(new Date(y, m, 12)), time: "14:00", durationMinutes: 30, title: "X thread", status: "scheduled", group: "e4", excerpt: "8 lessons from shipping a side project." },
    { id: "e5", channelId: ch[2], date: iso(new Date(y, m, 12)), time: "20:00", durationMinutes: 45, title: "LinkedIn post", status: "scheduled", group: "e5", excerpt: "Why we picked NestJS for the backend." },
    { id: "e6", channelId: ch[0], date: iso(new Date(y, m, d)), time: "09:00", durationMinutes: 60, title: "Morning recap", status: "scheduled", group: "e6", excerpt: "Three things to read before lunch." },
    { id: "e7", channelId: ch[4], date: iso(new Date(y, m, d)), time: "12:00", durationMinutes: 45, title: "Today's post", status: "scheduled", group: "e7", excerpt: "Quick BTS clip from the studio." },
    { id: "e8", channelId: ch[3], date: iso(new Date(y, m, d)), time: "16:30", durationMinutes: 30, title: "Reply campaign", status: "scheduled", group: "e8", excerpt: "Replying to top community questions." },
    { id: "e9", channelId: ch[1], date: iso(new Date(y, m, 22)), time: "08:00", durationMinutes: 30, title: "Recap mail", status: "scheduled", group: "e9", excerpt: "Weekly wrap-up for subscribers." },
  ];

  const drafts: CalendarEvent[] = [
    { id: "d1", channelId: ch[2], date: "", time: "", title: "Hiring announcement", status: "draft", group: "d1", excerpt: "Looking for senior engineers — long form post." },
    { id: "d2", channelId: ch[3], date: "", time: "", title: "Year in review (draft)", status: "draft", group: "d2", excerpt: "Threads style breakdown of 12 months." },
    { id: "d3", channelId: ch[0], date: "", time: "", title: "Tutorial: Self-hosting", status: "draft", group: "d3" },
  ];

  const failed: CalendarEvent[] = [
    {
      id: "f1",
      channelId: ch[4],
      date: iso(new Date(y, m, d - 1)),
      time: "10:30",
      durationMinutes: 30,
      title: "Yesterday's clip",
      status: "failed",
      group: "f1",
      excerpt: "Failed to publish: TikTok rejected the upload — duration too short.",
    },
  ];

  // Mark history as explicitly published.
  for (const ev of history) ev.status = "published";

  return [...history, ...upcoming, ...drafts, ...failed];
})();

function pickHistoryTitle(i: number, slot: "morning" | "evening"): string {
  const m = [
    "Daily digest",
    "Behind the scenes",
    "Customer story",
    "Tips thread",
    "Weekly recap",
    "Quick tip",
    "Community shoutout",
  ];
  const e = [
    "Evening highlights",
    "What we shipped",
    "Live Q&A recap",
    "Numbers we love",
    "Product changelog",
    "Late-night thoughts",
    "Long-form essay",
  ];
  const pool = slot === "morning" ? m : e;
  return pool[i % pool.length];
}

function makeMetrics(i: number, seed: number, channelId: string) {
  // Pseudo-deterministic metrics so charts look stable across renders/SSR.
  const base = 800 + ((i * 47 + seed * 13) % 1400);
  const channelBoost =
    channelId.endsWith("-yt") ? 2.4 :
    channelId.endsWith("-li") ? 1.6 :
    channelId.endsWith("-x") ? 1.2 :
    channelId.endsWith("-tt") ? 2.1 :
    1.0;
  const impressions = Math.round(base * channelBoost);
  const engagementRate = 0.04 + ((i * 11 + seed * 7) % 60) / 1000; // 4–10%
  const engagements = Math.round(impressions * engagementRate);
  const clickRate = 0.012 + ((i * 5 + seed * 3) % 30) / 1500;
  const clicks = Math.round(impressions * clickRate);
  return { impressions, engagements, clicks };
}
