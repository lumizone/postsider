import { Injectable } from '@nestjs/common';
import { ProviderCredentialsService } from '@postsider/nestjs-libraries/database/prisma/integrations/provider-credentials.service';

/**
 * Maps provider identifiers to the environment variable names they expect.
 * Used to temporarily inject DB-stored credentials into process.env before
 * calling provider methods that rely on env vars (posting, refreshing, etc.).
 */
const ENV_MAPPINGS: Record<string, Record<string, 'clientId' | 'clientSecret'>> = {
  x: { X_API_KEY: 'clientId', X_API_SECRET: 'clientSecret' },
  linkedin: { LINKEDIN_CLIENT_ID: 'clientId', LINKEDIN_CLIENT_SECRET: 'clientSecret' },
  'linkedin-page': { LINKEDIN_CLIENT_ID: 'clientId', LINKEDIN_CLIENT_SECRET: 'clientSecret' },
  facebook: { FACEBOOK_APP_ID: 'clientId', FACEBOOK_APP_SECRET: 'clientSecret' },
  instagram: { FACEBOOK_APP_ID: 'clientId', FACEBOOK_APP_SECRET: 'clientSecret' },
  'instagram-standalone': { INSTAGRAM_APP_ID: 'clientId', INSTAGRAM_APP_SECRET: 'clientSecret' },
  threads: { THREADS_APP_ID: 'clientId', THREADS_APP_SECRET: 'clientSecret' },
  youtube: { YOUTUBE_CLIENT_ID: 'clientId', YOUTUBE_CLIENT_SECRET: 'clientSecret' },
  gmb: { YOUTUBE_CLIENT_ID: 'clientId', YOUTUBE_CLIENT_SECRET: 'clientSecret' },
  blogger: { YOUTUBE_CLIENT_ID: 'clientId', YOUTUBE_CLIENT_SECRET: 'clientSecret' },
  tiktok: { TIKTOK_CLIENT_ID: 'clientId', TIKTOK_CLIENT_SECRET: 'clientSecret' },
  pinterest: { PINTEREST_CLIENT_ID: 'clientId', PINTEREST_CLIENT_SECRET: 'clientSecret' },
  dribbble: { DRIBBBLE_CLIENT_ID: 'clientId', DRIBBBLE_CLIENT_SECRET: 'clientSecret' },
  discord: { DISCORD_CLIENT_ID: 'clientId', DISCORD_CLIENT_SECRET: 'clientSecret' },
  slack: { SLACK_ID: 'clientId', SLACK_SECRET: 'clientSecret' },
  twitch: { TWITCH_CLIENT_ID: 'clientId', TWITCH_CLIENT_SECRET: 'clientSecret' },
  mastodon: { MASTODON_CLIENT_ID: 'clientId', MASTODON_CLIENT_SECRET: 'clientSecret' },
  whop: { WHOP_CLIENT_ID: 'clientId', WHOP_CLIENT_SECRET: 'clientSecret' },
};

@Injectable()
export class ProviderEnvHelper {
  constructor(
    private _providerCredentialsService: ProviderCredentialsService,
  ) {}

  // Per-provider async mutex tails. process.env is process-global, so injecting
  // two orgs' creds for the same provider concurrently can leak one org's
  // secret into another org's request. Serializing per provider makes the
  // injection window single-threaded (the race is structurally impossible),
  // at the cost of serializing concurrent same-provider calls from different
  // orgs. The proper long-term fix is passing creds explicitly through the
  // provider contract instead of touching process.env at all.
  private tails = new Map<string, Promise<void>>();

  private async serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, tail);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  /**
   * Executes a function with provider credentials temporarily injected into
   * process.env. If credentials exist in the DB for this org+provider AND the
   * env vars are not already set (non-empty), inject them for the duration of
   * the call and restore afterwards.
   */
  async withCredentials<T>(
    orgId: string,
    providerIdentifier: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const mapping = ENV_MAPPINGS[providerIdentifier];
    if (!mapping) {
      // No env mapping for this provider — just run directly
      return fn();
    }

    return this.serialize(providerIdentifier, async () => {
      // Check if env vars are already properly set (non-empty)
      const alreadySet = Object.keys(mapping).every(
        (key) => !!process.env[key]?.trim()
      );
      if (alreadySet) {
        // Env is already configured — no need to inject from DB
        return fn();
      }

      // Try to get credentials from DB
      const creds = await this._providerCredentialsService.getCredentials(
        orgId,
        providerIdentifier,
      );
      if (!creds || !creds.clientId || !creds.clientSecret) {
        // No DB creds either — run with whatever is in env (may fail)
        return fn();
      }

      // Inject credentials into process.env
      const originalEnv: Record<string, string | undefined> = {};
      for (const [envKey, credKey] of Object.entries(mapping)) {
        originalEnv[envKey] = process.env[envKey];
        if (credKey === 'clientId') process.env[envKey] = creds.clientId;
        else if (credKey === 'clientSecret') process.env[envKey] = creds.clientSecret;
      }

      try {
        return await fn();
      } finally {
        // Restore original env vars
        for (const [envKey] of Object.entries(mapping)) {
          if (originalEnv[envKey] === undefined) delete process.env[envKey];
          else process.env[envKey] = originalEnv[envKey];
        }
      }
    });
  }
}
