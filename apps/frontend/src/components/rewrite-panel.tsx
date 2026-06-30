"use client";

import { useState } from "react";
import { rewritePost, RewriteTone } from "@/lib/post-checker-api";

const TONES: { id: RewriteTone; label: string }[] = [
  { id: "rephrase", label: "Rephrase" },
  { id: "shorten", label: "Shorten" },
  { id: "formal", label: "Formal" },
  { id: "casual", label: "Casual" },
  { id: "punchy", label: "Punchy" },
];

interface Props {
  content: string;
  platform?: string;
  onInsert: (variant: string) => void;
  onClose: () => void;
}

export function RewritePanel({ content, platform, onInsert, onClose }: Props) {
  const [tone, setTone] = useState<RewriteTone>("rephrase");
  const [count, setCount] = useState(3);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [variants, setVariants] = useState<string[]>([]);

  const run = async () => {
    setState("loading");
    try {
      const res = await rewritePost({ content, tone, count, platform });
      setVariants(res.variants || []);
      setState("done");
    } catch {
      setState("error");
    }
  };

  const chip = (on: boolean): React.CSSProperties => ({
    padding: "5px 9px",
    borderRadius: 999,
    border: `1px solid ${on ? "var(--fg)" : "var(--line-soft)"}`,
    background: on ? "var(--fg)" : "var(--bg)",
    color: on ? "var(--bg)" : "var(--muted)",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <div style={{ width: 300, flexShrink: 0, border: "1px solid var(--line-soft)", borderRadius: 12, background: "var(--bg)", display: "flex", flexDirection: "column", maxHeight: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--line-soft)" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Caption rewrite</span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", fontSize: 16, lineHeight: 1 }}>×</button>
      </div>

      <div style={{ padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Tone</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {TONES.map((tn) => (
              <button key={tn.id} type="button" style={chip(tone === tn.id)} onClick={() => setTone(tn.id)}>{tn.label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}>
          <span>Variants</span>
          <input type="number" min={1} max={5} value={count} onChange={(e) => setCount(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} style={{ width: 52, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--line-soft)", background: "var(--bg)", color: "var(--fg)", fontSize: 13 }} />
        </div>
        <button type="button" onClick={run} disabled={state === "loading" || content.trim().length === 0} style={{ padding: "9px 14px", borderRadius: 8, border: "none", background: "var(--fg)", color: "var(--bg)", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: content.trim().length === 0 ? 0.5 : 1 }}>
          {state === "loading" ? "Generating…" : "Rewrite"}
        </button>

        {state === "error" && <p style={{ fontSize: 12, color: "#DC2626", margin: 0 }}>Could not generate. Try again.</p>}

        {state === "done" && variants.map((v, i) => (
          <div key={i} style={{ border: "1px solid var(--line-soft)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 13, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{v}</div>
            <button type="button" onClick={() => onInsert(v)} style={{ alignSelf: "flex-start", padding: "5px 10px", borderRadius: 6, border: "1px solid var(--line-soft)", background: "var(--bg)", color: "var(--fg)", fontSize: 12, cursor: "pointer" }}>Use this</button>
          </div>
        ))}
      </div>
    </div>
  );
}
