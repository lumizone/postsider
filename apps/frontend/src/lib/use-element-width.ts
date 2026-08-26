"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Measure an element's width and keep it current through resizes.
 *
 * The calendar needs a real measurement, not a breakpoint: how much room a
 * timeline column has depends on the sidebar, the channels panel and the number
 * of day columns, none of which a media query can see. Returns 0 until the
 * first measurement lands, so callers must have a sane fallback for that frame.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width] as const;
}

/**
 * Narrowest a post card may get before it stops being a preview: below this an
 * icon plus two or three characters is all that survives. Measured against the
 * card's own content (16px platform icon + title + "HH:mm · channel").
 */
export const MIN_CARD_WIDTH = 132;
