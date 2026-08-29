import { z } from 'zod';
import dayjs from 'dayjs';

export const REQUIRED_COLUMNS = ['content', 'channels'] as const;

export const CsvRowSchema = z.object({
  content: z.string().trim().min(1, 'content is required'),
  channels: z.string().trim().min(1, 'channels is required'),
  datetime: z.string().trim().optional().default(''),
  first_comment: z.string().optional().default(''),
  thread: z.string().optional().default(''),
});

export type CsvRowInput = z.infer<typeof CsvRowSchema>;

export interface ResolvedChannel {
  id: string;
  name: string;
}

// Case-insensitive match of comma-separated channel names against the org's
// integrations. Returns matched integrations and any names that did not match.
export function resolveChannels(
  raw: string,
  integrations: ResolvedChannel[]
): { matched: ResolvedChannel[]; missing: string[] } {
  const byName = new Map(integrations.map((i) => [i.name.toLowerCase(), i]));
  const names = raw
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);
  const matched: ResolvedChannel[] = [];
  const missing: string[] = [];
  for (const n of names) {
    const hit = byName.get(n.toLowerCase());
    if (hit) matched.push(hit);
    else missing.push(n);
  }
  return { matched, missing };
}

// Parse a CSV datetime cell. Accepts ISO-8601 or "YYYY-MM-DD HH:mm".
// Returns a normalized "YYYY-MM-DDTHH:mm:00" string, or null when invalid.
export function parseDateTime(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const norm = t.includes('T') ? t : t.replace(' ', 'T');
  const d = dayjs(norm);
  return d.isValid() ? d.format('YYYY-MM-DDTHH:mm:00') : null;
}

// Split a thread cell into its parts on the "|||" delimiter.
export function splitThread(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split('|||')
    .map((p) => p.trim())
    .filter(Boolean);
}
