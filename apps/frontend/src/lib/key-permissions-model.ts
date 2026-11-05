// Pure model for the per-key action and channel limits in the API key dialogs.
// No React, no network. Mirrors what the backend enforces: an empty list means
// "no limit on that dimension"; both empty means an unrestricted key.

export type KeyAction = "DRAFT" | "SCHEDULE" | "PUBLISH_NOW";

export const KEY_ACTIONS: readonly KeyAction[] = ["DRAFT", "SCHEDULE", "PUBLISH_NOW"];

export type KeyPermissionsState = {
  limited: boolean;
  actions: KeyAction[];
  integrationIds: string[];
};

type PermissionsRow = { allowedActions?: string[]; allowedIntegrationIds?: string[] };

function cleanActions(raw: unknown): KeyAction[] {
  const list = Array.isArray(raw) ? raw : [];
  // Canonical order, unknown strings and duplicates dropped.
  return KEY_ACTIONS.filter((a) => list.includes(a));
}

function cleanIds(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from(new Set(list.filter((v): v is string => typeof v === "string" && v.length > 0)));
}

export function permissionsFromRow(row: PermissionsRow): KeyPermissionsState {
  const actions = cleanActions(row.allowedActions);
  const integrationIds = cleanIds(row.allowedIntegrationIds);
  return { limited: actions.length > 0 || integrationIds.length > 0, actions, integrationIds };
}

/** Always both lists, never null: the server rejects null and [] is what clears a limit. */
export function permissionsPayload(s: KeyPermissionsState): {
  allowedActions: KeyAction[];
  allowedIntegrationIds: string[];
} {
  if (!s.limited) return { allowedActions: [], allowedIntegrationIds: [] };
  return { allowedActions: cleanActions(s.actions), allowedIntegrationIds: cleanIds(s.integrationIds) };
}

export function isPermissionsSaveable(s: KeyPermissionsState): boolean {
  if (!s.limited) return true;
  return s.actions.length > 0 || s.integrationIds.length > 0;
}

/**
 * Drops stored channel ids that are not in `knownIds` (deleted or disabled
 * channels; the server answers 400 "Unknown channel id" for them). `knownIds`
 * null means the channel list could not be loaded: nothing is dropped and the
 * server stays the authority.
 */
export function reconcileWithKnown(
  s: KeyPermissionsState,
  knownIds: readonly string[] | null
): { state: KeyPermissionsState; dropped: number } {
  if (!s.limited || knownIds === null) return { state: s, dropped: 0 };
  const known = new Set(knownIds);
  const kept = s.integrationIds.filter((id) => known.has(id));
  return {
    state: { ...s, integrationIds: kept },
    dropped: s.integrationIds.length - kept.length,
  };
}

export function describePermissions(
  row: PermissionsRow,
  channelName: (id: string) => string | undefined
): { actions: KeyAction[] | null; channelCount: number | null; channelNames: string[] } {
  const actions = cleanActions(row.allowedActions);
  const ids = cleanIds(row.allowedIntegrationIds);
  const channelNames: string[] = [];
  for (const id of ids) {
    const name = channelName(id);
    if (name) channelNames.push(name);
  }
  return {
    actions: actions.length > 0 ? actions : null,
    channelCount: ids.length > 0 ? ids.length : null,
    channelNames,
  };
}

/** Plural form to use for "{count} channels" in the given locale. */
export function channelCountKey(count: number, locale: string): "one" | "few" | "many" {
  let category: string;
  try {
    category = new Intl.PluralRules(locale).select(count);
  } catch {
    category = "other";
  }
  if (category === "one") return "one";
  if (category === "few") return "few";
  return "many";
}
