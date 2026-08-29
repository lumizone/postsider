import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '@postsider/nestjs-libraries/database/prisma/database.module';
import { ApiModule } from '@postsider/backend/api/api.module';
import { APP_GUARD } from '@nestjs/core';
import { PoliciesGuard } from '@postsider/backend/services/auth/permissions/permissions.guard';
import { PublicApiModule } from '@postsider/backend/public-api/public.api.module';
import { ThrottlerBehindProxyGuard } from '@postsider/nestjs-libraries/throttler/throttler.provider';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { FILTER } from '@postsider/nestjs-libraries/sentry/sentry.exception';
import { PostCheckerModule } from '@postsider/nestjs-libraries/post-checker/post-checker.module';
import { SmartSlotsModule } from '@postsider/nestjs-libraries/smart-slots/smart-slots.module';
import { CsvImportModule } from '@postsider/nestjs-libraries/csv-import/csv-import.module';
import { getTemporalModule } from '@postsider/nestjs-libraries/temporal/temporal.module';
import { TemporalRegisterMissingSearchAttributesModule } from '@postsider/nestjs-libraries/temporal/temporal.register';
import { InfiniteWorkflowRegisterModule } from '@postsider/nestjs-libraries/temporal/infinite.workflow.register';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';

@Global()
@Module({
  imports: [
    SentryModule.forRoot(),
    DatabaseModule,
    ApiModule,
    PublicApiModule,
    PostCheckerModule,
    SmartSlotsModule,
    CsvImportModule,
    getTemporalModule(false),
    TemporalRegisterMissingSearchAttributesModule,
    InfiniteWorkflowRegisterModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          // Per IP, per hour, across the dashboard API. Deliberately NOT
          // API_LIMIT: that name is the Public API's per-MINUTE, per-ORG budget
          // (api-rate-limit.guard.ts), and one env var driving two limiters
          // with different units and scopes is how you accidentally cap the
          // dashboard at 60 requests an hour.
          ttl: 3600000,
          limit: process.env.DASHBOARD_RATE_LIMIT
            ? Number(process.env.DASHBOARD_RATE_LIMIT)
            : 3000,
        },
      ],
      storage: new ThrottlerStorageRedisService(ioRedis),
    }),
  ],
  controllers: [],
  providers: [
    FILTER,
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PoliciesGuard,
    },
  ],
  exports: [
    DatabaseModule,
    ApiModule,
    PublicApiModule,
    ThrottlerModule,
  ],
})
export class AppModule {}
