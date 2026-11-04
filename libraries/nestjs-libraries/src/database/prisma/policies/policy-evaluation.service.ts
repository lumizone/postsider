import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import { recordPostEvent } from '@postsider/nestjs-libraries/database/prisma/audit/post-audit';
import { PolicyRulesRepository } from '@postsider/nestjs-libraries/database/prisma/policies/policy-rules.repository';
import { PolicyRulesService } from '@postsider/nestjs-libraries/database/prisma/policies/policy-rules.service';
import { PostsRepository } from '@postsider/nestjs-libraries/database/prisma/posts/posts.repository';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  actorToColumns,
  actorViewFromColumns,
  type ActorView,
  type PostActor,
} from '@postsider/nestjs-libraries/actor/post-actor';
import { AUTOMATION_ACTOR_TYPES, evaluatePolicies, ruleApplies } from '@postsider/nestjs-libraries/policies/policy-evaluator';
import { validateConditionParams } from '@postsider/nestjs-libraries/policies/policy-params';
import { PolicyInputTooLargeError, deriveMediaTypeFromPath, htmlToPolicyText } from '@postsider/nestjs-libraries/policies/policy-text';
import type {
  CapParams,
  PolicyContext,
  PolicyEvaluation,
  PolicyMatch,
  PolicyRuleInput,
  PostActionName,
} from '@postsider/nestjs-libraries/policies/policy-types';
import { dayBounds } from '@postsider/nestjs-libraries/policies/policy-window';

export type PolicyTarget = {
  integrationId: string;
  provider: string;
  action: PostActionName;
  actors: ActorView[];
  text: string;
  mediaTypes: Array<'image' | 'video' | 'audio'>;
  scheduledAt: Date;
  approved: boolean;
  excludePostId?: string;
};

export type PolicyOutcome = {
  effect: PolicyEvaluation['effect'];
  matched: PolicyMatch[];
  channels: Array<{
    integrationId: string;
    effect: PolicyEvaluation['effect'];
    matched: PolicyMatch[];
  }>;
};

type DraftBody = {
  type: 'draft' | 'schedule' | 'now';
  date?: string;
  posts: Array<{
    integration: { id: string };
    value: Array<{ content: string; image?: Array<{ path: string }> }>;
    firstComment?: string | null;
  }>;
};

const MAX_AUDITED_RULES = 5;
const MAX_AUDITED_NAMES_CHARS = 190;
/** Longest thread chain evaluated; longer chains fail closed. */
export const MAX_THREAD_DEPTH = 100;
const EFFECT_RANK = { ALLOW: 0, REQUIRE_APPROVAL: 1, BLOCK: 2 } as const;

const ACTION_BY_TYPE: Record<DraftBody['type'], PostActionName> = {
  draft: 'DRAFT',
  schedule: 'SCHEDULE',
  now: 'PUBLISH_NOW',
};

const isAutomation = (t: PolicyTarget) =>
  t.actors.some((a) => (AUTOMATION_ACTOR_TYPES as readonly string[]).includes(a.type));

const joinText = (parts: Array<string | null | undefined>) =>
  parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('\n');

const actorKey = (a: ActorView) => [a.type, a.userId, a.apiKeyId, a.oauthClientId].join('|');

const pathsOfStoredImage = (image: unknown): string[] => {
  if (typeof image !== 'string' || image.length === 0) return [];
  try {
    const parsed = JSON.parse(image);
    return Array.isArray(parsed)
      ? parsed.map((m) => (m && typeof m.path === 'string' ? m.path : '')).filter(Boolean)
      : [];
  } catch {
    return [];
  }
};

/** Whole names only, within the audit metadata string limit; an ellipsis marks omissions. */
const joinNames = (names: string[]): string => {
  let out = '';
  for (let i = 0; i < names.length; i++) {
    const next = out ? `${out} | ${names[i]}` : names[i];
    if (next.length > MAX_AUDITED_NAMES_CHARS) {
      if (!out) return `${names[i].slice(0, MAX_AUDITED_NAMES_CHARS - 3)}...`;
      return `${out} | ...`;
    }
    out = next;
  }
  return out;
};

const uniqueMediaTypes = (paths: string[]) => [...new Set(paths.map(deriveMediaTypeFromPath))];

