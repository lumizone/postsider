import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';
import { TemporalService } from 'nestjs-temporal-core';

const startedAt = new Date().toISOString();

@Controller('/')
export class RootController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly _temporal: TemporalService
  ) {}

  @Get('/')
  getRoot(): string {
    return 'App is running!';
  }

  @Get('/health')
  async getHealth(@Res({ passthrough: true }) res: Response) {
    const checks: Record<string, 'ok' | 'error'> = {};

    // Redis check
    try {
      await ioRedis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }

    // PostgreSQL check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }

    // Temporal check. The backend schedules every publish through Temporal, and
    // its client is deliberately lenient (a Temporal blip must not take the API
    // down) — which also means a dead client used to be COMPLETELY invisible:
    // /health stayed green while every newly scheduled post silently never
    // started its workflow. Surfacing it here is what lets the monitor see it.
    try {
      const client = this._temporal.client?.getRawClient();
      if (!client) {
        throw new Error('no client');
      }
      await Promise.race([
        client.connection.workflowService.describeNamespace({
          namespace: process.env.TEMPORAL_NAMESPACE || 'default',
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 3000)
        ),
      ]);
      checks.temporal = 'ok';
    } catch {
      checks.temporal = 'error';
    }

    const healthy = Object.values(checks).every((v) => v === 'ok');

    // "degraded" must be an HTTP error: code-only monitors (container
    // healthcheck, UptimeRobot in HTTP mode) treated a degraded 200 as green.
    res.status(healthy ? 200 : 503);

    return {
      status: healthy ? 'healthy' : 'degraded',
      version: process.env.npm_package_version || '1.0.0',
      startedAt,
      uptime: Math.floor(process.uptime()),
      checks,
    };
  }
}
