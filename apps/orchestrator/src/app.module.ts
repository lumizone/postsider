import { Module } from '@nestjs/common';
import { PostActivity } from '@postsider/orchestrator/activities/post.activity';
import { getTemporalModule } from '@postsider/nestjs-libraries/temporal/temporal.module';
import { DatabaseModule } from '@postsider/nestjs-libraries/database/prisma/database.module';
import { EmailActivity } from '@postsider/orchestrator/activities/email.activity';
import { IntegrationsActivity } from '@postsider/orchestrator/activities/integrations.activity';
import { MediaCleanupActivity } from '@postsider/orchestrator/activities/media.cleanup.activity';
import { R2MultipartCleanupActivity } from '@postsider/orchestrator/activities/r2.multipart.cleanup.activity';
import { EvergreenActivity } from '@postsider/orchestrator/activities/evergreen.activity';
import { CollectAnalyticsActivity } from '@postsider/orchestrator/activities/collect.analytics.activity';
import { HealthController } from '@postsider/orchestrator/health.controller';

const activities = [
  PostActivity,
  EmailActivity,
  IntegrationsActivity,
  MediaCleanupActivity,
  R2MultipartCleanupActivity,
  EvergreenActivity,
  CollectAnalyticsActivity,
];
@Module({
  imports: [
    DatabaseModule,
    getTemporalModule(true, require.resolve('./workflows'), activities),
  ],
  controllers: [HealthController],
  providers: [...activities],
  get exports() {
    return [...this.providers, ...this.imports];
  },
})
export class AppModule {}
