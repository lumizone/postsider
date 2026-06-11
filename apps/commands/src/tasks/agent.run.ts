import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { AgentGraphService } from '@postsider/nestjs-libraries/agent/agent.graph.service';

@Injectable()
export class AgentRun {
  constructor(private _agentGraphService: AgentGraphService) {}
  @Command({
    command: 'run:agent',
    describe: 'Run the agent',
  })
  async agentRun() {
    const stream = this._agentGraphService.start('debug-org', {
      research: 'hello',
      isPicture: true,
      format: 'one_short',
      tone: 'personal',
    } as any);

    for await (const event of stream) {
      console.log(event);
    }
  }
}
