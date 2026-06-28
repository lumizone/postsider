import { Module } from '@nestjs/common';
import { CommandModule as ExternalCommandModule } from 'nestjs-command';
import { DatabaseModule } from '@postsider/nestjs-libraries/database/prisma/database.module';
import { RefreshTokens } from './tasks/refresh.tokens';
import { ConfigurationTask } from './tasks/configuration';
import { AgentRun } from './tasks/agent.run';
import { BootstrapAdminTask } from './tasks/bootstrap.admin';

@Module({
  imports: [ExternalCommandModule, DatabaseModule],
  controllers: [],
  providers: [RefreshTokens, ConfigurationTask, AgentRun, BootstrapAdminTask],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class CommandModule {}
