"use client";

import { api } from "@/lib/api";

export type EvergreenSettings = {
  enabled: boolean;
  intervalDays: number;
  maxPerRun: number;
};

export function getEvergreenSettings(): Promise<EvergreenSettings> {
  return api.get("/evergreen/settings");
}

export function saveEvergreenSettings(body: EvergreenSettings) {
  return api.post("/evergreen/settings", body);
}

export function toggleEvergreen(group: string, on: boolean) {
  return api.post(`/evergreen/${encodeURIComponent(group)}/toggle`, { on });
}

export function listEvergreen(): Promise<
  { id: string; group: string; content: string; lastRecycledAt: string | null }[]
> {
  return api.get("/evergreen");
}
