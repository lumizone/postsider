import { Global, Module } from '@nestjs/common';
import { PrismaRepository, PrismaService, PrismaTransaction } from './prisma.service';
import { OrganizationRepository } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@postsider/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@postsider/nestjs-libraries/database/prisma/users/users.service';
import { UsersRepository } from '@postsider/nestjs-libraries/database/prisma/users/users.repository';
import { SubscriptionService } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { NotificationService } from '@postsider/nestjs-libraries/database/prisma/notifications/notification.service';
import { IntegrationService } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.repository';
import { PostsService } from '@postsider/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@postsider/nestjs-libraries/database/prisma/posts/posts.repository';
import { IntegrationManager } from '@postsider/nestjs-libraries/integrations/integration.manager';
import { MediaService } from '@postsider/nestjs-libraries/database/prisma/media/media.service';
import { MediaRepository } from '@postsider/nestjs-libraries/database/prisma/media/media.repository';
import { NotificationsRepository } from '@postsider/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@postsider/nestjs-libraries/services/email.service';
import { StripeService } from '@postsider/nestjs-libraries/services/stripe.service';
import { ExtractContentService } from '@postsider/nestjs-libraries/openai/extract.content.service';
import { OpenaiService } from '@postsider/nestjs-libraries/openai/openai.service';
import { AgenciesService } from '@postsider/nestjs-libraries/database/prisma/agencies/agencies.service';
import { AgenciesRepository } from '@postsider/nestjs-libraries/database/prisma/agencies/agencies.repository';
import { TrackService } from '@postsider/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@postsider/nestjs-libraries/short-linking/short.link.service';
import { WebhooksRepository } from '@postsider/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksService } from '@postsider/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { SignatureRepository } from '@postsider/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureService } from '@postsider/nestjs-libraries/database/prisma/signatures/signature.service';
import { SetsService } from '@postsider/nestjs-libraries/database/prisma/sets/sets.service';
import { SetsRepository } from '@postsider/nestjs-libraries/database/prisma/sets/sets.repository';
import { RefreshIntegrationService } from '@postsider/nestjs-libraries/integrations/refresh.integration.service';
import { OAuthRepository } from '@postsider/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService } from '@postsider/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AnnouncementsRepository } from '@postsider/nestjs-libraries/database/prisma/announcements/announcements.repository';
import { AnnouncementsService } from '@postsider/nestjs-libraries/database/prisma/announcements/announcements.service';
import { ErrorsRepository } from '@postsider/nestjs-libraries/database/prisma/errors/errors.repository';
import { ErrorsService } from '@postsider/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsRepository } from '@postsider/nestjs-libraries/database/prisma/admin-stats/admin-stats.repository';
import { AdminStatsService } from '@postsider/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { ProviderCredentialsRepository } from '@postsider/nestjs-libraries/database/prisma/integrations/provider-credentials.repository';
import { ProviderCredentialsService } from '@postsider/nestjs-libraries/database/prisma/integrations/provider-credentials.service';
import { EvergreenRepository } from '@postsider/nestjs-libraries/database/prisma/evergreen/evergreen.repository';
import { EvergreenService } from '@postsider/nestjs-libraries/database/prisma/evergreen/evergreen.service';
import { ComposerHelpersRepository } from '@postsider/nestjs-libraries/database/prisma/composer-helpers/composer-helpers.repository';
import { ComposerHelpersService } from '@postsider/nestjs-libraries/database/prisma/composer-helpers/composer-helpers.service';
import { ApprovalRepository } from '@postsider/nestjs-libraries/database/prisma/approval/approval.repository';
import { ApprovalService } from '@postsider/nestjs-libraries/database/prisma/approval/approval.service';
import { ProviderEnvHelper } from '@postsider/nestjs-libraries/integrations/provider-env.helper';
import { AuditLogger } from '@postsider/nestjs-libraries/database/prisma/audit/audit.logger';
import { ConnectorCatalogService } from '@postsider/nestjs-libraries/integrations/connector.catalog';
import { InboundSubscriptionRepository } from '@postsider/nestjs-libraries/database/prisma/inbound/inbound-subscription.repository';
import { InboundService } from '@postsider/nestjs-libraries/database/prisma/inbound/inbound.service';
import { InboundSourceRegistry } from '@postsider/nestjs-libraries/integrations/inbound/inbound.registry';

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    UsersService,
    UsersRepository,
    OrganizationService,
    OrganizationRepository,
    SubscriptionService,
    SubscriptionRepository,
    NotificationService,
    NotificationsRepository,
    WebhooksRepository,
    WebhooksService,
    IntegrationService,
    IntegrationRepository,
    PostsService,
    PostsRepository,
    StripeService,
    SignatureRepository,
    SignatureService,
    MediaService,
    MediaRepository,
    AgenciesService,
    AgenciesRepository,
    IntegrationManager,
    RefreshIntegrationService,
    ExtractContentService,
    OpenaiService,
    EmailService,
    TrackService,
    ShortLinkService,
    SetsService,
    SetsRepository,
    OAuthRepository,
    OAuthService,
    AnnouncementsRepository,
    AnnouncementsService,
    ErrorsRepository,
    ErrorsService,
    AdminStatsRepository,
    AdminStatsService,
    ProviderCredentialsRepository,
    ProviderCredentialsService,
    ProviderEnvHelper,
    AuditLogger,
    ConnectorCatalogService,
    InboundSubscriptionRepository,
    InboundService,
    InboundSourceRegistry,
    EvergreenRepository,
    EvergreenService,
    ComposerHelpersRepository,
    ComposerHelpersService,
    ApprovalRepository,
    ApprovalService,
  ],
  get exports() {
    return this.providers;
  },
})
export class DatabaseModule {}
