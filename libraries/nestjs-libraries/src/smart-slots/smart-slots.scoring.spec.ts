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
});
