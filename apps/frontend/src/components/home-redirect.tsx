"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Root index. Two responsibilities:
 *   1. Forward invite links (`/?org=<jwt>`) to /login while preserving the
 *      token so the login form can accept the invite.
 *   2. Otherwise just send the user to /calendar — AppRoot handles the
 *      auth check and bumps unauthenticated visitors to /login itself.
 */
export function HomeRedirect() {
  const router = useRouter();
  const search = useSearchParams();

  useEffect(() => {
    const org = search.get("org");
    if (org) {
      router.replace(`/login?org=${encodeURIComponent(org)}`);
    } else {
      router.replace("/calendar");
    }
  }, [router, search]);

  return null;
}
