"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  api,
  ApiError,
  setAuthToken,
  setOrgId,
} from "./api";

export interface OrgSummary {
  id: string;
  name: string;
  role: "SUPERADMIN" | "ADMIN" | "USER";
  logo?: string | null;
}

export interface SelfUser {
  id: string;
  email: string;
  name: string | null;
  orgId: string;
  totalChannels: number;
  tier: string;
  role: "SUPERADMIN" | "ADMIN" | "USER";
  isLifetime: boolean;
  admin: boolean;
  impersonate: boolean;
  isTrailing: boolean;
  allowTrial: boolean;
  onTrial: boolean;
  trialDaysLeft: number | null;
  publicApi: string;
  isPlatformAi: boolean;
  aiUsage: { limit: number | null; used: number; remaining: number | null; renewsAt: string } | null;
  /** All organizations the user belongs to. Populated after first /user/self load. */
  organizations?: OrgSummary[];
  /** Current org's uploaded logo (Settings → Organization). Null falls back to the PostSider brand mark. */
  orgLogo?: string | null;
  // Other fields exist on the backend but aren't used here yet.
}

interface AuthState {
  user: SelfUser | null;
  /** Loading is true on first mount until /user/self resolves (or fails). */
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Switch to a different organization. Resolves after the new org context is loaded. */
  switchOrg: (orgId: string) => Promise<void>;
  /** Create an additional organization owned by the current user and switch to it. */
  createOrg: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SelfUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Always ask the server. In production the auth cookie is httpOnly, so the
    // client cannot see a token — `/user/self` (with credentials:"include") is
    // the source of truth. In dev (NOT_SECURED) the header token is sent too.
    try {
      const me = await api.get<SelfUser>("/user/self", undefined, {
        silent: true,
      });
      setUser(me);
      if (me?.orgId) setOrgId(me.orgId);

      // Load the full org list for the switcher. Fire-and-forget — a failure
      // here shouldn't block the auth flow, the user just won't see a switcher.
      try {
        const raw = await api.get<any[]>("/user/organizations", undefined, { silent: true });
        if (Array.isArray(raw)) {
          const orgs: OrgSummary[] = raw
            .filter((o: any) => o?.id && o?.name)
            .map((o: any) => ({
              id: o.id,
              name: o.name,
              role: o.users?.[0]?.role || "USER",
              logo: o.logo ?? null,
            }));
          setUser((prev) => (prev ? { ...prev, organizations: orgs } : prev));
        }
      } catch {}
    } catch (err) {
      // 403 means "authenticated but lacking permission/plan" — clearing the
      // session there kicks a valid user off. Only 401 (expired/missing session)
      // logs out.
      if (err instanceof ApiError && err.status === 401) {
        setAuthToken(null);
        setOrgId(null);
        setUser(null);
      } else {
        // Network, 403 or 500 — keep any existing session, don't blow up auth.
        console.error("[auth] /user/self failed:", err);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const switchOrg = useCallback(async (orgId: string) => {
    // Let the backend set the `showorg` cookie, then reload the full shell
    // so every data hook (channels, calendar, analytics) re-fetches against
    // the new organization. A soft refresh isn't enough — all server-state
    // is scoped to the org that was selected when the page loaded.
    await api.post("/user/change-org", { id: orgId }, { silent: true });
    window.location.href = "/";
  }, []);

  const createOrg = useCallback(async (name: string) => {
    const created = await api.post<{ id: string; name: string }>(
      "/user/organizations",
      { name },
    );
    await switchOrg(created.id);
  }, [switchOrg]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post("/user/logout", {}, { silent: true });
    } catch {}
    setAuthToken(null);
    setOrgId(null);
    setUser(null);
    router.replace("/login");
  }, [router]);

  const value = useMemo<AuthState>(
    () => ({ user, loading, refresh, logout, switchOrg, createOrg }),
    [user, loading, refresh, logout, switchOrg, createOrg],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}

/**
 * Convenience hook — only the current org id + role. Avoids destructuring
 * `useAuth().user` in components that just need org context.
 */
export function useOrg(): {
  orgId: string | null;
  role: string;
  organizations: OrgSummary[];
  switchOrg: (orgId: string) => Promise<void>;
  createOrg: (name: string) => Promise<void>;
} {
  const { user, switchOrg, createOrg } = useAuth();
  return {
    orgId: user?.orgId ?? null,
    role: user?.role ?? "USER",
    organizations: user?.organizations ?? [],
    switchOrg,
    createOrg,
  };
}
