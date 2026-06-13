"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DashboardShell } from "./dashboard-shell";
import { useAuth } from "@/lib/auth-context";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot",
  "/forgot-return",
  "/activate",
  "/auth/oauth",
  // Password reset link target from the email: /auth/forgot/<token>
  "/auth/forgot",
  // Account activation link target from the email: /auth/activate/<jwt>
  "/auth/activate",
  // OAuth callbacks
  "/integrations/social",
];

/** Pages that render without the dashboard shell but require auth. */
const NAKED_PATHS = ["/setup", "/onboarding"];

function isPublic(pathname: string | null): boolean {
  if (!pathname) return false;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isNaked(pathname: string | null): boolean {
  if (!pathname) return false;
  return NAKED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Top-level switch:
 * - Auth pages render plain (no sidebar).
 * - Authenticated pages render inside the dashboard shell. While auth is
 *   loading we show a minimal full-page skeleton instead of flashing the
 *   shell with empty channels and then the login redirect.
 */
export function AppRoot({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useAuth();

  const publicPath = isPublic(pathname);
  const nakedPath = isNaked(pathname);

  useEffect(() => {
    if (loading) return;
    if (!user && !publicPath) {
      router.replace("/login");
      return;
    }
  }, [user, loading, publicPath, router, pathname]);

  if (publicPath) {
    return <>{children}</>;
  }

  if (loading || !user) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          color: "var(--muted)",
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );
  }

  // Setup + other naked pages render without the sidebar shell.
  if (nakedPath) {
    return <>{children}</>;
  }

  return <DashboardShell>{children}</DashboardShell>;
}
