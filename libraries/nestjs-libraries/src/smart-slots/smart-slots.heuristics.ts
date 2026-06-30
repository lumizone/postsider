export type WeekHourMatrix = number[][]; // [day 0-6 (0=Sun)][hour 0-23] → 0..1

// Smooth weight around peak hours: 1.0 at a peak, tapering toward a floor a few
// hours out (circular over 24h), instead of a hard peak/off-peak step. This gives
// a natural gradient so ranking and tie-breaking are meaningful, and "shoulder"
// hours next to a peak still score well.
const FALLOFF = [1, 0.8, 0.55, 0.3]; // distance 0,1,2,3 hours from nearest peak
const FLOOR = 0.2;

/**
 * Build a 7×24 weight matrix from a platform's local peak hours.
 * @param peaks audience-local peak hours (0-23)
 * @param weekendMul weekend (Sat/Sun) strength relative to weekdays (1 = equal)
 */
const build = (peaks: number[], weekendMul: number): WeekHourMatrix =>
  Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const dist = Math.min(
        ...peaks.map((p) => {
          const raw = Math.abs(h - p);
          return Math.min(raw, 24 - raw); // wrap around midnight
        }),
      );
      const base = dist < FALLOFF.length ? FALLOFF[dist] : FLOOR;
      const dayMul = d === 0 || d === 6 ? weekendMul : 1;
      return Math.round(Math.max(FLOOR, base * dayMul) * 100) / 100;
    }),
  );

// Peak hours + weekend strength per platform, from widely-cited best-time-to-post
// guidance. Weekend-heavy consumer platforms keep ~1; B2B/blog platforms drop on
// weekends. Every registered provider has an entry so suggestions aren't generic.
const DEFAULT = build([8, 12, 18, 20], 0.8);
const TABLES: Record<string, WeekHourMatrix> = {
  // Professional / B2B — weekday business hours, weak weekends.
  linkedin: build([8, 12, 17], 0.4),
  'linkedin-page': build([8, 12, 17], 0.4),
  gmb: build([9, 12, 15], 0.85),

  // Microblogs — frequent, day-long, mild weekend.
  x: build([9, 12, 15, 18, 21], 0.85),
  threads: build([9, 12, 18, 21], 0.9),
  mastodon: build([8, 12, 17, 20], 0.85),
  'mastodon-custom': build([8, 12, 17, 20], 0.85),
  bluesky: build([9, 12, 17, 20], 0.85),
  nostr: build([9, 13, 18, 21], 0.85),
  moltbook: build([9, 13, 18, 21], 0.9),

  // Consumer social — midday + evening, strong weekends.
  facebook: build([9, 13, 15, 20], 0.95),
  instagram: build([11, 13, 19, 21], 1),
  'instagram-standalone': build([11, 13, 19, 21], 1),
  pinterest: build([14, 20, 21], 1),
  dribbble: build([12, 15, 19], 1),

  // Video / streaming — afternoon → late evening, strong weekends.
  tiktok: build([12, 16, 19, 22], 1),
  youtube: build([15, 17, 20, 21], 1),
  twitch: build([16, 19, 21, 23], 1),

  // Community — afternoon/evening, strong weekends.
  discord: build([13, 17, 20, 22], 1),
  telegram: build([9, 12, 18, 20], 0.9),
  whop: build([10, 13, 18, 20], 0.85),
  lemmy: build([9, 13, 18, 21], 0.9),

  // Long-form / blogs — weekday mornings + lunch, weak weekends.
  medium: build([8, 11, 14], 0.6),
  devto: build([8, 11, 14], 0.6),
  hashnode: build([8, 11, 14], 0.6),
  wordpress: build([8, 11, 14], 0.6),
  ghost: build([8, 11, 14], 0.6),
  notion: build([8, 11, 14], 0.6),
  mataroa: build([8, 11, 14], 0.6),
  writeas: build([8, 11, 14], 0.6),
  blogger: build([8, 11, 14], 0.6),

  // Email / newsletter — mid-morning + lunch on weekdays.
  listmonk: build([9, 13], 0.7),
};

export function platformWeight(platform: string, day: number, hour: number): number {
  const m = TABLES[platform?.toLowerCase()] ?? DEFAULT;
  return m[day]?.[hour] ?? 0.5;
}
