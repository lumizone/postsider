// Minimal RFC-4180 CSV parser (no dependency). Handles quoted fields,
// escaped double-quotes ("" -> "), and both \n and \r\n line endings.

export function parseCSV(input: string): string[][] {
  const s = input.replace(/^﻿/, ''); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      pushField();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // flush the trailing field/row if the file does not end with a newline
  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  // drop fully empty rows
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export interface CsvRecord {
  [header: string]: string;
}

// First row is the header (trimmed + lowercased). Returns the header list and a
// record per data row mapping header -> cell value.
export function rowsToRecords(rows: string[][]): {
  headers: string[];
  records: CsvRecord[];
} {
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).map((r) => {
    const rec: CsvRecord = {};
    headers.forEach((h, idx) => {
      rec[h] = (r[idx] ?? '').trim();
    });
    return rec;
  });
  return { headers, records };
}
