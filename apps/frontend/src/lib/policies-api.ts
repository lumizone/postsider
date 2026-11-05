"use client";

import { api } from "@/lib/api";

// Types mirror the dashboard /policies JSON (apps/backend/src/api/routes/policies.controller.ts).
// `name` is the raw stored name and belongs ONLY in the edit input; render `displayName`
// everywhere else (list, chips, tooltips, confirm dialogs).

export type PolicyCondition =
  | "ALWAYS"
  | "CONTAINS_LINK"
  | "CONTAINS_WORDS"
  | "OUTSIDE_WINDOW"
  | "DAILY_CAP_EXCEEDED"
  | "PUBLISH_NOW"
  | "HAS_VIDEO";

export type PolicyEffect = "REQUIRE_APPROVAL" | "BLOCK";

export type PolicyActorType = "USER" | "API_KEY" | "OAUTH_CLIENT" | "SYSTEM";

export interface PolicyRule {
  id: string;
  name: string;
  displayName: string;
  enabled: boolean;
  priority: number;
  appliesToActorTypes: PolicyActorType[];
  appliesToApiKeyIds: string[];
  appliesToIntegrationIds: string[];
  appliesToProviders: string[];
  condition: PolicyCondition;
  conditionParams: unknown;
  effect: PolicyEffect;
  /** Approval flow used when the rule requires approval; null/absent = the default flow. */
  approvalFlowId?: string | null;
  createdAt?: string;
}

export interface PolicyInput {
  name: string;
  enabled: boolean;
  priority: number;
  effect: PolicyEffect;
  condition: PolicyCondition;
  conditionParams: Record<string, unknown>;
  appliesToActorTypes: PolicyActorType[];
  appliesToApiKeyIds: string[];
  appliesToIntegrationIds: string[];
  appliesToProviders: string[];
  /** Only sent for REQUIRE_APPROVAL rules: an id picks a flow, null clears it. */
  approvalFlowId?: string | null;
}

export type EvaluateAsActor = {
  type: PolicyActorType;
  apiKeyId?: string;
};

export interface EvaluateBody {
  type: "draft" | "schedule" | "now";
  date?: string;
  posts: Array<{
    integration: { id: string };
    value: Array<{ content: string; image?: Array<{ path: string }> }>;
  }>;
  asActor?: EvaluateAsActor;
}

export interface EvaluateMatch {
  ruleId: string;
  name: string;
  effect: PolicyEffect;
  condition: PolicyCondition;
}

export interface EvaluateResult {
  effect: "ALLOW" | PolicyEffect;
  matched: EvaluateMatch[];
  channels: Array<{ integrationId: string; effect: "ALLOW" | PolicyEffect }>;
  key: { allowed: true } | { allowed: false; code?: string };
}

export async function listPolicies(): Promise<PolicyRule[]> {
  const res = await api.get<{ policies: PolicyRule[] }>("/policies");
  return Array.isArray(res?.policies) ? res.policies : [];
}

export function createPolicy(input: PolicyInput): Promise<PolicyRule> {
  return api.post<PolicyRule>("/policies", input);
}

export function updatePolicy(id: string, patch: Partial<PolicyInput>): Promise<PolicyRule> {
  return api.put<PolicyRule>(`/policies/${encodeURIComponent(id)}`, patch);
}

export async function deletePolicy(id: string): Promise<void> {
  await api.del(`/policies/${encodeURIComponent(id)}`);
}

export function evaluatePolicy(body: EvaluateBody): Promise<EvaluateResult> {
  return api.post<EvaluateResult>("/policies/evaluate", body);
}

export interface PolicyApiKeyChoice {
  id: string;
  name: string;
}

/** Existing API keys, for the "API keys" filter and the dry run "As" selector. */
export async function listApiKeyChoices(): Promise<PolicyApiKeyChoice[]> {
  const res = await api.get<PolicyApiKeyChoice[]>("/settings/api-keys");
  return Array.isArray(res) ? res.map((k) => ({ id: k.id, name: k.name })) : [];
}
