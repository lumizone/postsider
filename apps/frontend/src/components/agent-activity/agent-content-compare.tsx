"use client";

import { compareDestinations } from "@/lib/agent-text-diff";
import { useT } from "@/lib/i18n";
import s from "./agent-activity.module.css";

interface Props {
  items: Array<{ id: string; name: string; text: string }>;
}

/**
 * Word diff of every destination against the first one. Added words are
 * underlined and removed words struck through, so the change is carried by
 * shape and never by color. All text is rendered as React text.
 */
export function AgentContentCompare({ items }: Props) {
  const t = useT();
  if (items.length < 2) return null;
  const result = compareDestinations(items);

  if (result.identical) {
    return <p className={s.compareNote}>{t("agentActivity.compare.same")}</p>;
  }

  return (
    <div className={s.compare}>
      <p className={s.compareNote}>{t("agentActivity.compare.differs")}</p>
      {result.others.map((other) => (
        <div key={other.id} className={s.compareBlock}>
          <div className={s.compareHead}>
            <strong className={s.compareName}>{other.name}</strong>
            <span className={s.compareAgainst}>
              {t("agentActivity.compare.against", { name: result.baseline.name })}
            </span>
          </div>
          <p className={s.compareText}>
            {other.parts.map((part, i) =>
              part.kind === "added" ? (
                <ins key={i} className={s.diffAdded} title={t("agentActivity.compare.added")}>
                  {part.text}
                </ins>
              ) : part.kind === "removed" ? (
                <del key={i} className={s.diffRemoved} title={t("agentActivity.compare.removed")}>
                  {part.text}
                </del>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </p>
        </div>
      ))}
    </div>
  );
}
