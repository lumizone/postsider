import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '@postsider/nestjs-libraries/database/prisma/database.module';
import { ApiModule } from '@postsider/backend/api/api.module';
import { APP_GUARD } from '@nestjs/core';
import { PoliciesGuard } from '@postsider/backend/services/auth/permissions/permissions.guard';
import { PublicApiModule } from '@postsider/backend/public-api/public.api.module';
import { ThrottlerBehindProxyGuard } from '@postsider/nestjs-libraries/throttler/throttler.provider';
import { ThrottlerModule } from '@nestjs/throttler';
import { AgentModule } from '@postsider/nestjs-libraries/agent/agent.module';
import { ThirdPartyModule } from '@postsider/nestjs-libraries/3rdparties/thirdparty.module';
import { VideoModule } from '@postsider/nestjs-libraries/videos/video.module';
import { SentryModule } from '@sentry/nestjs/setup';
import { FILTER } from '@postsider/nestjs-libraries/sentry/sentry.exception';
import { ChatModule } from '@postsider/nestjs-libraries/chat/chat.module';
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
    AgentModule,
    ThirdPartyModule,
    VideoModule,
    ChatModule,
    getTemporalModule(false),
    TemporalRegisterMissingSearchAttributesModule,
    InfiniteWorkflowRegisterModule,
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 3600000,
          limit: process.env.API_LIMIT ? Number(process.env.API_LIMIT) : 9999,
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
    AgentModule,
    ThrottlerModule,
    ChatModule,
  ],
})
export class AppModule {}
