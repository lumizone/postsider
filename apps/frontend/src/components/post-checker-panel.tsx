"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { checkPost, type CheckResults } from "@/lib/post-checker-api";
import { useAuth } from "@/lib/auth-context";
import styles from "./post-checker-panel.module.css";

type Props = { content: string; hasMedia: boolean; mediaType?: "image" | "video" | "mixed"; platforms: string[]; onClose: () => void; };

export function PostCheckerPanel({ content, hasMedia, mediaType, platforms, onClose }: Props) {
  const t = useT();
  const { user, refresh } = useAuth();
  const [state, setState] = useState<"loading" | "done" | "error">("loading");
  const [results, setResults] = useState<CheckResults>({});
  const [active, setActive] = useState(platforms[0]);

  useEffect(() => {
    let cancelled = false;
    checkPost({ content, hasMedia, mediaType, platforms })
      .then((r) => { if (!cancelled) { setResults(r); setState("done"); void refresh(); } })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className={styles.panel}>
      <div className={styles.head}>
        <strong>{t("postChecker.title")}</strong>
        <button onClick={onClose} aria-label={t("common.close")}>×</button>
      </div>
      {state === "loading" && <p className={styles.muted}>{t("postChecker.analysing")}</p>}
      {state === "error" && <p className={styles.muted}>{t("postChecker.error")}</p>}
      {state !== "loading" && user?.aiUsage && <p className={styles.muted}>
        {user.aiUsage.remaining === null ? t("postChecker.unlimitedUses") : t("postChecker.usesRemaining", { count: user.aiUsage.remaining })}
      </p>}
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
  if ("error" in r) return <p className={styles.muted}>{t("postChecker.platformError")}</p>;
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
        {bar(t("postChecker.hook"), r.dimensions.hook)}
        {bar(t("postChecker.clarity"), r.dimensions.clarity)}
        {bar(t("postChecker.cta"), r.dimensions.cta)}
        {bar(t("postChecker.platformFit"), r.dimensions.platformFit)}
      </div>
      <ul className={styles.good}>{r.positives.map((p: string, i: number) => <li key={i}>+ {p}</li>)}</ul>
      <ul className={styles.bad}>{r.negatives.map((n: string, i: number) => <li key={i}>- {n}</li>)}</ul>
    </div>
  );
}
