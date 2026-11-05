// Pure filter state for the Agent Control Center list. Relative imports only.

export type AgentBucket =
  | "all"
  | "attention"
  | "failed"
  | "review"
  | "blocked"
  | "retryable"
  | "unknown_outcome"
  | "failed_other"
  | "published"
  | "scheduled"
  | "draft"
  | "held";

export type AgentFilters = {
  bucket: AgentBucket;
  scope: "relevant" | "automation";
  integrationIds: string[];
  /** raw `actor` query value, e.g. `API_KEY:<id>` */
  actor: string;
  /** raw stored value (not the cleaned label) */
  agentName: string;
  /** raw stored value (not the cleaned label) */
  source: string;
  /** 'YYYY-MM-DD' local day, '' = unset */
  from: string;
  to: string;
};

const BUCKETS: AgentBucket[] = [
  "all", "attention", "failed", "review", "blocked", "retryable", "unknown_outcome",
  "failed_other", "published", "scheduled", "draft", "held",
];

export const MAX_INTEGRATION_IDS = 20;
const MAX_TEXT = 255;

export const DEFAULT_FILTERS: AgentFilters = {
  bucket: "attention",
  scope: "relevant",
  integrationIds: [],
  actor: "",
  agentName: "",
  source: "",
  from: "",
  to: "",
};

function parseDay(raw: string | null): { y: number; m: number; d: number } | null {
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
  return { y, m, d };
}

const cleanText = (raw: string | null): string => (raw ?? "").slice(0, MAX_TEXT);

export function filtersFromSearch(search: string): AgentFilters {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const bucket = params.get("bucket");
  const scope = params.get("scope");
  const ids = (params.get("integrationIds") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  const unique = Array.from(new Set(ids)).slice(0, MAX_INTEGRATION_IDS);
  return {
    bucket: BUCKETS.includes(bucket as AgentBucket) ? (bucket as AgentBucket) : DEFAULT_FILTERS.bucket,
    scope: scope === "automation" ? "automation" : "relevant",
    integrationIds: unique,
    actor: cleanText(params.get("actor")),
    agentName: cleanText(params.get("agentName")),
    source: cleanText(params.get("source")),
    from: parseDay(params.get("from")) ? (params.get("from") as string) : "",
    to: parseDay(params.get("to")) ? (params.get("to") as string) : "",
  };
}

export function filtersToSearch(f: AgentFilters): string {
  const params = new URLSearchParams();
  if (f.bucket !== DEFAULT_FILTERS.bucket) params.set("bucket", f.bucket);
  if (f.scope !== DEFAULT_FILTERS.scope) params.set("scope", f.scope);
  if (f.integrationIds.length > 0) params.set("integrationIds", f.integrationIds.join(","));
  if (f.actor) params.set("actor", f.actor);
  if (f.agentName) params.set("agentName", f.agentName);
  if (f.source) params.set("source", f.source);
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  return params.toString();
}

export function toApiQuery(f: AgentFilters, limit?: number): Record<string, string> {
  const q: Record<string, string> = { bucket: f.bucket, scope: f.scope };
  if (f.integrationIds.length > 0) q.integrationIds = f.integrationIds.join(",");
  if (f.actor) q.actor = f.actor;
  if (f.agentName) q.agentName = f.agentName;
  if (f.source) q.source = f.source;
  const from = parseDay(f.from);
  if (from) q.from = new Date(from.y, from.m - 1, from.d, 0, 0, 0, 0).toISOString();
  const to = parseDay(f.to);
  if (to) q.to = new Date(to.y, to.m - 1, to.d, 23, 59, 59, 999).toISOString();
  if (limit !== undefined) q.limit = String(limit);
  return q;
}

export function hasActiveFilters(f: AgentFilters): boolean {
  return filtersToSearch(f) !== "";
}
