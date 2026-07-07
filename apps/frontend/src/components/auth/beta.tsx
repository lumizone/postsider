"use client";

import styles from "./auth.module.css";
import { useT } from "@/lib/i18n";

/**
 * Single switch for the private-beta state of the auth pages. When true:
 * whitelist banner on login, register form replaced by the whitelist card,
 * Google sign-in hidden. Driven by NEXT_PUBLIC_DISABLE_REGISTRATION (baked
 * into the bundle at build time), mirroring the backend's DISABLE_REGISTRATION
 * gate — self-hosted builds without the flag keep open registration.
 */
export const PRIVATE_BETA =
  process.env.NEXT_PUBLIC_DISABLE_REGISTRATION === "true";

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
