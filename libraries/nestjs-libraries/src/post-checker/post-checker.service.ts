import { Injectable } from '@nestjs/common';
import pLimit from 'p-limit';
import { OpenaiService } from '@postsider/nestjs-libraries/openai/openai.service';
import { buildCheckPrompt } from './post-checker.prompt';
import { parseCheckResult } from './post-checker.validator';
import { buildRewritePrompt } from './rewrite.prompt';
import { parseRewriteResult } from './rewrite.validator';
import { RewriteInput, RewriteResult } from './rewrite.types';
import { CheckInput, CheckResult } from './post-checker.types';

// Cloud build: Post Checker and caption rewrite reuse the platform OpenAI
// integration (OpenaiService) rather than the OSS bring-your-own-key path.
// No per-org key is stored, so there is no config endpoint here.
@Injectable()
export class PostCheckerService {
  constructor(private _openai: OpenaiService) {}

  async check(
    orgId: string,
    base: Omit<CheckInput, 'platform'>,
    platforms: string[]
  ) {
    const limit = pLimit(3);
    const entries = await Promise.all(
      platforms.map((platform) =>
        limit(
          async (): Promise<[string, CheckResult | { error: string }]> => {
            try {
              const raw = await this._openai.complete(
                buildCheckPrompt({ ...base, platform })
              );
              return [platform, parseCheckResult(raw)];
            } catch (e: any) {
              return [platform, { error: e?.message || 'failed' }];
            }
          }
        )
      )
    );
    return Object.fromEntries(entries);
  }

  async rewrite(orgId: string, input: RewriteInput): Promise<RewriteResult> {
    const raw = await this._openai.complete(buildRewritePrompt(input));
    return parseRewriteResult(raw, input.count ?? 3);
  }
}
