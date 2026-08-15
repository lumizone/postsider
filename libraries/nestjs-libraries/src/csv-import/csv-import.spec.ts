import { parseCSV, rowsToRecords } from './csv.parser';
import {
  CsvRowSchema,
  parseDateTime,
  resolveChannels,
  splitThread,
} from './csv.validator';

describe('parseCSV', () => {
  it('parses simple comma-separated rows', () => {
    expect(parseCSV('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    expect(parseCSV('content,channels\n"hello, world",X')).toEqual([
      ['content', 'channels'],
      ['hello, world', 'X'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCSV('a\n"she said ""hi"""')).toEqual([['a'], ['she said "hi"']]);
  });

  it('handles CRLF line endings and a trailing newline', () => {
    expect(parseCSV('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('drops fully empty rows', () => {
    expect(parseCSV('a,b\n\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('rowsToRecords', () => {
  it('maps cells to lowercased headers', () => {
    const { headers, records } = rowsToRecords([
      ['Content', 'Channels'],
      ['hi', 'My X'],
    ]);
    expect(headers).toEqual(['content', 'channels']);
    expect(records).toEqual([{ content: 'hi', channels: 'My X' }]);
  });
});

describe('CsvRowSchema', () => {
  it('rejects an empty content', () => {
    expect(CsvRowSchema.safeParse({ content: '', channels: 'X' }).success).toBe(false);
  });
  it('accepts a row with only content + channels', () => {
    const r = CsvRowSchema.safeParse({ content: 'hi', channels: 'X' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.datetime).toBe('');
  });
});

describe('resolveChannels', () => {
  const integrations = [
    { id: 'a', name: 'My Twitter' },
    { id: 'b', name: 'Brand LinkedIn' },
  ];
  it('matches case-insensitively', () => {
    const { matched, missing } = resolveChannels('my twitter', integrations);
    expect(matched.map((m) => m.id)).toEqual(['a']);
    expect(missing).toEqual([]);
  });
  it('reports unmatched names', () => {
    const { matched, missing } = resolveChannels('My Twitter, Ghost', integrations);
    expect(matched.map((m) => m.id)).toEqual(['a']);
    expect(missing).toEqual(['Ghost']);
  });
});

describe('parseDateTime', () => {
  it('normalizes "YYYY-MM-DD HH:mm"', () => {
    expect(parseDateTime('2026-07-01 09:30')).toBe('2026-07-01T09:30:00');
  });
  it('accepts ISO datetimes', () => {
    expect(parseDateTime('2026-07-01T09:30:00')).toBe('2026-07-01T09:30:00');
  });
  it('returns null for garbage', () => {
    expect(parseDateTime('not a date')).toBeNull();
  });
  it('returns null for blank', () => {
    expect(parseDateTime('   ')).toBeNull();
  });
});

describe('splitThread', () => {
  it('splits on the ||| delimiter and trims', () => {
    expect(splitThread('part one ||| part two')).toEqual(['part one', 'part two']);
  });
  it('returns an empty array for blank', () => {
    expect(splitThread('')).toEqual([]);
    expect(splitThread(undefined)).toEqual([]);
  });
});
