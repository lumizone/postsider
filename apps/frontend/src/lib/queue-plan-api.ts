"use client";

import { api } from "@/lib/api";

export type QueueSlot = { time: number; days?: number[] };

export const getQueuePlan = (integrationId: string) =>
  api.get<{ slots: QueueSlot[]; timezone: string }>(
    `/integrations/${encodeURIComponent(integrationId)}/queue-plan`
  );

export const saveQueuePlan = (
  integrationId: string,
  slots: QueueSlot[],
  timezone?: string,
) =>
  api.put(`/integrations/${encodeURIComponent(integrationId)}/queue-plan`, {
    time: slots,
    ...(timezone ? { timezone } : {}),
  });

export const findNextSlot = (integrationId: string) =>
  api.get<{ date: string }>(
    `/posts/find-slot/${encodeURIComponent(integrationId)}`
  );

export const minutesToHHMM = (m: number): string => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(min)}`;
};

export const hhmmToMinutes = (v: string): number => {
  const [h, m] = v.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
};
