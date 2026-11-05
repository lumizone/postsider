// Opaque keyset cursor for the group list: base64url JSON { t: ISO, g: group }.

const MAX_GROUP = 100;

export function encodeGroupCursor(c: { updatedAt: Date; group: string }): string {
  return Buffer.from(JSON.stringify({ t: c.updatedAt.toISOString(), g: c.group })).toString(
    'base64url'
  );
}

export function decodeGroupCursor(s: string): { updatedAt: Date; group: string } | null {
  if (typeof s !== 'string' || s.length === 0 || s.length > 1000) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { t, g } = parsed as { t: unknown; g: unknown };
    if (typeof t !== 'string' || typeof g !== 'string') return null;
    if (g.length === 0 || g.length > MAX_GROUP) return null;
    const updatedAt = new Date(t);
    if (Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, group: g };
  } catch {
    return null;
  }
}