@Injectable()
export class PolicyEvaluationService {
  constructor(
    private _rules: PolicyRulesRepository,
    private _rulesService: PolicyRulesService,
    private _posts: PostsRepository,
    private _integrations: IntegrationService,
    @Optional() private _audit?: AuditLogger
  ) {}

  /**
   * Evaluates every target against the organization's enabled rules. Errors,
   * including PolicyInputTooLargeError, propagate so callers fail closed.
   */
  async evaluateTargets(
    orgId: string,
    targets: PolicyTarget[],
    phase: 'write' | 'publish'
  ): Promise<PolicyOutcome> {
    const rules = this._rulesService.toRuleInputs(await this._rules.listEnabled(orgId));
    const order = new Map(
      [...rules]
        .sort(
          (a, b) =>
            a.priority - b.priority ||
            a.createdAt.getTime() - b.createdAt.getTime() ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        )
        .map((r, i) => [r.id, i] as const)
    );

    const channels: PolicyOutcome['channels'] = [];
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      const ctx: PolicyContext = {
        phase,
        action: target.action,
        actors: target.actors,
        integrationId: target.integrationId,
        provider: target.provider,
        text: target.text,
        mediaTypes: target.mediaTypes,
        scheduledAt: target.scheduledAt,
        approved: target.approved,
        dailyCounts: {},
      };
      ctx.dailyCounts = await this.dailyCountsFor(orgId, rules, ctx, target, targets.slice(0, index));
      const result = evaluatePolicies(ctx, rules);
      channels.push({ integrationId: target.integrationId, ...result });
    }

    const seen = new Set<string>();
    const matched: PolicyMatch[] = [];
    for (const c of channels) {
      for (const m of c.matched) {
        if (!seen.has(m.ruleId)) {
          seen.add(m.ruleId);
          matched.push(m);
        }
      }
    }
    matched.sort((a, b) => (order.get(a.ruleId) ?? 0) - (order.get(b.ruleId) ?? 0));

