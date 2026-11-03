"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  analyticsConsent,
  ensureFunnelAnalytics,
  syncFunnelMilestones,
} from "@/lib/funnel-analytics";

/**
 * The app shares the existing Umami project with the marketing site, but
 * loads it only after the same-site analytics consent cookie was granted.
 * A real signup is recorded by the auth server, never inferred from a page view.
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
    void syncFunnelMilestones();
  }, [pathname, user?.orgId, loading]);
  return null;
}
