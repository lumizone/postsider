"use client";

import { api } from "./api";

export interface OrganizationProfile {
  name: string;
  description: string;
  logo: string | null;
  defaultTimezone: string | null;
}

export async function getOrganizationProfile(): Promise<OrganizationProfile> {
  return api.get("/settings/organization");
}

export async function updateOrganizationProfile(
  data: Partial<OrganizationProfile>,
): Promise<OrganizationProfile> {
  return api.put("/settings/organization", data);
}
