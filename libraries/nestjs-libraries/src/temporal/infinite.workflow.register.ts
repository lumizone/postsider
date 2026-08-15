import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

/**
 * Starts the self-looping cron workflows (missed-post recovery, media cleanup,
 * evergreen recycling) on the instance that sets RUN_CRON=true.
 *
 * Two silent-failure lessons are baked in (2026-07-22 audit):
 * - RUN_CRON used to be truthiness-checked, so `RUN_CRON=false` ENABLED crons
 *   while an UNSET var silently disabled them — production ran for weeks with
 *   none of the three workflows ever started. Now strictly `=== 'true'`, and
 *   we log loudly either way so `docker logs` always tells you which mode
 *   this instance is in.
 * - Registration errors were swallowed by empty catch blocks AND `?.` chains:
 *   if the Temporal client wasn't ready at backend boot, the crons just never
 *   started until the next redeploy. Now every start is retried with backoff
 *   and a final failure is an unmissable error log.
 */
@Injectable()
export class InfiniteWorkflowRegister implements OnModuleInit {
  private _logger = new Logger(InfiniteWorkflowRegister.name);

  constructor(private _temporalService: TemporalService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.RUN_CRON !== 'true') {
      this._logger.log(
        `RUN_CRON is ${JSON.stringify(
          process.env.RUN_CRON
        )} (needs the exact string "true") — cron workflows will NOT run on this instance`
      );
      return;
    }

    // Don't block module init: retry in the background so a slow Temporal
    // cannot stall the whole backend boot.
    this.registerAllWithRetry().catch((err) =>
      this._logger.error(`cron workflow registration crashed: ${err}`)
    );
  }

  private async registerAllWithRetry(): Promise<void> {
    const crons = [
      { type: 'missingPostWorkflow', id: 'missing-post-workflow' },
      { type: 'mediaCleanupWorkflow', id: 'media-cleanup-workflow' },
      { type: 'evergreenWorkflow', id: 'evergreen-workflow' },
    ] as const;
    const maxAttempts = 20;
    const delayMs = 15_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const pending: string[] = [];
      for (const cron of crons) {
        try {
          const workflow = this._temporalService.client
            ?.getRawClient()
            ?.workflow;
          if (!workflow) {
            throw new Error('Temporal client not available yet');
          }
          await workflow.start(cron.type, {
            workflowId: cron.id,
            taskQueue: 'main',
            workflowIdConflictPolicy: 'USE_EXISTING',
          });
        } catch (err) {
          pending.push(`${cron.type} (${err})`);
        }
      }

      if (pending.length === 0) {
        this._logger.log(
          `cron workflows armed: ${crons.map((c) => c.type).join(', ')}`
        );
        return;
      }

      if (attempt < maxAttempts) {
        this._logger.warn(
          `cron workflow registration attempt ${attempt}/${maxAttempts} incomplete: ${pending.join(
            '; '
          )} — retrying in ${delayMs / 1000}s`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        this._logger.error(
          `cron workflows FAILED to register after ${maxAttempts} attempts: ${pending.join(
            '; '
          )} — missed-post recovery / media cleanup / evergreen are NOT running; restart the backend once Temporal is reachable`
        );
      }
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [InfiniteWorkflowRegister],
  get exports() {
    return this.providers;
  },
})
export class InfiniteWorkflowRegisterModule {}
