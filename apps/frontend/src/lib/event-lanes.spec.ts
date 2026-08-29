import {
  buildStackLayout,
  layoutOverlappingEvents,
  mergeExtraByHour,
  offsetBeforeHour,
  STACK_CARD_GAP,
  STACK_CARD_HEIGHT,
} from "./event-lanes";

const ev = (id: string, startMin: number, durationMin = 45) => ({
  id,
  startMin,
  endMin: startMin + durationMin,
});

const HOUR = 56;

describe("layoutOverlappingEvents", () => {
  it("splits a colliding pair into two lanes", () => {
    const p = layoutOverlappingEvents([ev("a", 600), ev("b", 600)]);
    expect(p.get("a")).toEqual({ leftPct: 0, widthPct: 50 });
    expect(p.get("b")).toEqual({ leftPct: 50, widthPct: 50 });
  });

  it("keeps a lone post full width when another hour collides", () => {
    // The regression: lane count used to be counted across the whole day, so
    // one collision at 10:00 shrank every post of that day.
    const p = layoutOverlappingEvents([ev("a", 600), ev("b", 600), ev("solo", 1200)]);
    expect(p.get("solo")).toEqual({ leftPct: 0, widthPct: 100 });
  });

  it("reuses a lane for events that no longer overlap", () => {
    const p = layoutOverlappingEvents([
      ev("a", 600, 30), // 10:00-10:30
      ev("b", 610, 60), // 10:10-11:10, overlaps a
      ev("c", 640, 30), // 10:40-11:10, clear of a, still overlaps b
    ]);
    expect(p.get("a")!.leftPct).toBe(0);
    expect(p.get("c")!.leftPct).toBe(0);
    expect(p.get("b")!.leftPct).toBe(50);
  });
});

describe("buildStackLayout", () => {
  it("stacks the posts of one hour and grows that hour", () => {
    const { placements, extraByHour, totalExtra } = buildStackLayout(
      [ev("a", 600), ev("b", 600)],
      HOUR,
    );
    const a = placements.get("a")!;
    const b = placements.get("b")!;
    expect(a.stacked).toBe(true);
    expect(a.height).toBe(STACK_CARD_HEIGHT);
    expect(b.top - a.top).toBe(STACK_CARD_HEIGHT + STACK_CARD_GAP);
    const needed = 2 * STACK_CARD_HEIGHT + STACK_CARD_GAP;
    expect(extraByHour[10]).toBe(needed - HOUR);
    expect(totalExtra).toBe(needed - HOUR);
  });

  it("leaves a lone post on its minute-precise slot, shifted by earlier hours", () => {
    const { placements, extraByHour } = buildStackLayout(
      [ev("a", 600), ev("b", 600), ev("solo", 780)],
      HOUR,
    );
    const solo = placements.get("solo")!;
    expect(solo.stacked).toBe(false);
    expect(solo.top).toBe((780 / 60) * HOUR + offsetBeforeHour(extraByHour, 13));
  });

  it("only stacks the hours the predicate picks", () => {
    const { placements } = buildStackLayout(
      [ev("a", 600), ev("b", 600), ev("c", 600)],
      HOUR,
      28,
      undefined,
      (count) => count > 3,
    );
    expect(placements.get("a")!.stacked).toBe(false);
  });

  it("lays a day out against a shared, taller table", () => {
    const shared = mergeExtraByHour([[], Array(24).fill(0).map((_, h) => (h === 9 ? 120 : 0))]);
    const { placements } = buildStackLayout([ev("late", 600)], HOUR, 28, shared);
    // Hour 9 grew by 120px on another day, so hour 10 starts 120px lower here.
    expect(placements.get("late")!.top).toBe((600 / 60) * HOUR + 120);
  });
});

describe("mergeExtraByHour", () => {
  it("takes the tallest day per hour", () => {
    const a = Array(24).fill(0);
    a[8] = 40;
    const b = Array(24).fill(0);
    b[8] = 90;
    b[9] = 10;
    const merged = mergeExtraByHour([a, b]);
    expect(merged[8]).toBe(90);
    expect(merged[9]).toBe(10);
  });
});
