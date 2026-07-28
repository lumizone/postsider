import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthController } from '@postsider/backend/api/routes/auth.controller';
import { AuthService } from '@postsider/backend/services/auth/auth.service';
import { UsersController } from '@postsider/backend/api/routes/users.controller';
import { AuthMiddleware } from '@postsider/backend/services/auth/auth.middleware';
import { PolarController } from '@postsider/backend/api/routes/polar.controller';
import { PolarService } from '@postsider/nestjs-libraries/services/polar.service';
import { AnalyticsController } from '@postsider/backend/api/routes/analytics.controller';
import { PoliciesGuard } from '@postsider/backend/services/auth/permissions/permissions.guard';
import { PermissionsService } from '@postsider/backend/services/auth/permissions/permissions.service';
import { IntegrationsController } from '@postsider/backend/api/routes/integrations.controller';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { SettingsController } from '@postsider/backend/api/routes/settings.controller';
import { PostsController } from '@postsider/backend/api/routes/posts.controller';
import { EvergreenController } from '@postsider/backend/api/routes/evergreen.controller';
import { ComposerHelpersController } from '@postsider/backend/api/routes/composer-helpers.controller';
import { ApprovalController } from '@postsider/backend/api/routes/approval.controller';
import { MediaController } from '@postsider/backend/api/routes/media.controller';
import { UploadModule } from '@postsider/nestjs-libraries/upload/upload.module';
import { BillingController } from '@postsider/backend/api/routes/billing.controller';
import { NotificationsController } from '@postsider/backend/api/routes/notifications.controller';
import { OpenaiService } from '@postsider/nestjs-libraries/openai/openai.service';
import { ExtractContentService } from '@postsider/nestjs-libraries/openai/extract.content.service';
import { CodesService } from '@postsider/nestjs-libraries/services/codes.service';
import { PublicController } from '@postsider/backend/api/routes/public.controller';
import { RootController } from '@postsider/backend/api/routes/root.controller';
import { TrackService } from '@postsider/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@postsider/nestjs-libraries/short-linking/short.link.service';
import { WebhookController } from '@postsider/backend/api/routes/webhooks.controller';
import { SignatureController } from '@postsider/backend/api/routes/signature.controller';
import { SetsController } from '@postsider/backend/api/routes/sets.controller';
import { MonitorController } from '@postsider/backend/api/routes/monitor.controller';
import { NoAuthIntegrationsController } from '@postsider/backend/api/routes/no.auth.integrations.controller';
import { MetaComplianceController } from '@postsider/backend/api/routes/meta.compliance.controller';
import { EnterpriseController } from '@postsider/backend/api/routes/enterprise.controller';
import { OAuthAppController } from '@postsider/backend/api/routes/oauth-app.controller';
import { ApprovedAppsController } from '@postsider/backend/api/routes/approved-apps.controller';
import { OAuthController, OAuthAuthorizedController } from '@postsider/backend/api/routes/oauth.controller';
import { AnnouncementsController } from '@postsider/backend/api/routes/announcements.controller';
import { AdminController } from '@postsider/backend/api/routes/admin.controller';
import { AuthProviderManager } from '@postsider/backend/services/auth/providers/providers.manager';
import { GithubProvider } from '@postsider/backend/services/auth/providers/github.provider';
import { GoogleProvider } from '@postsider/backend/services/auth/providers/google.provider';
import { FarcasterProvider } from '@postsider/backend/services/auth/providers/farcaster.provider';
import { WalletProvider } from '@postsider/backend/services/auth/providers/wallet.provider';
import { OauthProvider } from '@postsider/backend/services/auth/providers/oauth.provider';

import { RequestIdMiddleware } from '@postsider/nestjs-libraries/services/request-id.middleware';
import { CsrfMiddleware } from '@postsider/backend/services/auth/csrf.middleware';

const authenticatedController = [
  UsersController,
  AnalyticsController,
  IntegrationsController,
  SettingsController,
  PostsController,
  MediaController,
  BillingController,
  NotificationsController,
  WebhookController,
  SignatureController,
  SetsController,
  OAuthAppController,
  ApprovedAppsController,
  OAuthAuthorizedController,
  AnnouncementsController,
  AdminController,
  EvergreenController,
  ComposerHelpersController,
  ApprovalController,
];
@Module({
  imports: [UploadModule],
  controllers: [
    RootController,
    PolarController,
    AuthController,
    PublicController,
    MonitorController,
    EnterpriseController,
    NoAuthIntegrationsController,
    MetaComplianceController,
    OAuthController,
    ...authenticatedController,
  ],
  providers: [
    AuthService,
    PolarService,
    OpenaiService,
    ExtractContentService,
    AuthMiddleware,
    CsrfMiddleware,
    PoliciesGuard,
    PermissionsService,
    CodesService,
    IntegrationManager,
    TrackService,
    ShortLinkService,
    AuthProviderManager,
    GithubProvider,
    GoogleProvider,
    FarcasterProvider,
    WalletProvider,
    OauthProvider,
  ],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    consumer.apply(CsrfMiddleware).forRoutes(...authenticatedController);
    consumer.apply(AuthMiddleware).forRoutes(...authenticatedController);
  }
}
