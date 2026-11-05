// Pure model for the Settings > Policies form. No React, no network. Imports
// are relative and type only so the root jest run can load it.
import type { PolicyActorType, PolicyCondition, PolicyEffect, PolicyInput, PolicyRule } from "./policies-api";

export const POLICY_LIMITS = {
  nameMax: 120,
  priorityMin: 0,
  priorityMax: 1000,
  filterMax: 100,
  wordsMax: 100,
  wordMax: 100,
  capMin: 1,
  capMax: 10000,
} as const;

export const POLICY_CONDITION_LIST: readonly PolicyCondition[] = [
  "ALWAYS",
  "CONTAINS_LINK",
  "CONTAINS_WORDS",
  "OUTSIDE_WINDOW",
  "DAILY_CAP_EXCEEDED",
  "PUBLISH_NOW",
  "HAS_VIDEO",
];

export const POLICY_EFFECT_LIST: readonly PolicyEffect[] = ["REQUIRE_APPROVAL", "BLOCK"];

export const POLICY_ACTOR_TYPE_LIST: readonly PolicyActorType[] = ["USER", "API_KEY", "OAUTH_CLIENT", "SYSTEM"];

export type PolicyFormState = {
  name: string;
  enabled: boolean;
  priority: string;
  effect: PolicyEffect;
  condition: PolicyCondition;
  words: string;
  windowDays: number[];
  windowStart: string;
  windowEnd: string;
  timezone: string;
  capMax: string;
  capScope: "organization" | "channel";
  /** Kept only so editing a cap rule does not silently reset its stored timezone. */
  capTimezone?: string;
  appliesToActorTypes: string[];
  appliesToApiKeyIds: string[];
  appliesToIntegrationIds: string[];
  appliesToProviders: string;
  /** "" = the default flow. Only meaningful while the effect is REQUIRE_APPROVAL. */
  approvalFlowId: string;
  /** The flow the stored rule pointed to, so clearing it can be sent as null. */
  approvalFlowStored: string;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const INT = /^\d+$/;

export function emptyForm(): PolicyFormState {
  return {
    name: "",
    enabled: true,
    priority: "100",
    effect: "REQUIRE_APPROVAL",
    condition: "CONTAINS_LINK",
    words: "",
    windowDays: [],
    windowStart: "09:00",
    windowEnd: "17:00",
    timezone: "",
    capMax: "10",
    capScope: "organization",
    appliesToActorTypes: [],
    appliesToApiKeyIds: [],
    appliesToIntegrationIds: [],
    appliesToProviders: "",
    approvalFlowId: "",
    approvalFlowStored: "",
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseWords(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const w = part.trim();
    if (!w) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return out;
}

/** Non empty trimmed entries, duplicates kept (validation needs to see them). */
function rawWordList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((w) => w.trim())
    .filter(Boolean);
}

function parseProviders(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const p = part.trim().toLowerCase();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

export function defaultIsValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function formFromRule(r: PolicyRule): PolicyFormState {
  const f = emptyForm();
  f.name = r.name;
  f.enabled = r.enabled;
  f.priority = String(r.priority);
  f.effect = r.effect;
  f.condition = r.condition;
  f.appliesToActorTypes = [...(r.appliesToActorTypes ?? [])];
  f.appliesToApiKeyIds = [...(r.appliesToApiKeyIds ?? [])];
  f.appliesToIntegrationIds = [...(r.appliesToIntegrationIds ?? [])];
  f.appliesToProviders = (r.appliesToProviders ?? []).join(", ");
  f.approvalFlowId = typeof r.approvalFlowId === "string" ? r.approvalFlowId : "";
  f.approvalFlowStored = f.approvalFlowId;

  const p = isRecord(r.conditionParams) ? r.conditionParams : {};
  if (r.condition === "CONTAINS_WORDS") {
    f.words = Array.isArray(p.words) ? p.words.filter((w) => typeof w === "string").join("\n") : "";
  } else if (r.condition === "OUTSIDE_WINDOW") {
    f.windowDays = Array.isArray(p.days) ? p.days.filter((d): d is number => Number.isInteger(d)) : [];
    if (typeof p.start === "string") f.windowStart = p.start;
    if (typeof p.end === "string") f.windowEnd = p.end;
    if (typeof p.timezone === "string") f.timezone = p.timezone;
  } else if (r.condition === "DAILY_CAP_EXCEEDED") {
    if (typeof p.max === "number") f.capMax = String(p.max);
    if (p.scope === "organization" || p.scope === "channel") f.capScope = p.scope;
    if (typeof p.timezone === "string" && p.timezone !== "UTC") f.capTimezone = p.timezone;
  }
  return f;
}

/** field -> i18n key suffix under `policies.validation.`; {} when valid. */
export function validateForm(
  f: PolicyFormState,
  isValidZone: (z: string) => boolean = defaultIsValidZone
): Record<string, string> {
  const e: Record<string, string> = {};
  const name = f.name.trim();
  if (!name) e.name = "nameRequired";
  else if (name.length > POLICY_LIMITS.nameMax) e.name = "nameTooLong";

  const pr = f.priority.trim();
  if (!INT.test(pr) || Number(pr) < POLICY_LIMITS.priorityMin || Number(pr) > POLICY_LIMITS.priorityMax) {
    e.priority = "priorityInvalid";
  }

  if (f.condition === "CONTAINS_WORDS") {
    const list = rawWordList(f.words);
    if (list.length < 1) e.words = "wordsRequired";
    else if (list.length > POLICY_LIMITS.wordsMax) e.words = "wordsTooMany";
    else if (list.some((w) => w.length > POLICY_LIMITS.wordMax)) e.words = "wordTooLong";
    else if (new Set(list.map((w) => w.toLowerCase())).size !== list.length) e.words = "wordsDuplicate";
  } else if (f.condition === "OUTSIDE_WINDOW") {
    if (f.windowDays.length < 1) e.windowDays = "daysRequired";
    const startOk = TIME.test(f.windowStart);
    const endOk = TIME.test(f.windowEnd);
    if (!startOk) e.windowStart = "timeInvalid";
    if (!endOk) e.windowEnd = "timeInvalid";
    if (startOk && endOk && f.windowStart === f.windowEnd) e.windowEnd = "windowSame";
    const zone = f.timezone.trim();
    if (!zone || !isValidZone(zone)) e.timezone = "timezoneInvalid";
  } else if (f.condition === "DAILY_CAP_EXCEEDED") {
    const cap = f.capMax.trim();
    if (!INT.test(cap) || Number(cap) < POLICY_LIMITS.capMin || Number(cap) > POLICY_LIMITS.capMax) {
      e.capMax = "capInvalid";
    }
  }

  const providers = parseProviders(f.appliesToProviders);
  if (
    f.appliesToActorTypes.length > POLICY_LIMITS.filterMax ||
    f.appliesToApiKeyIds.length > POLICY_LIMITS.filterMax ||
    f.appliesToIntegrationIds.length > POLICY_LIMITS.filterMax ||
    providers.length > POLICY_LIMITS.filterMax
  ) {
    e.filters = "filtersTooMany";
  } else if (providers.some((p) => p.length > POLICY_LIMITS.filterMax)) {
    e.filters = "filtersTooLong";
  }
  return e;
}

export function toInput(f: PolicyFormState): PolicyInput {
  let conditionParams: Record<string, unknown> = {};
  if (f.condition === "CONTAINS_WORDS") {
    conditionParams = { words: parseWords(f.words) };
  } else if (f.condition === "OUTSIDE_WINDOW") {
    conditionParams = {
      days: Array.from(new Set(f.windowDays)).sort((a, b) => a - b),
      start: f.windowStart,
      end: f.windowEnd,
      timezone: f.timezone.trim(),
    };
  } else if (f.condition === "DAILY_CAP_EXCEEDED") {
    conditionParams = { max: Number(f.capMax.trim()), scope: f.capScope };
    if (f.capTimezone) conditionParams.timezone = f.capTimezone;
  }
  const input: PolicyInput = {
    name: f.name.trim(),
    enabled: f.enabled,
    priority: Number(f.priority.trim()),
    effect: f.effect,
    condition: f.condition,
    conditionParams,
    appliesToActorTypes: [...f.appliesToActorTypes] as PolicyActorType[],
    appliesToApiKeyIds: [...f.appliesToApiKeyIds],
    appliesToIntegrationIds: [...f.appliesToIntegrationIds],
    appliesToProviders: parseProviders(f.appliesToProviders),
  };
  // A flow only makes sense for a rule that requires approval; for a BLOCK rule
  // the key is left out (the server clears a stored flow when the effect changes).
  if (f.effect === "REQUIRE_APPROVAL") {
    if (f.approvalFlowId) input.approvalFlowId = f.approvalFlowId;
    else if (f.approvalFlowStored) input.approvalFlowId = null;
  }
  return input;
}

export type RuleFilterKey = "actorTypes" | "apiKeys" | "channels" | "providers";

/** Keys only (no translated text): which filters narrow the rule. */
export function ruleSummary(r: PolicyRule): { effect: PolicyEffect; condition: PolicyCondition; filters: RuleFilterKey[] } {
  const filters: RuleFilterKey[] = [];
  if (r.appliesToActorTypes?.length) filters.push("actorTypes");
  if (r.appliesToApiKeyIds?.length) filters.push("apiKeys");
  if (r.appliesToIntegrationIds?.length) filters.push("channels");
  if (r.appliesToProviders?.length) filters.push("providers");
  return { effect: r.effect, condition: r.condition, filters };
}
