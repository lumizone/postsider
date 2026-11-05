"use client";

import { isPostsiderHost, analyticsConsent, marketingConsent } from "@/lib/analytics-consent";

/**
 * Google Analytics 4 + Google Ads in Consent Mode v2 (advanced mode).
 *  - gtag.js loads for everyone when an id resolves; cookies and identifiers
 *    are only allowed once the visitor grants consent (default: denied).
 *  - Ids: build-time env value, else the hosted default but ONLY on
 *    app.postsider.com, so forks never report into our property.
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
const ADS_FORMAT = /^AW-\d{6,14}$/;
const HOSTED_HOST = "app.postsider.com";
const HOSTED_GA_ID = "G-72MBFGEQRR";
const HOSTED_ADS_ID = "AW-18533590201";
const LOGIN_GUARD_KEY = "ps-ga-login-sent";
const LOGIN_METHOD_KEY = "ps-ga-login-method";
const SIGNUP_GUARD_KEY = "ps-ga-signup-sent";

let initializedFor = "";
let lastPagePath = "";

function onHostedHost(): boolean {
  return typeof window !== "undefined" && window.location.hostname === HOSTED_HOST;
}

export function gaMeasurementId(): string {
  // Literal access so Next inlines the build-time value.
  const raw = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "").trim();
  if (ID_FORMAT.test(raw)) return raw;
  return onHostedHost() ? HOSTED_GA_ID : "";
}

export function googleAdsId(): string {
  const raw = (process.env.NEXT_PUBLIC_GOOGLE_ADS_ID || "").trim();
  if (ADS_FORMAT.test(raw)) return raw;
  return onHostedHost() ? HOSTED_ADS_ID : "";
}

export function gaEnabled(): boolean {
  return gaMeasurementId() !== "";
}

function cookieDomain(): string {
  return isPostsiderHost() ? ".postsider.com" : "auto";
}

function consentState() {
  const analytics = analyticsConsent() ? "granted" : "denied";
  const marketing = marketingConsent() ? "granted" : "denied";
  return {
    analytics_storage: analytics,
    ad_storage: marketing,
    ad_user_data: marketing,
    ad_personalization: marketing,
  };
}

/** Loads gtag.js once when an id resolves (any consent state). Returns readiness. */
export function ensureGa(): boolean {
  const id = gaMeasurementId();
  if (!id || typeof window === "undefined" || typeof document === "undefined") return false;
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
  gtag("consent", "default", { ...consentState(), wait_for_update: 500 });
  const src = "https://www.googletagmanager.com/gtag/js?id=" + id;
  if (!document.querySelector('script[src="' + src + '"]')) {
    const s = document.createElement("script");
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  }
  gtag("js", new Date());
  gtag("config", id, {
    send_page_view: false,
    cookie_domain: cookieDomain(),
  });
  const adsId = googleAdsId();
  if (adsId) gtag("config", adsId);
  initializedFor = id;
  return true;
}

/** Push the current cookie choice to gtag (call after the visitor decides). */
export function updateGaConsent(): boolean {
  if (!ensureGa()) return false;
  (window.gtag as GtagFn)("consent", "update", consentState());
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

/* ---------- Umami anonymous events (queued until the script is ready) ---------- */

type UmamiLike = { track: (name: string, data?: Record<string, string>) => void };
const umamiQueue: { name: string; data?: Record<string, string> }[] = [];
const UMAMI_QUEUE_MAX = 20;

export function flushUmamiQueue() {
  if (typeof window === "undefined") return;
  const umami = (window as unknown as { umami?: UmamiLike }).umami;
  if (!umami) return;
  while (umamiQueue.length) {
    const item = umamiQueue.shift()!;
    try { umami.track(item.name, item.data); } catch {}
  }
}

/** Anonymous Umami event; queued (bounded) until window.umami exists. */
export function umamiEvent(name: string, data?: Record<string, string>) {
  if (typeof window === "undefined") return;
  if (umamiQueue.length >= UMAMI_QUEUE_MAX) umamiQueue.shift();
  umamiQueue.push({ name, data });
  flushUmamiQueue();
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
 * Report one GA4 `login` (and Umami `login`) per sign-in. Call ONLY where a
 * login just succeeded, never on session restore. The sessionStorage guard
 * stops double reports within the same tab session.
 */
export function trackLogin(method?: string): boolean {
  if (!gaEnabled()) return false;
  try {
    if (sessionStorage.getItem(LOGIN_GUARD_KEY) === "1") return false;
  } catch {}
  let m = method;
  try { m = m || sessionStorage.getItem(LOGIN_METHOD_KEY) || undefined; } catch {}
  const valid = m && /^[a-z_]{2,20}$/.test(m) ? m : undefined;
  const ok = gaEvent("login", valid ? { method: valid } : {});
  if (ok) {
    umamiEvent("login", valid ? { method: valid } : undefined);
    try {
      sessionStorage.setItem(LOGIN_GUARD_KEY, "1");
      sessionStorage.removeItem(LOGIN_METHOD_KEY);
    } catch {}
  }
  return ok;
}

/** Report the visitor's own sign up once per tab (GA4 `sign_up` + Umami). */
export function trackSignUp(method: "email" | "google"): boolean {
  try {
    if (sessionStorage.getItem(SIGNUP_GUARD_KEY) === "1") return false;
  } catch {}
  const ok = gaEvent("sign_up", { method });
  umamiEvent("sign_up", { method });
  try { sessionStorage.setItem(SIGNUP_GUARD_KEY, "1"); } catch {}
  return ok;
}

/** Test helper. */
export function __resetGaForTests() {
  initializedFor = "";
  lastPagePath = "";
  umamiQueue.length = 0;
}
