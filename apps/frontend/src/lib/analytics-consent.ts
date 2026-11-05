"use client";

function cookie(name: string): string {
  if (typeof document === "undefined") return "";
  try {
    const hit = document.cookie.split("; ").find((part) => part.startsWith(name + "="));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
  } catch { return ""; }
}

/** Shared cookie set by the marketing site banner on `.postsider.com`. */
export function analyticsConsent(): boolean {
  return cookie("ps_analytics_consent") === "1";
}

export { cookie as readCookie };
