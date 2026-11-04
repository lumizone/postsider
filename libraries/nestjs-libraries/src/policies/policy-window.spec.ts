import { wallClock, isInsideWindow, dayBounds } from './policy-window';

const W = 'Europe/Warsaw';
const d = (s: string) => new Date(s);
const hours = (b: { start: Date; end: Date }) => (b.end.getTime() - b.start.getTime()) / 3600000;

describe('wallClock', () => {
  it('reads local day and minutes', () => {
    expect(wallClock(d('2026-03-29T00:30:00Z'), W)).toEqual({ day: 0, minutes: 90 });
  });
  it('skips the nonexistent spring-forward hour', () => {
    expect(wallClock(d('2026-03-29T01:30:00Z'), W).minutes).toBe(210);
  });
  it('repeats the fall-back hour', () => {
    expect(wallClock(d('2026-10-25T00:30:00Z'), W).minutes).toBe(150);
    expect(wallClock(d('2026-10-25T01:30:00Z'), W).minutes).toBe(150);
  });
});

describe('isInsideWindow', () => {
  const work = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', timezone: W };
  it('weekday window with exclusive end', () => {
    expect(isInsideWindow(d('2026-11-02T08:00:00Z'), work)).toBe(true);
    expect(isInsideWindow(d('2026-11-02T15:59:00Z'), work)).toBe(true);
    expect(isInsideWindow(d('2026-11-02T16:00:00Z'), work)).toBe(false);
    expect(isInsideWindow(d('2026-11-02T07:59:00Z'), work)).toBe(false);
    expect(isInsideWindow(d('2026-11-07T09:00:00Z'), work)).toBe(false);
  });
  it('overnight window belongs to the starting day', () => {
    const night = { days: [5], start: '22:00', end: '06:00', timezone: 'UTC' };
    expect(isInsideWindow(d('2026-11-06T23:00:00Z'), night)).toBe(true);
    expect(isInsideWindow(d('2026-11-07T05:59:00Z'), night)).toBe(true);
    expect(isInsideWindow(d('2026-11-07T06:00:00Z'), night)).toBe(false);
    expect(isInsideWindow(d('2026-11-07T23:00:00Z'), night)).toBe(false);
  });
});

describe('dayBounds', () => {
  it('handles DST lengths', () => {
    expect(hours(dayBounds(d('2026-03-29T12:00:00Z'), W))).toBe(23);
    expect(hours(dayBounds(d('2026-10-25T12:00:00Z'), W))).toBe(25);
    expect(hours(dayBounds(d('2026-11-02T12:00:00Z'), W))).toBe(24);
  });
  it('starts at local midnight', () => {
    expect(dayBounds(d('2026-11-02T12:00:00Z'), W).start.toISOString()).toBe('2026-11-01T23:00:00.000Z');
    expect(dayBounds(d('2026-03-29T12:00:00Z'), W).start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
  });
  it('UTC bounds', () => {
    const b = dayBounds(d('2026-11-02T13:14:15Z'), 'UTC');
    expect(b.start.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(b.end.toISOString()).toBe('2026-11-03T00:00:00.000Z');
  });
  it('end is exclusive at the millisecond', () => {
    const last = new Date(dayBounds(d('2026-11-02T12:00:00Z'), W).end.getTime() - 1);
    expect(dayBounds(last, W).start.toISOString()).toBe('2026-11-01T23:00:00.000Z');
    const next = new Date(last.getTime() + 1);
    expect(dayBounds(next, W).start.toISOString()).toBe('2026-11-02T23:00:00.000Z');
  });
});
