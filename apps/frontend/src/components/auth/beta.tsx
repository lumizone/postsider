"use client";

import styles from "./auth.module.css";
import { useT } from "@/lib/i18n";

/**
 * Single switch for the private-beta state of the auth pages. Flip to false
 * when the beta opens up: brings back Google sign-in and the register form,
 * and drops the whitelist banner. Server-side registration is gated
 * separately by DISABLE_REGISTRATION in the backend env.
 */
export const PRIVATE_BETA = true;

/** The black top-strip shown on the auth pages during the private beta. */
export function BetaBanner() {
  const t = useT();
  return (
    <>
      {t("auth.betaBannerText")}{" "}
      <a
        className={styles.topBannerLink}
        href="https://postsider.com"
        target="_blank"
        rel="noreferrer"
      >
        postsider.com
      </a>{" "}
      {t("auth.betaBannerCta")}
    </>
  );
}
