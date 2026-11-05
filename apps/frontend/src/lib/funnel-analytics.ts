"use client";

import { api } from "@/lib/api";
import { analyticsConsent, readCookie as cookie } from "@/lib/analytics-consent";
import { ensureGa, flushUmamiQueue, gaEnabled, gaEvent } from "@/lib/ga4";

export { analyticsConsent };

const WEBSITE_ID = "8f4f0638-114f-4ed6-8d9f-eb553b4a2b61";
const UMAMI_SRC = "https://analytics.darkdynasty.cloud/script.js";
type FunnelStage = "signup_completed" | "onboarding_type_selected" |
  "mcp_connected" | "first_draft_created" | "subscription_started";
type ClientStage = "onboarding_type_selected";
type Intent = "agents" | "scheduler";
type Journey = {
  consented: boolean;
  journeyId?: string | null;
  source?: string | null;
  campaign?: string | null;
  landingPath?: string | null;
  onboardingType?: string | null;
  milestones?: Partial<Record<FunnelStage, boolean>> | null;
};
type Umami = { track: (name: string, data?: Record<string, string>) => void };
declare global {
  interface Window {
    umami?: Umami;
    psUmamiBeforeSend?: (type: string, payload: Record<string, unknown>) => Record<string, unknown>;
  }
}

/** Umami loads only for our own hosts, so forks never report into our instance. */
function umamiAllowed(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "app.postsider.com" || host.endsWith(".postsider.com");
}

function stripQueryAndHash(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value;
  return value.split("#")[0].split("?")[0];
}

/** Umami before-send hook: never let a query string or hash leave the browser. */
export function psUmamiBeforeSend(_type: string, payload: Record<string, unknown>) {
  if (payload && typeof payload === "object") {
    if ("url" in payload) payload.url = stripQueryAndHash(payload.url);
    if ("referrer" in payload) payload.referrer = stripQueryAndHash(payload.referrer);
  }
  return payload;
}

let loadAttempted = false;
type PendingItem = {
  event: FunnelStage;
  data: Record<string, string>;
  key: string;
  umamiDone: boolean;
  gaDone: boolean;
};
const pending: PendingItem[] = [];
const gaKey = (key: string) => key + ":ga";

/** GA4 name and params for each milestone. No PII, no ids, no purchase. */
export function gaMappingFor(
  stage: FunnelStage,
  data: Record<string, string>,
): { name: string; params: Record<string, string> } {
  switch (stage) {
    case "signup_completed":
      // Server-confirmed signup. Named differently from the visitor `sign_up`
      // event (fired at registration) so the two never double count.
      return { name: "signup_confirmed", params: {} };
    case "onboarding_type_selected":
      return {
        name: "onboarding_type_selected",
        params: data.onboarding_type ? { onboarding_type: data.onboarding_type } : {},
      };
    default:
      // mcp_connected, first_draft_created, subscription_started keep their
      // names. Deliberately NOT mapped to GA4 `purchase` (no value or txn id).
      return { name: stage, params: {} };
  }
}
const STAGES: FunnelStage[] = [
  "signup_completed",
  "onboarding_type_selected",
  "mcp_connected",
  "first_draft_created",
  "subscription_started",
];

function setJourneyCookie(id: string) {
  if (typeof window === "undefined") return;
  const domain = window.location.hostname === "postsider.com" ||
    window.location.hostname.endsWith(".postsider.com")
    ? "; Domain=.postsider.com" : "";
  document.cookie = "ps_journey_id=" + encodeURIComponent(id) +
    "; Path=/; Max-Age=5184000; SameSite=Lax" +
    (window.location.protocol === "https:" ? "; Secure" : "") + domain;
}

function journeyId(): string {
  if (!analyticsConsent()) return "";
  const id = cookie("ps_journey_id");
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return id;
  if (typeof crypto === "undefined" || !crypto.randomUUID) return "";
  const generated = crypto.randomUUID();
  setJourneyCookie(generated);
  return generated;
}

function flush() {
  if (!analyticsConsent() || typeof window === "undefined") return;
  // GA4 and Umami are independent sinks: a blocked Umami must not lose or
  // duplicate GA events, so each has its own once-only marker.
  for (const item of pending) {
    if (item.gaDone || !gaEnabled()) continue;
    const { name, params } = gaMappingFor(item.event, item.data);
    if (gaEvent(name, params)) {
      item.gaDone = true;
      try { localStorage.setItem(gaKey(item.key), "1"); } catch {}
    }
  }
  while (pending.length && window.umami) {
    const item = pending[0];
    if (!item.umamiDone) {
      try {
        window.umami.track(item.event, item.data);
        // Mark only after Umami's client accepted the event. Browser transport
        // delivery itself cannot be guaranteed or observed by this integration.
        try { localStorage.setItem(item.key, "1"); } catch {}
        item.umamiDone = true;
      } catch {
        // Keep the item for a subsequent flush instead of falsely marking it
        // as delivered and silently losing the conversion.
        break;
      }
    }
    if (item.gaDone || !gaEnabled()) pending.shift();
    else break;
  }
  // Drop fully delivered items that were waiting behind an undelivered one.
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i].umamiDone && (pending[i].gaDone || !gaEnabled())) pending.splice(i, 1);
  }
}

