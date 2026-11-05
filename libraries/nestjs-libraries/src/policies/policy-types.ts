import type { ActorView, PostActorType } from '../actor/post-actor';

export const POLICY_CONDITIONS = [
  'ALWAYS',
  'CONTAINS_LINK',
  'CONTAINS_WORDS',
  'OUTSIDE_WINDOW',
  'DAILY_CAP_EXCEEDED',
  'PUBLISH_NOW',
  'HAS_VIDEO',
] as const;
export type PolicyConditionName = (typeof POLICY_CONDITIONS)[number];

export const POLICY_EFFECTS = ['REQUIRE_APPROVAL', 'BLOCK'] as const;
export type PolicyEffectName = (typeof POLICY_EFFECTS)[number];

export const POST_ACTIONS = ['DRAFT', 'SCHEDULE', 'PUBLISH_NOW'] as const;
export type PostActionName = (typeof POST_ACTIONS)[number];

export type WindowParams = { days: number[]; start: string; end: string; timezone: string };
export type CapParams = { max: number; scope: 'organization' | 'channel'; timezone?: string };
export type WordsParams = { words: string[] };

export type PolicyRuleInput = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  createdAt: Date;
  appliesToActorTypes: PostActorType[];
  appliesToApiKeyIds: string[];
  appliesToIntegrationIds: string[];
  appliesToProviders: string[];
  condition: PolicyConditionName;
  conditionParams: unknown;
  effect: PolicyEffectName;
};

export type PolicyContext = {
  phase: 'write' | 'publish';
  action: PostActionName;
  actors: ActorView[];
  integrationId: string;
  provider: string;
  text: string;
  mediaTypes: Array<'image' | 'video' | 'audio'>;
  scheduledAt: Date;
  approved: boolean;
  dailyCounts: Record<string, { organization: number; channel: number }>;
};

export type PolicyMatch = {
  ruleId: string;
  name: string;
  effect: PolicyEffectName;
  condition: PolicyConditionName;
};

export type PolicyEvaluation = { effect: 'ALLOW' | PolicyEffectName; matched: PolicyMatch[] };
