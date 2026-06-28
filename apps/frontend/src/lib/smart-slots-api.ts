"use client";
import { api } from "@/lib/api";

export type SlotSuggestion = { datetime: string; score: number };

export function suggestSlots(
  integration: string,
  platform: string,
  count = 3,
): Promise<SlotSuggestion[]> {
  // Minutes to ADD to UTC to reach the user's local wall clock (getTimezoneOffset
  // returns minutes to subtract, so negate it). Lets the backend rank slots at
  // audience-local peak hours.
  const tz = -new Date().getTimezoneOffset();
  return api.get(
    `/posts/smart-slots?integration=${encodeURIComponent(integration)}&platform=${encodeURIComponent(platform)}&count=${count}&tz=${tz}`,
  );
}
