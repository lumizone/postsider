export interface EvergreenCandidate { id: string; lastRecycledAt: Date | null; }
export function pickNextEvergreen<T extends EvergreenCandidate>(candidates: T[], intervalDays: number, now: Date): T | null {
  const cutoff = now.getTime() - intervalDays * 86_400_000;
  const eligible = candidates.filter((c) => c.lastRecycledAt === null || c.lastRecycledAt.getTime() <= cutoff);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => (a.lastRecycledAt?.getTime() ?? 0) - (b.lastRecycledAt?.getTime() ?? 0));
  return eligible[0];
}