    let effect: PolicyEvaluation['effect'] = 'ALLOW';
    for (const c of channels) {
      if (EFFECT_RANK[c.effect] > EFFECT_RANK[effect]) effect = c.effect;
    }
    return { effect, matched, channels };
  }

  async targetsFromDraftBody(
    orgId: string,
    body: DraftBody,
    actor: PostActor
  ): Promise<PolicyTarget[]> {
    const action = ACTION_BY_TYPE[body.type];
    const scheduledAt = this.resolveDate(body);
    const view = actorViewFromColumns(actorToColumns(actor, 'createdBy'), 'createdBy') as ActorView;

    const targets: PolicyTarget[] = [];
    for (const post of body.posts) {
      const integration = await this._integrations.getIntegrationById(orgId, post.integration.id);
      if (!integration || integration.deletedAt) throw new NotFoundException({ msg: 'Channel not found' });
      const values = post.value ?? [];
      targets.push({
        integrationId: integration.id,
        provider: integration.providerIdentifier,
        action,
        actors: [view],
        text: joinText([
          ...values.map((v) => htmlToPolicyText(v.content ?? '')),
          post.firstComment ? htmlToPolicyText(post.firstComment) : undefined,
        ]),
        mediaTypes: uniqueMediaTypes(
          values.flatMap((v) => (v.image ?? []).map((i) => i.path))
        ),
        scheduledAt,
        approved: false,
      });
    }
    return targets;
  }

  /** Top level rows of a group, scoped to the organization (retry gate). */
  topLevelRowsOfGroup(orgId: string, group: string) {
    return this._posts.getTopLevelPostsByGroup(orgId, group);
  }

  async targetFromStoredPost(
    orgId: string,
    postId: string,
    opts: { action: PostActionName; approved: boolean }
  ): Promise<PolicyTarget | null> {
    const post: any = await this._posts.getPost(postId, true, orgId);
    if (!post || !post.integration) return null;
    const children = await this.threadAfter(orgId, post);

    const actors: ActorView[] = [];
    for (const prefix of ['createdBy', 'lastModifiedBy'] as const) {
      const view = actorViewFromColumns(post, prefix);
      if (view && !actors.some((a) => actorKey(a) === actorKey(view))) actors.push(view);
    }

    return {
      integrationId: post.integrationId,
      provider: post.integration.providerIdentifier,
      action: opts.action,
      actors,
      text: joinText([
        htmlToPolicyText(post.content ?? ''),
        ...children.map((c) => htmlToPolicyText(c.content ?? '')),
        post.firstComment ? htmlToPolicyText(post.firstComment) : undefined,
      ]),
      mediaTypes: uniqueMediaTypes([
        ...pathsOfStoredImage(post.image),
        ...children.flatMap((c) => pathsOfStoredImage(c.image)),
      ]),
      scheduledAt: post.publishDate,
      approved: opts.approved,
      excludePostId: post.id,
    };
  }

  /** Best effort: ALLOW is not recorded and a failed audit write never throws. */
  async recordOutcome(
    orgId: string,
    outcome: PolicyOutcome,
    phase: 'write' | 'publish',
    target: { postId?: string }
  ): Promise<void> {
    if (outcome.effect === 'ALLOW') return;
    const listed = outcome.matched.slice(0, MAX_AUDITED_RULES);
    await recordPostEvent(this._audit, {
      organizationId: orgId,
      event: 'post.policy_evaluated',
      targetType: target.postId ? 'post' : 'organization',
      targetId: target.postId ?? orgId,
      metadata: {
        effect: outcome.effect,
        phase,
        matchedCount: outcome.matched.length,
        ruleIds: listed.map((m) => m.ruleId).join(','),
        ruleNames: joinNames(listed.map((m) => m.name)),
      },
    });
  }

  /**
   * Threads are stored as a chain (value N's parent is value N-1), so the whole
   * chain is walked, like PostsService.getPostsRecursively. Deleted rows end the walk.
   */
  private async threadAfter(orgId: string, root: any): Promise<any[]> {
    const chain: any[] = [];
    let current = root;
    for (;;) {
      const next = (current.childrenPost ?? []).find((c: any) => !c.deletedAt);
      if (!next) return chain;
      if (chain.length >= MAX_THREAD_DEPTH) {
        throw new PolicyInputTooLargeError(
          chain.length,
          `Thread longer than ${MAX_THREAD_DEPTH} values`
        );
      }
      const loaded: any = await this._posts.getPost(next.id, false, orgId);
      if (!loaded) return chain;
      chain.push(loaded);
      current = loaded;
    }
  }

  private resolveDate(body: DraftBody): Date {
    if (body.type === 'now') return new Date();
    if (body.type === 'draft' && !body.date) return new Date();
    const date = body.date ? new Date(body.date) : new Date(NaN);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException({ msg: 'A valid date is required' });
    }
    return date;
  }

  private async dailyCountsFor(
    orgId: string,
    rules: PolicyRuleInput[],
    ctx: PolicyContext,
    target: PolicyTarget,
    earlier: PolicyTarget[]
  ): Promise<PolicyContext['dailyCounts']> {
    const counts: PolicyContext['dailyCounts'] = {};
    for (const rule of rules) {
      if (rule.condition !== 'DAILY_CAP_EXCEEDED') continue;
      if (!ruleApplies(rule, ctx)) continue;
      const parsed = validateConditionParams(rule.condition, rule.conditionParams);
      if (!parsed.ok) continue;
      const { scope, timezone } = parsed.value as CapParams;
      const tz = timezone ?? 'UTC';
      const range = dayBounds(target.scheduledAt, tz);
      const stored = await this._posts.countAutomationPostsInRange(
        orgId,
        range,
        scope === 'channel'
          ? { integrationId: target.integrationId, excludePostId: target.excludePostId }
          : { excludePostId: target.excludePostId }
      );
      const inRequest = earlier.filter(
        (e) =>
          e.action !== 'DRAFT' &&
          isAutomation(e) &&
          e.scheduledAt >= range.start &&
          e.scheduledAt < range.end &&
          (scope === 'organization' || e.integrationId === target.integrationId)
      ).length;
      const used = stored + inRequest;
      counts[rule.id] = scope === 'channel' ? { organization: 0, channel: used } : { organization: used, channel: 0 };
    }
    return counts;
  }
}
