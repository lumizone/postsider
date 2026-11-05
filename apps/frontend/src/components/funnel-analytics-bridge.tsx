"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  analyticsConsent,
  ensureFunnelAnalytics,
  syncFunnelMilestones,
} from "@/lib/funnel-analytics";
import { gaPageView, updateGaConsent } from "@/lib/ga4";

/**
 * Loads Umami (cookieless) and GA4 (Consent Mode v2, denied until the visitor
 * accepts) for everyone, and reports page views by path only. The consent-gated
 * funnel milestones (journey cookie, server sync) still need the consent cookie.
 * A real signup is recorded by the auth server, never inferred from a page view.
 */
export function FunnelAnalyticsBridge() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  useEffect(() => {
    ensureFunnelAnalytics();
    gaPageView(pathname);
  }, [pathname]);

  useEffect(() => {
    if (loading || !user?.orgId || !analyticsConsent()) return;
    void syncFunnelMilestones();
  }, [pathname, user?.orgId, loading]);

  useEffect(() => {
    const onConsent = () => {
      updateGaConsent();
      ensureFunnelAnalytics();
      if (!loading && user?.orgId && analyticsConsent()) void syncFunnelMilestones();
    };
    window.addEventListener("ps:consent", onConsent);
    return () => window.removeEventListener("ps:consent", onConsent);
  }, [user?.orgId, loading]);
  return null;
}