/** Loads Umami + GA for everyone on our hosts; only the journey id needs consent. */
export function ensureFunnelAnalytics() {
  if (typeof document === "undefined") return;
  if (analyticsConsent()) journeyId();
  ensureGa();
  if (!umamiAllowed()) return;
  if (typeof window !== "undefined" && window.umami) { flushUmamiQueue(); flush(); return; }
  if (loadAttempted) return;
  loadAttempted = true;
  window.psUmamiBeforeSend = psUmamiBeforeSend;
  const s = document.createElement("script");
  s.defer = true;
  s.src = UMAMI_SRC;
  s.setAttribute("data-website-id", WEBSITE_ID);
  s.setAttribute("data-auto-track", "true");
  s.setAttribute("data-exclude-search", "true");
  s.setAttribute("data-exclude-hash", "true");
  s.setAttribute("data-before-send", "psUmamiBeforeSend");
  s.onload = () => { flushUmamiQueue(); flush(); };
  s.onerror = () => { loadAttempted = false; };
  document.head.appendChild(s);
}

function safe(value: unknown, max = 90): string {
  return typeof value === "string" &&
    value.length <= max && /^[a-zA-Z0-9][a-zA-Z0-9._%+\- ]*$/.test(value)
    ? value : "";
}

function markKey(stage: FunnelStage) {
  // Local dedupe is not a security boundary. Server-side stages are
  // idempotent; this only prevents duplicate Umami reports on reload.
  return "ps-funnel-sent-v1:" + journeyId() + ":" + stage;
}

function trackOnce(stage: FunnelStage, data: Record<string, string> = {}) {
  if (!analyticsConsent() || typeof window === "undefined") return;
  ensureFunnelAnalytics();
  const key = markKey(stage);
  let umamiDone = false;
  let gaDone = !gaEnabled();
  try {
    umamiDone = localStorage.getItem(key) === "1";
    if (!gaDone) gaDone = localStorage.getItem(gaKey(key)) === "1";
  } catch {}
  if (umamiDone && gaDone) return;
  if (pending.some((item) => item.key === key)) return;
  const id = journeyId();
  pending.push({
    event: stage,
    key,
    umamiDone,
    gaDone,
    data: {
      ...(id ? { journey_id: id } : {}),
      ...(data.source ? { utm_source: safe(data.source) } : {}),
      ...(data.campaign ? { utm_campaign: safe(data.campaign) } : {}),
      ...(data.landing ? { landing_path: safe(data.landing, 181) } : {}),
      ...(data.onboardingType ? { onboarding_type: safe(data.onboardingType, 15) } : {}),
    },
  });
  flush();
}

/** Client may only report these two validated stages, never paid/MCP/draft. */
export async function recordClientFunnelStage(stage: ClientStage, intent?: Intent) {
  if (!analyticsConsent()) return false;
  ensureFunnelAnalytics();
  try {
    const result = await api.post<{ recorded: boolean; consented: boolean }>(
      "/analytics/funnel",
      { event: stage, onboardingType: intent },
      { silent: true },
    );
    if (result.recorded) {
      trackOnce(stage, intent ? { onboardingType: intent } : {});
    }
    return result.recorded;
  } catch {
    // Analytics is never allowed to break onboarding.
    return false;
  }
}

/** Sync authoritative milestones, including ONLY Polar-confirmed paid orders. */
export async function syncFunnelMilestones() {
  if (!analyticsConsent()) return;
  ensureFunnelAnalytics();
  try {
    const journey = await api.get<Journey>("/analytics/funnel", undefined, { silent: true });
    if (!journey.consented || !journey.milestones) return;
    for (const stage of STAGES) {
      if (journey.milestones[stage]) {
        trackOnce(stage, {
          source: journey.source || "",
          campaign: journey.campaign || "",
          landing: journey.landingPath || "",
          onboardingType: journey.onboardingType || "",
        });
      }
    }
  } catch {
    // May run while login is incomplete; don't block navigation.
  }
}
