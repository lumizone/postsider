import { Injectable } from '@nestjs/common';
import pLimit from 'p-limit';
import { OpenaiService } from '@postsider/nestjs-libraries/openai/openai.service';
import { ProviderCredentialsService } from '@postsider/nestjs-libraries/database/prisma/integrations/provider-credentials.service';
import { isPlatformAiEnabled } from '@postsider/nestjs-libraries/services/ai.flag';
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

const STORE_KEY = 'post-checker';
export class NoCheckerConfigError extends Error {}

// Unified Post Checker / caption rewrite.
//  - Platform AI on  (OPENAI_API_KEY set, cloud): use OpenaiService.
//  - Platform AI off (self-host): use the per-org bring-your-own-key stored in
//    ProviderCredentials. No stored key -> NoCheckerConfigError (controller -> 409).
@Injectable()
export class PostCheckerService {
  private providers: LlmProvider[];
  constructor(
    private _openai: OpenaiService,
    private _creds: ProviderCredentialsService,
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

  private async runChecks(
    platforms: string[],
    run: (platform: string) => Promise<string>
  ) {
    const limit = pLimit(3);
    const entries = await Promise.all(
      platforms.map((platform) =>
        limit(
          async (): Promise<[string, CheckResult | { error: string }]> => {
            try {
              return [platform, parseCheckResult(await run(platform))];
            } catch (e: any) {
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
    if (isPlatformAiEnabled()) {
      return this.runChecks(platforms, (platform) =>
        this._openai.complete(buildCheckPrompt({ ...base, platform }))
      );
    }
    const config = await this.loadLlmConfig(orgId); // throws -> 409
    const provider = pickProvider(this.providers, config.provider);
    return this.runChecks(platforms, (platform) =>
      provider.complete(config, buildCheckPrompt({ ...base, platform }))
    );
  }

  async rewrite(orgId: string, input: RewriteInput): Promise<RewriteResult> {
    if (isPlatformAiEnabled()) {
      const raw = await this._openai.complete(buildRewritePrompt(input));
      return parseRewriteResult(raw, input.count ?? 3);
    }
    const config = await this.loadLlmConfig(orgId); // throws -> 409
    const provider = pickProvider(this.providers, config.provider);
    const raw = await provider.complete(config, buildRewritePrompt(input));
    return parseRewriteResult(raw, input.count ?? 3);
  }
}
