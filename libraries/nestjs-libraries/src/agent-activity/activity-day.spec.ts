import { dayBounds, isValidTimeZone, resolveTimeZone } from './activity-day';

const iso = (d: Date) => d.toISOString();

describe('dayBounds', () => {
  it('Warsaw spring forward day is 23 hours', () => {
    const b = dayBounds(new Date('2026-03-29T12:00:00Z'), 'Europe/Warsaw');
    expect(iso(b.start)).toBe('2026-03-28T23:00:00.000Z');
    expect(iso(b.end)).toBe('2026-03-29T22:00:00.000Z');
  });
  it('Warsaw fall back day is 25 hours', () => {
    const b = dayBounds(new Date('2026-10-25T12:00:00Z'), 'Europe/Warsaw');
    expect(iso(b.start)).toBe('2026-10-24T22:00:00.000Z');
    expect(iso(b.end)).toBe('2026-10-25T23:00:00.000Z');
  });
  it('23:30Z in summer Warsaw belongs to the next local day', () => {
    const b = dayBounds(new Date('2026-07-01T23:30:00Z'), 'Europe/Warsaw');
    expect(iso(b.start)).toBe('2026-07-01T22:00:00.000Z');
    expect(iso(b.end)).toBe('2026-07-02T22:00:00.000Z');
  });
  it('UTC', () => {
    const b = dayBounds(new Date('2026-05-10T15:00:00Z'), 'UTC');
    expect(iso(b.start)).toBe('2026-05-10T00:00:00.000Z');
    expect(iso(b.end)).toBe('2026-05-11T00:00:00.000Z');
  });
  it('New York fall back day is 25 hours', () => {
    const b = dayBounds(new Date('2026-11-01T12:00:00Z'), 'America/New_York');
    expect(iso(b.start)).toBe('2026-11-01T04:00:00.000Z');
    expect(iso(b.end)).toBe('2026-11-02T05:00:00.000Z');
  });
  it('now exactly at local midnight starts that day', () => {
    const b = dayBounds(new Date('2026-07-01T22:00:00Z'), 'Europe/Warsaw');
    expect(iso(b.start)).toBe('2026-07-01T22:00:00.000Z');
  });
});

describe('isValidTimeZone', () => {
  it('validates', () => {
    expect(isValidTimeZone('Europe/Warsaw')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(isValidTimeZone(5)).toBe(false);
  });
});

describe('resolveTimeZone', () => {
  it('prefers a valid request, then the org default, then UTC', () => {
    expect(resolveTimeZone('bad', 'Europe/Warsaw')).toBe('Europe/Warsaw');
    expect(resolveTimeZone('bad', null)).toBe('UTC');
    expect(resolveTimeZone('Asia/Tokyo', 'Europe/Warsaw')).toBe('Asia/Tokyo');
    expect(resolveTimeZone(undefined, undefined)).toBe('UTC');
    expect(resolveTimeZone(null, 'nope')).toBe('UTC');
  });
});
