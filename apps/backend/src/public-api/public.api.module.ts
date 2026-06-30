import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthService } from '@postsider/backend/services/auth/auth.service';
import { PoliciesGuard } from '@postsider/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@postsider/backend/services/auth/permissions/permissions.service';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { UploadModule } from '@postsider/nestjs-libraries/upload/upload.module';
import { OpenaiService } from '@postsider/nestjs-libraries/openai/openai.service';
import { ExtractContentService } from '@postsider/nestjs-libraries/openai/extract.content.service';
import { CodesService } from '@postsider/nestjs-libraries/services/codes.service';
import { PublicIntegrationsController } from '@postsider/backend/public-api/routes/v1/public.integrations.controller';
import { PublicAuthMiddleware } from '@postsider/backend/services/auth/public.auth.middleware';
import { ApiRateLimitGuard } from '@postsider/nestjs-libraries/services/api-rate-limit.guard';
import { RequestIdMiddleware } from '@postsider/nestjs-libraries/services/request-id.middleware';

const authenticatedController = [PublicIntegrationsController];
@Module({
  imports: [UploadModule],
  controllers: [...authenticatedController],
  providers: [
    AuthService,
    OpenaiService,
    ExtractContentService,
    PoliciesGuard,
    PermissionsService,
    CodesService,
    IntegrationManager,
    ApiRateLimitGuard,
    {
      provide: APP_GUARD,
      useClass: ApiRateLimitGuard,
    },
  ],
  exports: [
    UploadModule,
    AuthService,
    OpenaiService,
    ExtractContentService,
    PoliciesGuard,
    PermissionsService,
    CodesService,
    IntegrationManager,
    ApiRateLimitGuard,
  ],
})
export class PublicApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes(...authenticatedController);
    consumer.apply(PublicAuthMiddleware).forRoutes(...authenticatedController);
  }
}

