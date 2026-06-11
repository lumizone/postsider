"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, setAuthToken } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function GoogleCallbackInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;

    const code = search.get("code");

    if (!code) {
      setError("Google did not return an authorization code.");
      return;
    }

    (async () => {
      try {
        const res = await api.post<{ login?: boolean; token?: string }>(
          "/auth/oauth/GOOGLE/exists",
          {
            code,
            redirect_uri: `${window.location.origin}/auth/oauth/google/callback`,
          },
          { anonymous: true, silent: true },
        );

        if (res?.token) {
          // New user — register with the token
          await api.post(
            "/auth/register",
            {
              provider: "GOOGLE",
              providerToken: res.token,
              company: "My Organization",
            },
            { anonymous: true, silent: true },
          );
        }

        await refresh();
        router.replace("/calendar");
      } catch (err: any) {
        setError(err?.message || "Could not sign in with Google.");
      }
    })();
  }, [search, router, refresh]);

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 32 }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Sign in failed</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>{error}</p>
          <a href="/login" style={{ padding: "10px 20px", background: "var(--fg)", color: "var(--bg)", borderRadius: 8, textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
            Back to login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <p style={{ color: "var(--muted)", fontSize: 14 }}>Signing in with Google…</p>
    </div>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
          <p style={{ color: "var(--muted)", fontSize: 14 }}>Signing in with Google…</p>
        </div>
      }
    >
      <GoogleCallbackInner />
    </Suspense>
  );
}
