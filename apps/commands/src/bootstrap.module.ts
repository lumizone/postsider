import { Module } from '@nestjs/common';
import { CommandModule as ExternalCommandModule } from 'nestjs-command';
import { PrismaRepository, PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { BootstrapAdminTask } from './tasks/bootstrap.admin';

/**
 * Minimal Nest module used exclusively by the `bootstrap` command.
 *
 * Importing the full DatabaseModule would pull in NotificationService →
 * TemporalService, which requires a live Temporal connection that a
 * first-time install obviously doesn't have yet. This lightweight module
 * wires only what bootstrap actually needs: a Prisma connection.
 */
@Module({
  imports: [ExternalCommandModule],
  providers: [
    PrismaService,
    PrismaRepository,
    BootstrapAdminTask,
  ],
})
export class BootstrapModule {}
