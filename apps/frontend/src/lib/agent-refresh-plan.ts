// Pure plan for a same-filter refresh: refetch as many rows as were loaded.
export const MAX_REFRESH_ROWS = 200;
export const MAX_REFRESH_PAGES = 8;
const MAX_LIMIT = 50;

export function planRefresh(loadedCount: number, pageSize: number): { limit: number; target: number } {
  const target = Math.min(MAX_REFRESH_ROWS, Math.max(pageSize, loadedCount));
  return { limit: Math.min(MAX_LIMIT, target), target };
}

export function refreshDone(s: { fetched: number; target: number; cursor: string | null; pages: number }): boolean {
  return s.cursor === null || s.fetched >= s.target || s.pages >= MAX_REFRESH_PAGES;
}
