/**
 * Generic client-side CSV export — no backend endpoint, works off data
 * already fetched/rendered on screen. Escapes per RFC 4180 (quote fields
 * containing a comma, quote, or newline; double up embedded quotes).
 */
function escapeCsvField(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) =>
    row.map(escapeCsvField).join(","),
  );
  // Leading BOM so Excel opens UTF-8 content (channel names, emoji, etc.)
  // without mangling it.
  return "﻿" + lines.join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
