"use client";

import { api } from "@/lib/api";

export type HashtagGroup = {
  id: string;
  name: string;
  hashtags: string[];
  platform: string | null;
  createdAt: string;
};

export type CaptionTemplate = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
};

export type UtmPreset = {
  id: string;
  name: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
  utmTerm: string | null;
  createdAt: string;
};

export type UpsertHashtagGroup = {
  name: string;
  hashtags: string[];
  platform?: string | null;
};
export type UpsertCaptionTemplate = { name: string; content: string };
export type UpsertUtmPreset = {
  name: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent?: string | null;
  utmTerm?: string | null;
};

// Hashtag groups
export const getHashtagGroups = () =>
  api.get<HashtagGroup[]>("/composer-helpers/hashtag-groups");
export const createHashtagGroup = (body: UpsertHashtagGroup) =>
  api.post<HashtagGroup>("/composer-helpers/hashtag-groups", body);
export const updateHashtagGroup = (id: string, body: UpsertHashtagGroup) =>
  api.put(`/composer-helpers/hashtag-groups/${id}`, body);
export const deleteHashtagGroup = (id: string) =>
  api.del(`/composer-helpers/hashtag-groups/${id}`);

// Caption templates
export const getCaptionTemplates = () =>
  api.get<CaptionTemplate[]>("/composer-helpers/caption-templates");
export const createCaptionTemplate = (body: UpsertCaptionTemplate) =>
  api.post<CaptionTemplate>("/composer-helpers/caption-templates", body);
export const updateCaptionTemplate = (id: string, body: UpsertCaptionTemplate) =>
  api.put(`/composer-helpers/caption-templates/${id}`, body);
export const deleteCaptionTemplate = (id: string) =>
  api.del(`/composer-helpers/caption-templates/${id}`);

// UTM presets
export const getUtmPresets = () =>
  api.get<UtmPreset[]>("/composer-helpers/utm-presets");
export const createUtmPreset = (body: UpsertUtmPreset) =>
  api.post<UtmPreset>("/composer-helpers/utm-presets", body);
export const updateUtmPreset = (id: string, body: UpsertUtmPreset) =>
  api.put(`/composer-helpers/utm-presets/${id}`, body);
export const deleteUtmPreset = (id: string) =>
  api.del(`/composer-helpers/utm-presets/${id}`);
