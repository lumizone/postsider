/**
 * Layout helper for absolutely-positioned calendar events (day/week timeline
 * and the day popup). Events whose time ranges overlap must not stack on top
 * of each other — they get assigned to side-by-side lanes instead.
 */

export interface PositionedEvent {
  /** Unique key (event id). */
  id: string;
  /** Minutes from midnight when the event starts. */
  startMin: number;
  /** Minutes from midnight when the event ends (start + duration). */
  endMin: number;
}

export interface EventLanePlacement {
  /** Left offset as a percentage of the container width. */
  leftPct: number;
  /** Width as a percentage of the container width. */
  widthPct: number;
}

/**
 * Assign each event to a lane so that overlapping events sit side by side
 * (like Google Calendar / Outlook). Non-overlapping events fill earlier lanes
 * first, keeping the layout compact. Returns a map of event id → placement.
 */
export function layoutOverlappingEvents(
  events: PositionedEvent[],
): Map<string, EventLanePlacement> {
  const sorted = [...events].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  );
  // Each lane holds the running end (in minutes) of its last event.
  const laneEnds: number[] = [];
  const laneByEvent = new Map<string, number>();

  for (const ev of sorted) {
    let lane = laneEnds.findIndex((end) => ev.startMin >= end);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(ev.endMin);
    } else {
      laneEnds[lane] = Math.max(laneEnds[lane], ev.endMin);
    }
    laneByEvent.set(ev.id, lane);
  }

  const laneCount = laneEnds.length;
  const placements = new Map<string, EventLanePlacement>();
  for (const ev of sorted) {
    const lane = laneByEvent.get(ev.id) ?? 0;
    placements.set(ev.id, {
      leftPct: (lane / laneCount) * 100,
      widthPct: 100 / laneCount,
    });
  }
  return placements;
}
