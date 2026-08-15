export type MediaKind = "image" | "video";

export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  /** Bytes. */
  size: number;
  /** Image dimensions for images, frame size for videos. */
  width?: number;
  height?: number;
  /** Seconds for videos. */
  durationSeconds?: number;
  /** ISO date when uploaded. */
  uploadedAt: string;
  /** Channel this asset is associated with, or null if unassigned. */
  channelId: string | null;
}

const NOW = Date.now();
const day = 86_400_000;

export const DEMO_MEDIA: MediaItem[] = [
  {
    id: "m1",
    name: "launch-teaser-cover.jpg",
    kind: "image",
    size: 842_300,
    width: 1920,
    height: 1080,
    uploadedAt: new Date(NOW - 1 * day).toISOString(),
    channelId: "ch-fpv-yt",
  },
  {
    id: "m2",
    name: "product-demo.mp4",
    kind: "video",
    size: 28_400_000,
    width: 1920,
    height: 1080,
    durationSeconds: 47,
    uploadedAt: new Date(NOW - 2 * day).toISOString(),
    channelId: "ch-fpv-tt",
  },
  {
    id: "m3",
    name: "newsletter-header.png",
    kind: "image",
    size: 312_540,
    width: 1200,
    height: 630,
    uploadedAt: new Date(NOW - 3 * day).toISOString(),
    channelId: "ch-fpv-fb",
  },
  {
    id: "m4",
    name: "announcement-thread-1.png",
    kind: "image",
    size: 188_900,
    width: 1080,
    height: 1080,
    uploadedAt: new Date(NOW - 5 * day).toISOString(),
    channelId: "ch-fpv-x",
  },
  {
    id: "m5",
    name: "behind-the-scenes.mov",
    kind: "video",
    size: 64_700_000,
    width: 3840,
    height: 2160,
    durationSeconds: 92,
    uploadedAt: new Date(NOW - 7 * day).toISOString(),
    channelId: "ch-fpv-tt",
  },
  {
    id: "m6",
    name: "team-photo.jpg",
    kind: "image",
    size: 1_280_500,
    width: 2400,
    height: 1600,
    uploadedAt: new Date(NOW - 8 * day).toISOString(),
    channelId: "ch-lukasz-li",
  },
  {
    id: "m7",
    name: "explainer-clip.mp4",
    kind: "video",
    size: 12_300_000,
    width: 1280,
    height: 720,
    durationSeconds: 28,
    uploadedAt: new Date(NOW - 11 * day).toISOString(),
    channelId: "ch-fpv-yt",
  },
  {
    id: "m8",
    name: "logo-mark-black.svg",
    kind: "image",
    size: 8_400,
    uploadedAt: new Date(NOW - 14 * day).toISOString(),
    channelId: null,
  },
  {
    id: "m9",
    name: "case-study-cover.jpg",
    kind: "image",
    size: 564_000,
    width: 1600,
    height: 900,
    uploadedAt: new Date(NOW - 18 * day).toISOString(),
    channelId: "ch-lukasz-li",
  },
  {
    id: "m10",
    name: "ad-cutdown-15s.mp4",
    kind: "video",
    size: 9_200_000,
    width: 1080,
    height: 1920,
    durationSeconds: 15,
    uploadedAt: new Date(NOW - 21 * day).toISOString(),
    channelId: "ch-fpv-tt",
  },
];
