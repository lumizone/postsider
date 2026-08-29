/**
 * Layout helpers for absolutely-positioned calendar events (day/week timeline
 * and the day popup).
 *
 * Two layouts live here, because a phone and a desktop want different things
 * from the same overlap:
 *
 * - `layoutOverlappingEvents` — wide screens. Overlapping events sit side by
 *   side in lanes, like Google Calendar.
 * - `buildStackLayout` — narrow screens. Lanes stop being readable well before
 *   they stop fitting (a half-width card in a phone week column is ~40px: an
 *   icon and nothing else), so posts of the same hour stack one under another
 *   at full width and the hour block grows to hold them.
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
 * Group events into clusters of transitively overlapping events. Two events
 * belong to the same cluster when their time ranges touch, directly or through
 * a chain of other events.
 */
function clusterByOverlap(events: PositionedEvent[]): PositionedEvent[][] {
  const sorted = [...events].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  );
  const clusters: PositionedEvent[][] = [];
  let current: PositionedEvent[] = [];
  let clusterEnd = -Infinity;

  for (const ev of sorted) {
    if (current.length > 0 && ev.startMin < clusterEnd) {
      current.push(ev);
      clusterEnd = Math.max(clusterEnd, ev.endMin);
    } else {
      if (current.length > 0) clusters.push(current);
      current = [ev];
      clusterEnd = ev.endMin;
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Assign each event to a lane so that overlapping events sit side by side.
 *
 * Lane count is per CLUSTER, not per day: two posts colliding at 10:00 must not
 * squeeze a lone post at 20:00 down to half width. Non-overlapping events
 * inside a cluster still fill earlier lanes first, keeping the layout compact.
 *
 * Returns a map of event id -> placement.
 */
export function layoutOverlappingEvents(
  events: PositionedEvent[],
): Map<string, EventLanePlacement> {
  const placements = new Map<string, EventLanePlacement>();

  for (const cluster of clusterByOverlap(events)) {
    // Each lane holds the running end (in minutes) of its last event.
    const laneEnds: number[] = [];
    const laneByEvent = new Map<string, number>();

    for (const ev of cluster) {
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
    for (const ev of cluster) {
      const lane = laneByEvent.get(ev.id) ?? 0;
      placements.set(ev.id, {
        leftPct: (lane / laneCount) * 100,
        widthPct: 100 / laneCount,
      });
    }
  }

  return placements;
}

/* ───────── narrow screens: vertical stacking ───────── */

/** Height of one stacked card: icon row + time/channel meta, no clipping. */
export const STACK_CARD_HEIGHT = 52;
/** Vertical gap between two stacked cards. */
export const STACK_CARD_GAP = 4;

export interface StackPlacement {
  /** Top offset in px, inside the timeline. */
  top: number;
  /** Height in px. */
  height: number;
  /** True when this card is part of a stacked group (2+ posts that hour). */
  stacked: boolean;
}

export interface StackLayout {
  /** Event id -> placement. */
  placements: Map<string, StackPlacement>;
  /**
   * Extra px inserted at each hour boundary: `extraByHour[h]` is the space
   * added INSIDE hour `h` to hold its stack. Hour rows and the now-line must
   * shift by `offsetBeforeHour` so the grid stays aligned with the cards.
   */
  extraByHour: number[];
  /** Sum of `extraByHour` — add it to the timeline's own height. */
  totalExtra: number;
}

/** Cumulative extra height inserted before hour `h` starts. */
export function offsetBeforeHour(extraByHour: number[], hour: number): number {
  let sum = 0;
  for (let h = 0; h < hour && h < extraByHour.length; h++) sum += extraByHour[h];
  return sum;
}

/** Same, for an arbitrary minute-of-day (used by the now-line). */
export function offsetAtMinute(extraByHour: number[], minute: number): number {
  return offsetBeforeHour(extraByHour, Math.floor(minute / 60));
}

/**
 * Stack layout for narrow screens.
 *
 * Posts are grouped by their START HOUR — deliberately, not by exact overlap:
 * "everything scheduled for 10:00 sits in the 10:00 block" is the rule a phone
 * user can predict, and it removes the edge case where a non-overlapping post
 * later in the same hour would collide with a grown stack above it. A group of
 * one keeps its minute-precise position and natural height; a group of two or
 * more becomes fixed-height cards stacked from the top of the hour, and the
 * hour block grows by whatever those cards need beyond `hourHeight`.
 *
 * `extraByHour` is returned rather than baked in so a week view can merge the
 * tables of its seven days (take the max per hour) and keep one shared grid.
 */
export function buildStackLayout(
  events: PositionedEvent[],
  hourHeight: number,
  minCardHeight = 28,
  /**
   * Shared per-hour extra table (from `mergeExtraByHour`). A week view lays out
   * each day against the merged table so all seven columns keep one grid; the
   * table is always >= this day's own needs, so cards never overflow their hour.
   */
  extraOverride?: number[],
  /**
   * Which hours stack. Default: any hour holding 2+ posts (the phone rule).
   * Wider layouts pass `(count) => count > maxLanes`, where `maxLanes` comes
   * from the measured column width, so an hour stacks only once lanes would
   * squeeze its cards below a readable width.
   */
  shouldStackHour: (count: number) => boolean = (count) => count >= 2,
): StackLayout {
  const ownExtraByHour = new Array<number>(24).fill(0);
  const byHour = new Map<number, PositionedEvent[]>();

  for (const ev of events) {
    const hour = Math.min(23, Math.max(0, Math.floor(ev.startMin / 60)));
    const list = byHour.get(hour);
    if (list) list.push(ev);
    else byHour.set(hour, [ev]);
  }

  for (const [hour, list] of byHour) {
    if (!shouldStackHour(list.length)) continue;
    const needed =
      list.length * STACK_CARD_HEIGHT + (list.length - 1) * STACK_CARD_GAP;
    ownExtraByHour[hour] = Math.max(0, needed - hourHeight);
  }

  const extraByHour = extraOverride
    ? ownExtraByHour.map((own, h) => Math.max(own, extraOverride[h] ?? 0))
    : ownExtraByHour;

  const placements = new Map<string, StackPlacement>();
  for (const [hour, list] of byHour) {
    const hourTop = hour * hourHeight + offsetBeforeHour(extraByHour, hour);
    if (!shouldStackHour(list.length)) {
      // Not stacked: keep the minute-precise slot, only shifted by whatever
      // earlier hours grew. Lane placement (if any) is the caller's business.
      for (const ev of list) {
        placements.set(ev.id, {
          top:
            (ev.startMin / 60) * hourHeight + offsetBeforeHour(extraByHour, hour),
          height: Math.max(
            ((ev.endMin - ev.startMin) / 60) * hourHeight,
            minCardHeight,
          ),
          stacked: false,
        });
      }
      continue;
    }
    const ordered = [...list].sort(
      (a, b) => a.startMin - b.startMin || a.id.localeCompare(b.id),
    );
    ordered.forEach((ev, i) => {
      placements.set(ev.id, {
        top: hourTop + i * (STACK_CARD_HEIGHT + STACK_CARD_GAP),
        height: STACK_CARD_HEIGHT,
        stacked: true,
      });
    });
  }

  return {
    placements,
    extraByHour,
    totalExtra: extraByHour.reduce((a, b) => a + b, 0),
  };
}

/**
 * Merge the per-hour extra tables of several days into one shared table (the
 * week view keeps a single hour grid across seven columns, so the tallest day
 * dictates every row's height).
 */
export function mergeExtraByHour(tables: number[][]): number[] {
  const merged = new Array<number>(24).fill(0);
  for (const table of tables) {
    for (let h = 0; h < 24; h++) merged[h] = Math.max(merged[h], table[h] ?? 0);
  }
  return merged;
}
