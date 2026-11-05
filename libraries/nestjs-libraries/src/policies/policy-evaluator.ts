import { validateConditionParams } from './policy-params';
import { containsAnyWord, containsLink } from './policy-text';
import { isInsideWindow } from './policy-window';
import type {
  CapParams,
  PolicyContext,
  PolicyEvaluation,
  PolicyMatch,
  PolicyRuleInput,
  WindowParams,
  WordsParams,
} from './policy-types';

export const AUTOMATION_ACTOR_TYPES = ['API_KEY', 'OAUTH_CLIENT'] as const;

const actorMatches = (rule: PolicyRuleInput, actor: PolicyContext['actors'][number]): boolean => {
  const typeOk =
    rule.appliesToActorTypes.length === 0
      ? (AUTOMATION_ACTOR_TYPES as readonly string[]).includes(actor.type)
      : rule.appliesToActorTypes.includes(actor.type);
  if (!typeOk) return false;
  if (rule.appliesToApiKeyIds.length > 0) {
    return (
      actor.type === 'API_KEY' &&
      actor.apiKeyId !== undefined &&
      rule.appliesToApiKeyIds.includes(actor.apiKeyId)
    );
  }
  return true;
};

export function ruleApplies(rule: PolicyRuleInput, ctx: PolicyContext): boolean {
  if (!rule.enabled) return false;
  if (!ctx.actors.some((a) => actorMatches(rule, a))) return false;
  if (rule.appliesToIntegrationIds.length > 0 && !rule.appliesToIntegrationIds.includes(ctx.integrationId)) {
    return false;
  }
  if (rule.appliesToProviders.length > 0 && !rule.appliesToProviders.includes(ctx.provider)) {
    return false;
  }
  return true;
}

export function conditionHolds(rule: PolicyRuleInput, ctx: PolicyContext): boolean {
  const parsed = validateConditionParams(rule.condition, rule.conditionParams);
  if (!parsed.ok) return false;
  switch (rule.condition) {
    case 'ALWAYS':
      return true;
    case 'CONTAINS_LINK':
      return containsLink(ctx.text);
    case 'CONTAINS_WORDS':
      return containsAnyWord(ctx.text, (parsed.value as WordsParams).words);
    case 'OUTSIDE_WINDOW':
      return !isInsideWindow(ctx.scheduledAt, parsed.value as WindowParams);
    case 'PUBLISH_NOW':
      return ctx.action === 'PUBLISH_NOW';
    case 'HAS_VIDEO':
      return ctx.mediaTypes.includes('video');
    case 'DAILY_CAP_EXCEEDED': {
      const { max, scope } = parsed.value as CapParams;
      const counts = ctx.dailyCounts[rule.id];
      const used = counts ? counts[scope === 'channel' ? 'channel' : 'organization'] : 0;
      return used >= max;
    }
    default:
      return false;
  }
}

const compareRules = (a: PolicyRuleInput, b: PolicyRuleInput) =>
  a.priority - b.priority ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function evaluatePolicies(ctx: PolicyContext, rules: PolicyRuleInput[]): PolicyEvaluation {
  // PolicyInputTooLargeError from the text helpers is deliberately not caught: callers fail closed.
  const matched: PolicyMatch[] = [...rules]
    .sort(compareRules)
    .filter((r) => ruleApplies(r, ctx) && conditionHolds(r, ctx))
    .filter((r) => !(ctx.approved && r.effect === 'REQUIRE_APPROVAL'))
    .map((r) => ({ ruleId: r.id, name: r.name, effect: r.effect, condition: r.condition }));

  const effect = matched.some((m) => m.effect === 'BLOCK')
    ? 'BLOCK'
    : matched.some((m) => m.effect === 'REQUIRE_APPROVAL')
      ? 'REQUIRE_APPROVAL'
      : 'ALLOW';
  return { effect, matched };
}
