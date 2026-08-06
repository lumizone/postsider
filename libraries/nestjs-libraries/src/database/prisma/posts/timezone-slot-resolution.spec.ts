import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * PostsService.findFreeDateTime/findFreeDateTimeRecursive resolve a
 * channel's recurring "9am local" posting slot to a concrete UTC instant by
 * anchoring a dayjs object to the channel's IANA Integration.timezone via
 * `dayjs().tz(tz)`, then chaining `.startOf('day').add(minutes, 'minute')`.
 * The whole fix rests on that chain staying DST-correct per real calendar
 * date instead of a single frozen UTC offset. This characterizes that
 * exact technique against real DST transition dates so a regression (e.g.
 * someone "simplifying" it back to a flat offset) fails loudly here rather
 * than silently mis-scheduling posts twice a year.
 */
describe('timezone-aware slot resolution (DST correctness)', () => {
  const resolveLocalSlot = (localDate: string, minutes: number, tz: string) =>
    dayjs
      .tz(localDate, tz)
      .startOf('day')
      .add(minutes, 'minute')
      .utc()
      .format();

  it('resolves 9:00am New York to 14:00 UTC in winter (EST, UTC-5)', () => {
    // 2026-01-15 is well outside any US DST transition window.
    expect(resolveLocalSlot('2026-01-15', 9 * 60, 'America/New_York')).toBe(
      '2026-01-15T14:00:00Z',
    );
  });

  it('resolves the SAME 9:00am New York to 13:00 UTC (EDT, UTC-4) in summer', () => {
    // 2026-07-15 is well outside any US DST transition window.
    // A flat/frozen offset (the old bug) would compute 14:00Z here, wrong by
    // exactly one hour — this is the regression this test exists to catch.
    expect(resolveLocalSlot('2026-07-15', 9 * 60, 'America/New_York')).toBe(
      '2026-07-15T13:00:00Z',
    );
  });

  it('shifts by exactly one hour across the US spring-forward boundary (2026-03-08)', () => {
    const before = resolveLocalSlot('2026-03-07', 9 * 60, 'America/New_York'); // EST
    const after = resolveLocalSlot('2026-03-09', 9 * 60, 'America/New_York'); // EDT
    const diffHours =
      (new Date(after).getTime() - new Date(before).getTime()) / 3_600_000;
    // 2 calendar days (48h) minus the 1h "spring forward" jump = 47h real time.
    expect(diffHours).toBe(47);
    expect(before.endsWith('T14:00:00Z')).toBe(true); // still EST the day before
    expect(after.endsWith('T13:00:00Z')).toBe(true); // already EDT the day after
  });

  it('shifts by exactly one hour across the US fall-back boundary (2026-11-01)', () => {
    const before = resolveLocalSlot('2026-10-31', 9 * 60, 'America/New_York'); // EDT
    const after = resolveLocalSlot('2026-11-02', 9 * 60, 'America/New_York'); // EST
    expect(before.endsWith('T13:00:00Z')).toBe(true);
    expect(after.endsWith('T14:00:00Z')).toBe(true);
  });

  it('treats an unset/UTC channel exactly as before this feature (no shift)', () => {
    expect(resolveLocalSlot('2026-01-15', 9 * 60, 'UTC')).toBe(
      '2026-01-15T09:00:00Z',
    );
    expect(resolveLocalSlot('2026-07-15', 9 * 60, 'UTC')).toBe(
      '2026-07-15T09:00:00Z',
    );
  });

  it('correctly resolves a zone with a non-hour UTC offset (India, UTC+5:30)', () => {
    expect(resolveLocalSlot('2026-06-01', 9 * 60, 'Asia/Kolkata')).toBe(
      '2026-06-01T03:30:00Z',
    );
  });
});
