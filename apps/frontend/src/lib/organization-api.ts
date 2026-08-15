"use client";

import { api } from "./api";

export interface OrganizationProfile {
  name: string;
  description: string;
  logo: string | null;
  defaultTimezone: string | null;
  referralSource: string | null;
  brandVoice: string | null;
  brandAudience: string | null;
  brandRules: string | null;
  brandForbiddenWords: string | null;
}

export async function getOrganizationProfile(): Promise<OrganizationProfile> {
  return api.get("/settings/organization");
}

export async function updateOrganizationProfile(
  data: Partial<OrganizationProfile>,
): Promise<OrganizationProfile> {
  return api.put("/settings/organization", data);
}
