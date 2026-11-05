import { planRefresh, refreshDone } from './agent-refresh-plan';

describe('planRefresh', () => {
  it('uses the page size when nothing or little is loaded', () => {
    expect(planRefresh(0, 25)).toEqual({ limit: 25, target: 25 });
    expect(planRefresh(10, 25)).toEqual({ limit: 25, target: 25 });
  });

  it('keeps the loaded count as the target and caps each request at 50', () => {
    expect(planRefresh(40, 25)).toEqual({ limit: 40, target: 40 });
    expect(planRefresh(120, 25)).toEqual({ limit: 50, target: 120 });
  });

  it('bounds the target at 200 rows', () => {
    expect(planRefresh(500, 25)).toEqual({ limit: 50, target: 200 });
  });
});

describe('refreshDone', () => {
  it('stops without a cursor, at the target, or at the page bound', () => {
    expect(refreshDone({ fetched: 25, target: 100, cursor: null, pages: 1 })).toBe(true);
    expect(refreshDone({ fetched: 100, target: 100, cursor: 'c', pages: 2 })).toBe(true);
    expect(refreshDone({ fetched: 50, target: 100, cursor: 'c', pages: 8 })).toBe(true);
    expect(refreshDone({ fetched: 50, target: 100, cursor: 'c', pages: 1 })).toBe(false);
  });
});
