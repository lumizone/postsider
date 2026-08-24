/**
 * Channel / integration API client.
 *
 * The backend Integration model has no notion of UI-only fields like the
 * accent colour we draw in the calendar, so we keep that in localStorage
 * keyed by integrationId. Audience numbers come from the analytics
 * endpoints — when the provider supports it.
 */

import { api } from "./api";
import { CHANNEL_COLOR_PALETTE, type Channel } from "./calendar-data";

export interface BackendIntegration {
  id: string;
  internalId: string;
  name: string;
  identifier: string; // providerIdentifier, e.g. "x", "youtube"
  picture: string | null;
  disabled: boolean;
  refreshNeeded: boolean;
  inBetweenSteps: boolean;
  display: string | null;
  type: string;
  time: { time: number }[];
  changeProfilePicture: boolean;
  changeNickName: boolean;
  customer: { id: string; name: string } | null;
  additionalSettings: string;
  editor: string;
  stripLinks: boolean;
  isCustomFields: boolean;
  customFields?: unknown;
}

export interface ListIntegrationsResponse {
  integrations: BackendIntegration[];
}

const COLOR_KEY_PREFIX = "postsider:channel-color:";

/** Map provider identifier to a presentable label and a backend-known platform. */
const PROVIDER_LABELS: Record<string, { label: string; platform: string }> = {
  x: { label: "X", platform: "X" },
  twitter: { label: "X", platform: "X" },
  facebook: { label: "Facebook", platform: "Facebook" },
  instagram: { label: "Instagram", platform: "Instagram" },
  "instagram-standalone": { label: "Instagram", platform: "Instagram" },
  youtube: { label: "YouTube", platform: "YouTube" },
  tiktok: { label: "TikTok", platform: "TikTok" },
  linkedin: { label: "LinkedIn", platform: "LinkedIn" },
  "linkedin-page": { label: "LinkedIn Page", platform: "LinkedIn" },
  threads: { label: "Threads", platform: "Threads" },
  pinterest: { label: "Pinterest", platform: "Pinterest" },
  discord: { label: "Discord", platform: "Discord" },
  slack: { label: "Slack", platform: "Slack" },
  telegram: { label: "Telegram", platform: "Telegram" },
  twitch: { label: "Twitch", platform: "Twitch" },
  bluesky: { label: "Bluesky", platform: "Bluesky" },
  mastodon: { label: "Mastodon", platform: "Mastodon" },
  "mastodon-custom": { label: "Mastodon", platform: "Mastodon" },
  farcaster: { label: "Farcaster", platform: "Farcaster" },
  wrapcast: { label: "Farcaster", platform: "Farcaster" },
  nostr: { label: "Nostr", platform: "Nostr" },
  lemmy: { label: "Lemmy", platform: "Lemmy" },
  gmb: { label: "Google Business", platform: "Google Business" },
  blogger: { label: "Blogger", platform: "Blogger" },
  notion: { label: "Notion", platform: "Notion" },
  listmonk: { label: "Listmonk", platform: "Listmonk" },
  medium: { label: "Medium", platform: "Medium" },
  wordpress: { label: "WordPress", platform: "WordPress" },
  ghost: { label: "Ghost", platform: "Ghost" },
  hashnode: { label: "Hashnode", platform: "Hashnode" },
  "dev-to": { label: "Dev.to", platform: "Dev.to" },
  devto: { label: "Dev.to", platform: "Dev.to" },
  mataroa: { label: "Mataroa", platform: "Mataroa" },
  writeas: { label: "Write.as", platform: "Write.as" },
  dribbble: { label: "Dribbble", platform: "Dribbble" },
  whop: { label: "Whop", platform: "Whop" },
  moltbook: { label: "Moltbook", platform: "Moltbook" },
};

export function platformFromIdentifier(identifier: string): string {
  return PROVIDER_LABELS[identifier]?.platform ?? identifier;
}

function colorForIntegration(id: string, identifier: string): string {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(COLOR_KEY_PREFIX + id);
      if (stored) return stored;
    } catch {}
  }
  // Deterministic fallback based on the provider identifier so the colour
  // is stable across renders without persisting anything.
  const palette = CHANNEL_COLOR_PALETTE.map((p) => p.value);
  let hash = 0;
  const seed = identifier + id;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

export function setChannelColor(integrationId: string, color: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLOR_KEY_PREFIX + integrationId, color);
  } catch {}
}

/**
 * Parse the integration's serialized `additionalSettings` and return whether
 * the account is flagged as Verified (premium). Used by X for its higher
 * character limit. Tolerates malformed / empty values.
 */
function parseVerifiedFlag(additionalSettings?: string): boolean {
  if (!additionalSettings) return false;
  try {
    const parsed = JSON.parse(additionalSettings);
    if (!Array.isArray(parsed)) return false;
    return !!parsed.find(
      (p: { title?: string; value?: unknown }) => p?.title === "Verified",
    )?.value;
  } catch {
    return false;
  }
}

export function integrationToChannel(i: BackendIntegration): Channel {
  return {
    id: i.id,
    name: i.name,
    platform: platformFromIdentifier(i.identifier),
    identifier: i.identifier,
    verified: parseVerifiedFlag(i.additionalSettings),
    color: colorForIntegration(i.id, i.identifier),
    avatarUrl: i.picture || null,
    audience: 0,
    audienceHistory: [],
  };
}

