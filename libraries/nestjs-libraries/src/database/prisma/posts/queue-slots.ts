// Pure queue-slot helpers shared by the posting-queue feature.
// Kept dependency-free so they can be unit-tested in isolation.

export interface QueueSlot {
  /** Minutes from midnight. */
  time: number;
  /** ISO day numbers (0 = Sunday .. 6 = Saturday). Empty / absent = every day. */
  days?: number[];
}

/**
 * Return the posting-time offsets that apply to a given weekday.
 * A slot with no `days` (or an empty list) applies to every day, which keeps
 * pre-existing day-agnostic posting times working unchanged.
 */
export function slotsForDay(slots: QueueSlot[], dayOfWeek: number): number[] {
  return slots
    .filter((s) => !s.days || s.days.length === 0 || s.days.includes(dayOfWeek))
    .map((s) => s.time);
}
