import { platformWeight } from './smart-slots.heuristics';

export interface RankedSlot { datetime: Date; score: number; }

/**
 * Rank candidate slots for a platform.
 * @param clickHistogram optional 24-length array of click counts by local hour (own data), or null.
 * @param tzOffsetMinutes minutes to add to UTC to reach the audience-local wall clock
 *        (e.g. +120 for UTC+2). Default 0 = score in UTC. The heuristic table is in
 *        local day/hour, so this makes "8am peak" mean 8am local, not 8am UTC.
 */
export function scoreSlots(
  slots: Date[], platform: string, clickHistogram: number[] | null, count: number,
  tzOffsetMinutes = 0,
): RankedSlot[] {
  const total = clickHistogram ? clickHistogram.reduce((a, b) => a + b, 0) : 0;
  const offsetMs = tzOffsetMinutes * 60000;
  const ranked = slots.map((datetime) => {
    const local = new Date(datetime.getTime() + offsetMs);
    const day = local.getUTCDay();
    const hour = local.getUTCHours();
    const heuristic = platformWeight(platform, day, hour);
    let score = heuristic;
    if (total > 0) {
      const ownSignal = (clickHistogram![hour] ?? 0) / total;
      score = 0.5 * heuristic + 0.5 * Math.min(1, ownSignal * 24);
    }
    return { datetime, score: Math.round(score * 1000) / 1000 };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, count);
}
