"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query from React.
 *
 * Starts `false` on the server and on the first client render, then corrects
 * itself in the effect: reading `matchMedia` during render would make the
 * markup differ between server and client and trip hydration. Layout that
 * depends on this must therefore be safe in its desktop form for one frame,
 * which the calendar's is (lanes, the pre-existing behavior).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** The calendar's phone breakpoint, matching `@media (max-width: 640px)`. */
export const PHONE_QUERY = "(max-width: 640px)";
