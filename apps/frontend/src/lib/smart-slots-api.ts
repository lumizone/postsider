"use client";
import { api } from "@/lib/api";

export type SlotSuggestion = { datetime: string; score: number };

export function suggestSlots(
  integration: string,
  platform: string,
  count = 3,
): Promise<SlotSuggestion[]> {
  // Audience timezone is resolved server-side from the channel's own
  // configured Integration.timezone — not this browser's zone, which could
  // be the agency staffer reviewing a client channel in another timezone.
  return api.get(
    `/posts/smart-slots?integration=${encodeURIComponent(integration)}&platform=${encodeURIComponent(platform)}&count=${count}`,
  );
}
