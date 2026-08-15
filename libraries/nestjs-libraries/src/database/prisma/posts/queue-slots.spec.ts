import { slotsForDay, QueueSlot } from './queue-slots';

describe('slotsForDay', () => {
  it('includes a slot only on its configured weekdays', () => {
    const slots: QueueSlot[] = [{ time: 540, days: [1, 2, 3, 4, 5] }];
    expect(slotsForDay(slots, 0)).toEqual([]); // Sunday
    expect(slotsForDay(slots, 1)).toEqual([540]); // Monday
  });

  it('treats a slot with no days as every day (backward compatible)', () => {
    const slots: QueueSlot[] = [{ time: 120 }];
    expect(slotsForDay(slots, 0)).toEqual([120]);
    expect(slotsForDay(slots, 6)).toEqual([120]);
  });

  it('treats an empty days array as every day', () => {
    const slots: QueueSlot[] = [{ time: 300, days: [] }];
    expect(slotsForDay(slots, 3)).toEqual([300]);
  });

  it('returns every applicable slot for the same day', () => {
    const slots: QueueSlot[] = [
      { time: 540, days: [1] },
      { time: 1020, days: [1] },
      { time: 800, days: [2] },
    ];
    expect(slotsForDay(slots, 1)).toEqual([540, 1020]);
  });

  it('returns an empty list when no slot matches the day', () => {
    const slots: QueueSlot[] = [{ time: 540, days: [6] }];
    expect(slotsForDay(slots, 1)).toEqual([]);
  });
});
