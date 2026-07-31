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
  // Other fields exist on the backend but aren't used here yet.
}

interface AuthState {
  user: SelfUser | null;
  /** Loading is true on first mount until /user/self resolves (or fails). */
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
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
    () => ({ user, loading, refresh, logout }),
    [user, loading, refresh, logout],
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
