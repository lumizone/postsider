"use client";

import { analyticsConsent } from "@/lib/analytics-consent";

/**
 * Google Analytics 4, strictly opt-in twice over:
 *  1. the operator must set NEXT_PUBLIC_GA_MEASUREMENT_ID at build time
 *     (empty or malformed means the whole feature is off, nothing is loaded);
 *  2. the visitor must have granted the shared `ps_analytics_consent` cookie.
 * No user id, email or org id is ever sent. Page URLs are reduced to the path
 * so query strings (invite tokens, OAuth codes) never leave the browser.
 */
type GtagFn = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
  }
}

const ID_FORMAT = /^G-[A-Z0-9]{6,12}$/;
const LOGIN_GUARD_KEY = "ps-ga-login-sent";
const LOGIN_METHOD_KEY = "ps-ga-login-method";

let initializedFor = "";
let lastPagePath = "";

export function gaMeasurementId(): string {
  // Literal access so Next inlines the build-time value.
  const raw = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "").trim();
  return ID_FORMAT.test(raw) ? raw : "";
}

export function gaEnabled(): boolean {
  return gaMeasurementId() !== "";
}

function cookieDomain(): string {
  if (typeof window === "undefined") return "auto";
  const host = window.location.hostname;
  return host === "postsider.com" || host.endsWith(".postsider.com") ? ".postsider.com" : "auto";
}

/** Loads gtag.js once, only when enabled AND consented. Returns readiness. */
export function ensureGa(): boolean {
  const id = gaMeasurementId();
  if (!id || typeof window === "undefined" || typeof document === "undefined") return false;
  if (!analyticsConsent()) return false;
  if (initializedFor === id && typeof window.gtag === "function") return true;

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = function gtag() {
      // gtag.js requires the real `arguments` object, not an array.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
  }
  const gtag = window.gtag as GtagFn;
  gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500,
  });
  const src = "https://www.googletagmanager.com/gtag/js?id=" + id;
  if (!document.querySelector('script[src="' + src + '"]')) {
    const s = document.createElement("script");
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  }
  gtag("js", new Date());
  gtag("consent", "update", { analytics_storage: "granted" });
  gtag("config", id, {
    send_page_view: false,
    cookie_domain: cookieDomain(),
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  initializedFor = id;
  return true;
}

/** Sends one GA4 event. Returns true when gtag accepted it. */
export function gaEvent(name: string, params: Record<string, string> = {}): boolean {
  if (!ensureGa()) return false;
  try {
    (window.gtag as GtagFn)("event", name, params);
    return true;
  } catch {
    return false;
  }
}

/** GA4 page_view for App Router navigations (path only, never the query). */
export function gaPageView(pathname: string): boolean {
  if (!gaEnabled() || typeof window === "undefined") return false;
  if (pathname === lastPagePath) return false;
  const ok = gaEvent("page_view", {
    page_location: window.location.origin + pathname,
    page_path: pathname,
    page_title: typeof document !== "undefined" ? document.title : "",
  });
  if (ok) lastPagePath = pathname;
  return ok;
}

/** Remember which method started a login that continues on another page (MFA). */
export function rememberLoginMethod(method: string) {
  try { sessionStorage.setItem(LOGIN_METHOD_KEY, method); } catch {}
}

/** Allow the next successful login in this tab to be reported (call on logout). */
export function resetLoginGuard() {
  try {
    sessionStorage.removeItem(LOGIN_GUARD_KEY);
    sessionStorage.removeItem(LOGIN_METHOD_KEY);
  } catch {}
  lastPagePath = "";
}

/**
 * Report one GA4 `login` per sign-in. Call ONLY where a login just succeeded,
 * never on session restore. The sessionStorage guard stops double reports from
 * re-renders or repeated callbacks within the same tab session.
 */
export function trackLogin(method?: string): boolean {
  if (!gaEnabled() || !analyticsConsent()) return false;
  try {
    if (sessionStorage.getItem(LOGIN_GUARD_KEY) === "1") return false;
  } catch {}
  let m = method;
  try { m = m || sessionStorage.getItem(LOGIN_METHOD_KEY) || undefined; } catch {}
  const ok = gaEvent("login", m && /^[a-z_]{2,20}$/.test(m) ? { method: m } : {});
  if (ok) {
    try {
      sessionStorage.setItem(LOGIN_GUARD_KEY, "1");
      sessionStorage.removeItem(LOGIN_METHOD_KEY);
    } catch {}
  }
  return ok;
}

/** Test helper. */
export function __resetGaForTests() {
  initializedFor = "";
  lastPagePath = "";
}