export async function listChannels(): Promise<{
  channels: Channel[];
  raw: BackendIntegration[];
}> {
  const data = await api.get<ListIntegrationsResponse>("/integrations/list");
  const raw = data.integrations || [];
  return {
    raw,
    channels: raw.map(integrationToChannel),
  };
}

export async function deleteChannel(id: string): Promise<void> {
  await api.del("/integrations", { id });
}

export async function disableChannel(id: string): Promise<void> {
  await api.post("/integrations/disable", { id });
}

export async function enableChannel(id: string): Promise<void> {
  await api.post("/integrations/enable", { id });
}

/**
 * Backend returns either { url } (success) or { err: true } (config / scope error).
 * For custom-fields providers it also includes the field definitions.
 */
export interface CustomFieldDef {
  key: string;
  label: string;
  defaultValue?: string;
  validation: string;
  type: "text" | "password";
}

export interface OauthLinkResponse {
  url?: string;
  err?: boolean;
  customFields?: CustomFieldDef[];
  /** Real OAuth redirect URL (when provider has API keys configured). */
  oauthUrl?: string;
  /** Whether OAuth is already configured for this provider. */
  oauthConfigured?: boolean;
  /** Sign In With Neynar client id — present for Farcaster (wrapcast). */
  neynarClientId?: string;
}

export async function getOauthUrl(
  provider: string,
  options?: { refresh?: string; externalUrl?: string },
): Promise<OauthLinkResponse> {
  return api.get<OauthLinkResponse>(
    `/integrations/social/${provider}`,
    {
      refresh: options?.refresh,
      externalUrl: options?.externalUrl,
    },
  );
}

export interface ConnectPage {
  id: string;
  page: string;
  name: string;
  username?: string;
  picture?: string;
}

export interface ConnectResult {
  id: string;
  name: string;
  picture: string | null;
  identifier: string;
  error?: string;
  /** For two-step providers (e.g. LinkedIn Page): the pages/companies the user can pick. */
  pages?: ConnectPage[];
  /** Whether this integration still needs a page selection step. */
  inBetweenSteps?: boolean;
}

export async function connectIntegration(
  provider: string,
  payload: { code: string; state: string; refresh?: string; timezone?: string },
): Promise<ConnectResult> {
  // Any truthy value just tells the backend to seed default posting-time
  // slots on connect (local minutes-from-midnight — see Integration.timezone,
  // default 'UTC'; set the channel's real audience zone afterward on the
  // Queue Plan settings page, since the connecting person's own browser zone
  // usually isn't the audience's).
  const timezone = payload.timezone ?? String(new Date().getTimezoneOffset() * -1);
  return api.post<ConnectResult>(
    `/integrations/social-connect/${provider}`,
    { ...payload, timezone },
    { silent: true },
  );
}

export interface TelegramUpdateResult {
  chatId?: number | string;
  lastChatId?: number;
}

/**
 * Poll the shared Telegram bot for a `/connect <code>` message. Returns
 * `{ chatId }` once the user posts the command in a chat where the bot is an
 * admin, `{ lastChatId }` (an offset to pass back as `id` on the next poll)
 * while still waiting, or `{}` when there are no updates yet.
 */
export async function pollTelegramUpdates(
  word: string,
  id?: number,
): Promise<TelegramUpdateResult> {
  return api.get<TelegramUpdateResult>(
    `/integrations/telegram/updates`,
    // `id !== undefined` preserves a zero offset — `id ? {id} : {}` dropped it
    // and repeated earlier updates.
    { word, ...(id !== undefined ? { id } : {}) },
    { silent: true },
  );
}

/**
 * Finalize a two-step provider connection (e.g. LinkedIn Page) by saving the
 * page/company the user picked. `state` is the OAuth state from the callback.
 */
export async function saveProviderPage(
  integrationId: string,
  payload: { page: string; state?: string },
): Promise<{ success: boolean }> {
  return api.post<{ success: boolean }>(
    `/integrations/provider/${integrationId}/connect`,
    payload,
  );
}

export interface IntegrationChannel {
  id: string;
  name: string;
}

/**
 * Fetch the selectable sub-targets for an integration — e.g. Discord server
 * channels, Slack channels, etc. Calls the provider's named function (e.g.
 * "channels") through the generic /integrations/function endpoint.
 */
export async function getIntegrationChannels(
  integrationId: string,
  fnName = "channels",
  data: Record<string, unknown> = {},
): Promise<IntegrationChannel[]> {
  // Let failures propagate — returning [] makes a network/auth/server error
  // indistinguishable from "no selectable targets".
  const res = await api.post<IntegrationChannel[]>(
    `/integrations/function`,
    { id: integrationId, name: fnName, data },
    { silent: true },
  );
  return Array.isArray(res) ? res : [];
}

/**
 * What the connected TikTok account itself allows. Required by TikTok's
 * Content Posting API audit: the composer may only offer the privacy levels
 * TikTok returns here, and must respect the creator's duet/stitch/comment
 * settings instead of showing its own fixed list.
 */
export interface TiktokCreatorInfo {
  nickname: string;
  username: string;
  avatarUrl: string;
  privacyOptions: string[];
  duetDisabled: boolean;
  stitchDisabled: boolean;
  commentDisabled: boolean;
  maxDurationSeconds: number;
}

export async function getTiktokCreatorInfo(
  integrationId: string,
): Promise<TiktokCreatorInfo> {
  return api.post<TiktokCreatorInfo>(
    `/integrations/function`,
    { id: integrationId, name: "creatorInfo", data: {} },
    { silent: true },
  );
}


