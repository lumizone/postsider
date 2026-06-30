export type WeekHourMatrix = number[][]; // [day 0-6 (0=Sun)][hour 0-23] → 0..1

const peak = (hours: number[], wknd = false): WeekHourMatrix =>
  Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const base = hours.includes(h) ? 1 : 0.45;
      const dayMul = d === 0 || d === 6 ? (wknd ? 1 : 0.7) : 1;
      return Math.round(base * dayMul * 100) / 100;
    }),
  );

const DEFAULT = peak([8, 12, 18, 20]);
const TABLES: Record<string, WeekHourMatrix> = {
  linkedin: peak([8, 12, 17]),
  x: peak([9, 12, 15, 18, 21]),
  instagram: peak([11, 13, 19, 21], true),
  facebook: peak([9, 13, 15, 20], true),
  tiktok: peak([12, 16, 19, 22], true),
};

export function platformWeight(platform: string, day: number, hour: number): number {
  const m = TABLES[platform?.toLowerCase()] ?? DEFAULT;
  return m[day]?.[hour] ?? 0.5;
}
