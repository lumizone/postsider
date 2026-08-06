"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { uploadCsv, CsvImportResult } from "@/lib/csv-import-api";
import { useChannels } from "@/lib/use-channels";

/**
 * Builds the sample CSV from the org's OWN channels.
 *
 * The static /csv-template.csv shipped with placeholder names ("My X Account",
 * "My LinkedIn Page") that match no real org, plus a hardcoded date that is now
 * in the past, so downloading it and uploading it back failed every row. That
 * is the first thing a new user does with the feature.
 *
 * The datetime column is left empty on purpose: the importer drops rows with no
 * datetime into the next free queue slot, which is both the friendliest default
 * and impossible to get wrong.
 */
function buildTemplate(channelNames: string[]): string {
  const sample = channelNames.length
    ? channelNames.slice(0, 2).join(", ")
    : "Your channel name";
  const rows = [
    "content,channels,datetime,first_comment,thread",
    `"Big news! Our summer collection just dropped. Tell us which piece is your favourite.","${sample}",,"Shop the full collection here: https://example.com/summer",`,
    `"Leave datetime empty and this post drops into your next free queue slot.","${sample}",,,`,
  ];
  return rows.join("\n") + "\n";
}

const primaryBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "none",
  background: "var(--fg)",
  color: "var(--bg)",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid var(--line-soft)",
  background: "var(--bg)",
  color: "var(--fg)",
  fontSize: 13,
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-block",
};

export default function CsvImportPage() {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CsvImportResult[] | null>(null);
  const [asDraft, setAsDraft] = useState(false);
  const [importedAsDraft, setImportedAsDraft] = useState(false);
  const { channels } = useChannels();

  const pick = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) {
      setError(t("csvImport.onlyCsv"));
      return;
    }
    setError(null);
    setResults(null);
    setFile(f);
  };

  const onImport = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await uploadCsv(file, asDraft));
      setImportedAsDraft(asDraft);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("csvImport.importFailed"));
    } finally {
      setBusy(false);
    }
  };

  const okCount = results?.filter((r) => r.ok).length ?? 0;
  const errCount = results?.filter((r) => !r.ok).length ?? 0;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 20px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>{t("csvImport.eyebrow")}</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 6px" }}>{t("csvImport.title")}</h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>{t("csvImport.subtitle")}</p>
      </div>

      {error && (
        <div role="alert" style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(192,57,43,0.08)", color: "#c0392b", fontSize: 13 }}>{error}</div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
        style={{
          border: `2px dashed ${dragging ? "var(--fg)" : "var(--line-soft)"}`,
          borderRadius: 14,
          padding: "40px 20px",
          textAlign: "center",
          cursor: "pointer",
          background: dragging ? "rgba(0,0,0,0.02)" : "transparent",
        }}
      >
        <input ref={inputRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => pick(e.target.files?.[0])} />
        <div style={{ fontSize: 14, fontWeight: 600 }}>{file ? file.name : t("csvImport.dropHint")}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>{file ? `${(file.size / 1024).toFixed(1)} KB` : t("csvImport.maxSize")}</div>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={asDraft}
          onChange={(e) => setAsDraft(e.target.checked)}
        />
        {t("csvImport.asDraft")}
      </label>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={{ ...primaryBtn, opacity: file && !busy ? 1 : 0.5, cursor: file && !busy ? "pointer" : "default" }} onClick={onImport} disabled={!file || busy}>
          {busy ? t("csvImport.importing") : t("csvImport.importBtn")}
        </button>
        <button
          type="button"
          style={ghostBtn}
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([buildTemplate(channels.map((c) => c.name))], {
                type: "text/csv;charset=utf-8",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "postsider-template.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          {t("csvImport.downloadTemplate")}
        </button>
        <Link style={ghostBtn} href="/posts">{t("csvImport.backToPosts")}</Link>
      </div>

      <details style={{ fontSize: 13, color: "var(--muted)" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--fg)" }}>{t("csvImport.columnsTitle")}</summary>
        <ul style={{ margin: "10px 0 0", paddingLeft: 18, lineHeight: 1.7 }}>
          <li><b>content</b> ({t("csvImport.colRequired")}) {t("csvImport.colContent")}</li>
          <li><b>channels</b> ({t("csvImport.colRequired")}) {t("csvImport.colChannels")}</li>
          <li><b>datetime</b> {t("csvImport.colDatetime")}</li>
          <li><b>first_comment</b> ({t("csvImport.colOptional")}) {t("csvImport.colFirstComment")}</li>
          <li><b>thread</b> ({t("csvImport.colOptional")}) {t("csvImport.colThread")}</li>
        </ul>
      </details>

      {results && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {errCount
              ? t("csvImport.summaryWithErrors", { ok: okCount, errors: errCount })
              : t("csvImport.summaryOk", { ok: okCount })}
          </div>
          <div style={{ border: "1px solid var(--line-soft)", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 1.4fr", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--line-soft)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted)" }}>
              <span>{t("csvImport.rowHeader")}</span>
              <span>{t("csvImport.statusHeader")}</span>
              <span>{t("csvImport.detailHeader")}</span>
            </div>
            {results.map((r) => (
              <div key={r.row} style={{ display: "grid", gridTemplateColumns: "56px 1fr 1.4fr", gap: 8, padding: "10px 12px", borderBottom: "1px solid rgba(0,0,0,0.05)", fontSize: 13, alignItems: "center" }}>
                <span style={{ color: "var(--muted)" }}>{r.row}</span>
                <span style={{ fontWeight: 600, color: r.ok ? "#15803d" : "#DC2626" }}>{r.ok ? (importedAsDraft ? t("csvImport.statusDraft") : t("csvImport.statusScheduled")) : t("csvImport.statusError")}</span>
                <span style={{ color: "var(--muted)" }}>{r.ok ? `${r.channels ?? ""}${r.scheduledFor ? ` · ${r.scheduledFor.replace("T", " ")}` : ""}` : r.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
