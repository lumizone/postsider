"use client";

import { api } from "./api";

/** Disconnect every connected channel for the organization. Irreversible. */
export async function disconnectAllChannels(): Promise<{ disconnected: number }> {
  return api.post("/settings/disconnect-all-channels", {});
}

/** Permanently delete the organization and the user account. Irreversible. */
export async function deleteAccount(): Promise<{ deleted: boolean }> {
  return api.post("/settings/delete-account", {});
}
