"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { checkPost, type CheckResults } from "@/lib/post-checker-api";
import styles from "./post-checker-panel.module.css";

type Props = { content: string; hasMedia: boolean; mediaType?: "image" | "video" | "mixed"; platforms: string[]; onClose: () => void; };

export function PostCheckerPanel({ content, hasMedia, mediaType, platforms, onClose }: Props) {
  const t = useT();
  const [state, setState] = useState<"loading" | "done" | "error" | "nokey">("loading");
  const [results, setResults] = useState<CheckResults>({});
  const [active, setActive] = useState(platforms[0]);

  useEffect(() => {
    let cancelled = false;
    checkPost({ content, hasMedia, mediaType, platforms })
      .then((r) => { if (!cancelled) { setResults(r); setState("done"); } })
      .catch((e: any) => { if (!cancelled) setState(e?.status === 409 ? "nokey" : "error"); });
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className={styles.panel}>
      <div className={styles.head}>
        <strong>{t("postChecker.title" as any)}</strong>
        <button onClick={onClose} aria-label={t("common.close" as any)}>×</button>
      </div>
      {state === "loading" && <p className={styles.muted}>{t("postChecker.analysing" as any)}</p>}
      {state === "nokey" && (
        <p className={styles.muted}>{t("postChecker.noKey" as any)} <Link href="/settings/post-checker">{t("postChecker.connectKey" as any)}</Link></p>
      )}
      {state === "error" && <p className={styles.muted}>{t("postChecker.error" as any)}</p>}
      {state === "done" && (
        <>
          {platforms.length > 1 && (
            <div className={styles.tabs}>
              {platforms.map((p) => (
                <button key={p} className={p === active ? styles.tabActive : styles.tab} onClick={() => setActive(p)}>{p}</button>
              ))}
            </div>
          )}
          <Result r={results[active]} t={t as (k: string) => string} />
        </>
      )}
    </aside>
  );
}

function Result({ r, t }: { r: any; t: (k: string) => string }) {
  if (!r) return null;
  if ("error" in r) return <p className={styles.muted}>{t("postChecker.platformError" as any)}</p>;
  const bar = (label: string, v: number) => (
    <div className={styles.bar}><span>{label}</span><div className={styles.track}><div className={styles.fill} style={{ width: `${v}%` }} /></div></div>
  );
  return (
    <div>
      <div className={styles.scoreRow}>
        <div className={styles.ring} style={{ background: `conic-gradient(var(--fg) 0 ${r.score}%, var(--line-soft) ${r.score}% 100%)` }}>
          <div className={styles.ringInner}><b>{r.score}</b><span>/100</span></div>
        </div>
      </div>
      <div className={styles.bars}>
        {bar(t("postChecker.hook" as any), r.dimensions.hook)}
        {bar(t("postChecker.clarity" as any), r.dimensions.clarity)}
        {bar(t("postChecker.cta" as any), r.dimensions.cta)}
        {bar(t("postChecker.platformFit" as any), r.dimensions.platformFit)}
      </div>
      <ul className={styles.good}>{r.positives.map((p: string, i: number) => <li key={i}>+ {p}</li>)}</ul>
      <ul className={styles.bad}>{r.negatives.map((n: string, i: number) => <li key={i}>– {n}</li>)}</ul>
    </div>
  );
}
