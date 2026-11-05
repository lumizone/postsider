"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n";
import { isPolicyInputTooLarge, parsePolicyBlocked } from "@/lib/policy-errors";
import s from "./policy-notice.module.css";

type Translate = ReturnType<typeof useT>;

export const POLICY_NOTICE_MS = 10_000;

/**
 * Localized text for a policy refusal thrown by a dashboard write (422
 * policy_blocked, 400 policy_input_too_large), or null when the error is
 * anything else. Rule names are server data and are rendered as plain text.
 */
export function policyErrorMessage(t: Translate, err: unknown): string | null {
  const body = (err as { body?: unknown } | null | undefined)?.body;
  const blocked = parsePolicyBlocked(body);
  if (blocked) {
    return blocked.ruleNames.length > 0
      ? t("createPost.policyBlocked", { rules: blocked.ruleNames.join(", ") })
      : t("createPost.policyBlockedNoRules");
  }
  if (isPolicyInputTooLarge(body)) return t("createPost.policyInputTooLarge");
  return null;
}

interface PolicyNoticeProps {
  /** Overrides the default "sent for approval" text. */
  message?: string;
  onClose: () => void;
}

/** Monochrome, dismissable banner shown after a policy sent a post to approval. */
export function PolicyNotice({ message, onClose }: PolicyNoticeProps) {
  const t = useT();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = window.setTimeout(() => closeRef.current(), POLICY_NOTICE_MS);
    // Cleared on unmount so a closed page never calls back into old state.
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div role="status" className={s.notice}>
      <span className={s.text}>{message ?? t("createPost.policyApprovalSent")}</span>
      <Link href="/approval" className={s.link}>
        {t("nav.approval")}
      </Link>
      <button type="button" className={s.close} aria-label={t("common.dismiss")} onClick={onClose}>
        {"\u00D7"}
      </button>
    </div>
  );
}
