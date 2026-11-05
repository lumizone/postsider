"use client";

function cookie(name: string): string {
  if (typeof document === "undefined") return "";
  try {
    const hit = document.cookie.split("; ").find((part) => part.startsWith(name + "="));
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : "";
  } catch { return ""; }
}

/** True on app.postsider.com and any other *.postsider.com host. */
export function isPostsiderHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "postsider.com" || host.endsWith(".postsider.com");
}

/** Cookie shared with the marketing site banner on `.postsider.com`. */
export function analyticsConsent(): boolean {
  return cookie("ps_analytics_consent") === "1";
}

/** Marketing cookies (Google Ads signals): ad_storage and friends. */
export function marketingConsent(): boolean {
  return cookie("ps_marketing_consent") === "1";
}

/** True once the visitor chose (accept or reject) on either site. */
export function consentDecided(): boolean {
  const v = cookie("ps_analytics_consent");
  return v === "1" || v === "0";
}

/** Persist one choice for both analytics and marketing, then notify listeners. */
export function writeConsent(granted: boolean) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const value = granted ? "1" : "0";
  const attrs = "; Path=/; Max-Age=31536000; SameSite=Lax" +
    (window.location.protocol === "https:" ? "; Secure" : "") +
    (isPostsiderHost() ? "; Domain=.postsider.com" : "");
  document.cookie = "ps_analytics_consent=" + value + attrs;
  document.cookie = "ps_marketing_consent=" + value + attrs;
  window.dispatchEvent(new Event("ps:consent"));
}

export { cookie as readCookie };
