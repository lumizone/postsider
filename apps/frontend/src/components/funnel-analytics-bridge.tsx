"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  analyticsConsent,
  ensureFunnelAnalytics,
  recordClientFunnelStage,
  syncFunnelMilestones,
} from "@/lib/funnel-analytics";

/**
 * The app shares the existing Umami project with the marketing site, but
 * loads it only after the same-site analytics consent cookie was granted.
 * An authenticated onboarding visit is reconciled with actual org creation
 * by the server; stale or repeat visits are not new signups.
 */
export function FunnelAnalyticsBridge() {
  const pathname = usePathname();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (!analyticsConsent()) return;
    ensureFunnelAnalytics();
  }, [pathname]);

  useEffect(() => {
    if (loading || !user?.orgId || !analyticsConsent()) return;
    // Onboarding is shown to newly registered/activated users after actual auth.
    // Server permits a first-time signup marker only for recently created orgs.
    if (pathname === "/onboarding") {
      void recordClientFunnelStage("signup_completed");
    }
    void syncFunnelMilestones();
  }, [pathname, user?.orgId, loading]);
  return null;
}
