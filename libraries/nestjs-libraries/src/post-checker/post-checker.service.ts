import { Injectable } from '@nestjs/common';
import pLimit from 'p-limit';
import { ProviderCredentialsService } from '@postsider/nestjs-libraries/database/prisma/integrations/provider-credentials.service';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { getPlatformAiConfig, isPlatformAiEnabled } from '@postsider/nestjs-libraries/services/ai.flag';
import {
  AiQuotaExceededError,
  SubscriptionService,
} from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OpenaiCheckProvider } from './providers/openai.check.provider';
import { DeepseekCheckProvider } from './providers/deepseek.check.provider';
import { GeminiCheckProvider } from './providers/gemini.check.provider';
import { pickProvider } from './provider.factory';
import { buildCheckPrompt } from './post-checker.prompt';
import { parseCheckResult } from './post-checker.validator';
import { buildRewritePrompt } from './rewrite.prompt';
import { parseRewriteResult } from './rewrite.validator';
import { RewriteInput, RewriteResult } from './rewrite.types';
import {
  CheckInput,
  CheckProvider,
  CheckResult,
  LlmConfig,
  LlmProvider,
} from './post-checker.types';
import type { BrandContext } from './brand-context';

const STORE_KEY = 'post-checker';
const CHECK_MAX_TOKENS = 400;
const REWRITE_MAX_TOKENS = 600;
export class NoCheckerConfigError extends Error {}

// Unified Post Checker / caption rewrite.
//  - Platform AI on (AI_API_KEY or OPENAI_API_KEY set, cloud): use the shared
//    provider, quota-bound by subscription tier.
//  - Platform AI off (self-host): use the per-org bring-your-own-key stored in
//    ProviderCredentials. No stored key -> NoCheckerConfigError (controller -> 409).
@Injectable()
export class PostCheckerService {
  private providers: LlmProvider[];
  constructor(
    private _creds: ProviderCredentialsService,
    private _organizations: OrganizationRepository,
    private _subscriptions: SubscriptionService,
    openaiByo: OpenaiCheckProvider,
    deepseek: DeepseekCheckProvider,
    gemini: GeminiCheckProvider
  ) {
    this.providers = [openaiByo, deepseek, gemini];
  }

  // ---- self-host BYO config (no-op surface when platform AI is on) ----
  async getConfig(
    orgId: string
  ): Promise<{ provider: CheckProvider; model: string } | null> {
    const row = await this._creds.getCredentials(orgId, STORE_KEY);
    if (!row) return null;
    return { provider: row.extraData?.provider, model: row.extraData?.model };
  }

  async saveConfig(
    orgId: string,
    provider: CheckProvider,
    model: string,
    apiKey: string
  ) {
    return this._creds.saveCredentials(orgId, STORE_KEY, provider, apiKey, {
      provider,
      model,
    });
  }

  async deleteConfig(orgId: string) {
    return this._creds.deleteCredentials(orgId, STORE_KEY);
  }

  private async loadLlmConfig(orgId: string): Promise<LlmConfig> {
    const row = await this._creds.getCredentials(orgId, STORE_KEY);
    if (!row || !row.extraData?.provider) {
      throw new NoCheckerConfigError('No post-checker config');
    }
    return {
      provider: row.extraData.provider,
      model: row.extraData.model,
      apiKey: row.clientSecret,
    };
  }

  private async loadBrandContext(orgId: string): Promise<BrandContext | undefined> {
    const org = await this._organizations.getOrgById(orgId);
    if (!org) return undefined;
    return {
      voice: org.brandVoice,
      audience: org.brandAudience,
      rules: org.brandRules,
      forbiddenWords: org.brandForbiddenWords,
    };
  }

  private async runChecks(
    platforms: string[],
    run: (platform: string) => Promise<CheckResult>,
    onSuccess?: () => void
  ) {
    const limit = pLimit(3);
    const entries = await Promise.all(
      platforms.map((platform) =>
        limit(
          async (): Promise<[string, CheckResult | { error: string }]> => {
            try {
              const result = await run(platform);
              onSuccess?.();
              return [platform, result];
            } catch (e: any) {
              if (e instanceof AiQuotaExceededError) throw e;
              return [platform, { error: e?.message || 'failed' }];
            }
          }
        )
      )
    );
    return Object.fromEntries(entries);
  }

  async check(
    orgId: string,
    base: Omit<CheckInput, 'platform'>,
    platforms: string[]
  ) {
    const brandContext = await this.loadBrandContext(orgId);
    if (isPlatformAiEnabled()) {
      const config = getPlatformAiConfig()!;
      const provider = pickProvider(this.providers, config.provider);
      const reservationId = await this._subscriptions.reserveAiCredits(orgId, platforms.length);
      let completed = 0;
      try {
        return await this.runChecks(
          platforms,
          async (platform) =>
            // Successful provider responses consume one reserved action.
            parseCheckResult(
              await provider.complete(
                config,
                buildCheckPrompt({ ...base, platform, brandContext }),
                0.3,
                CHECK_MAX_TOKENS
              )
            ),
          () => { completed += 1; }
        );
      } finally {
        await this._subscriptions.releaseAiCredits(
          reservationId,
          platforms.length - completed
        );
      }
    }
    const config = await this.loadLlmConfig(orgId); // throws -> 409
    const provider = pickProvider(this.providers, config.provider);
    return this.runChecks(platforms, async (platform) =>
      parseCheckResult(
        await provider.complete(
          config,
          buildCheckPrompt({ ...base, platform, brandContext }),
          0.3,
          CHECK_MAX_TOKENS
        )
      )
    );
  }

  async rewrite(orgId: string, input: RewriteInput): Promise<RewriteResult> {
    const brandContext = await this.loadBrandContext(orgId);
    const contextualInput = { ...input, brandContext };
    if (isPlatformAiEnabled()) {
      const config = getPlatformAiConfig()!;
      const provider = pickProvider(this.providers, config.provider);
      return this._subscriptions.useAiCredits(orgId, 1, async () =>
        parseRewriteResult(
          await provider.complete(
            config,
            buildRewritePrompt(contextualInput),
            0.7,
            REWRITE_MAX_TOKENS
          ),
          input.count ?? 3
        )
      );
    }
    const config = await this.loadLlmConfig(orgId); // throws -> 409
    const provider = pickProvider(this.providers, config.provider);
    const raw = await provider.complete(
      config,
      buildRewritePrompt(contextualInput),
      0.7,
      REWRITE_MAX_TOKENS
    );
    return parseRewriteResult(raw, input.count ?? 3);
  }
}
