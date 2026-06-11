import { Controller, Get } from '@nestjs/common';
import { ioRedis } from '@postsider/nestjs-libraries/redis/redis.service';
import { PrismaService } from '@postsider/nestjs-libraries/database/prisma/prisma.service';

const startedAt = new Date().toISOString();

@Controller('/')
export class RootController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('/')
  getRoot(): string {
    return 'App is running!';
  }

  @Get('/health')
  async getHealth() {
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

    const healthy = Object.values(checks).every((v) => v === 'ok');

    return {
      status: healthy ? 'healthy' : 'degraded',
      version: process.env.npm_package_version || '1.0.0',
      startedAt,
      uptime: Math.floor(process.uptime()),
      checks,
    };
  }
}
