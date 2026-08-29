import { scoreSlots } from './smart-slots.scoring';

describe('scoreSlots', () => {
  const slots = [
    new Date('2026-06-29T08:00:00Z'), // Mon 08:00
    new Date('2026-06-29T03:00:00Z'), // Mon 03:00
  ];
  it('ranks a heuristic peak hour above an off hour', () => {
    const r = scoreSlots(slots, 'linkedin', null, 2);
    expect(r[0].datetime.getUTCHours()).toBe(8);
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });
  it('returns at most `count` results', () => {
    expect(scoreSlots(slots, 'x', null, 1)).toHaveLength(1);
  });
  it('boosts hours that match the click histogram', () => {
    const hist = Array(24).fill(0); hist[3] = 50;
    const r = scoreSlots(slots, 'linkedin', hist, 2);
    expect(r[0].datetime.getUTCHours()).toBe(3);
  });
  it('scores in the local timezone when an offset is given', () => {
    // UTC+2: the 06:00Z slot is 08:00 local (a linkedin peak) and should win
    // over the 16:00Z slot (18:00 local, off-peak for linkedin).
    const tzSlots = [
      new Date('2026-06-29T16:00:00Z'),
      new Date('2026-06-29T06:00:00Z'),
    ];
    const r = scoreSlots(tzSlots, 'linkedin', null, 2, 120);
    expect(r[0].datetime.getUTCHours()).toBe(6); // 08:00 local peak wins
  });

  it('ranks a shoulder hour between the peak and an off-peak hour (gradient)', () => {
    const s = [
      new Date('2026-06-29T08:00:00Z'), // peak (linkedin 08:00)
      new Date('2026-06-29T09:00:00Z'), // shoulder, 1h from peak
      new Date('2026-06-29T03:00:00Z'), // off-peak
    ];
    const r = scoreSlots(s, 'linkedin', null, 3);
    expect(r.map((x) => x.datetime.getUTCHours())).toEqual([8, 9, 3]);
    expect(r[0].score).toBeGreaterThan(r[1].score);
    expect(r[1].score).toBeGreaterThan(r[2].score);
  });

  it('uses the channel posting day pattern when available', () => {
    const pattern = Array(7 * 24).fill(0);
    pattern[0 * 24 + 12] = 8; // Sunday at noon
    const r = scoreSlots([
      new Date('2026-06-28T12:00:00Z'), // Sunday
      new Date('2026-06-29T12:00:00Z'), // Monday
    ], 'x', null, 2, 0, pattern);

    expect(r[0].datetime.getUTCDay()).toBe(0);
  });

  it('keeps the legacy hourly histogram behavior', () => {
    const histogram = Array(24).fill(0);
    histogram[3] = 50;
    const r = scoreSlots([
      new Date('2026-06-29T03:00:00Z'),
      new Date('2026-06-29T08:00:00Z'),
    ], 'linkedin', histogram, 2);

    expect(r[0].datetime.getUTCHours()).toBe(3);
  });
});
