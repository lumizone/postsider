import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { Connection } from '@temporalio/client';
import { TemporalService } from 'nestjs-temporal-core';

@Controller('health')
export class HealthController {
  constructor(private _temporal: TemporalService) {}

  @Get('/status')
  async getHealthStatus(@Res() res: Response) {
    let connection: Connection | undefined;
    try {
      const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
      connection = await Connection.connect({
        address,
        ...(process.env.TEMPORAL_TLS === 'true' ? { tls: true } : {}),
        ...(process.env.TEMPORAL_API_KEY
          ? { apiKey: process.env.TEMPORAL_API_KEY }
          : {}),
      });

      const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
      await Promise.race([
        connection.workflowService.describeNamespace({ namespace }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 10000)
        ),
      ]);
      return res.status(200).json({ status: 'ok' });
    } catch {
      return res.status(500).json({ status: 'error' });
    } finally {
      await connection?.close().catch(() => {});
    }
  }

  /**
   * Readiness of THIS process as a publisher, not of the Temporal server.
   *
   * `/health/status` above only proves the server is reachable — it answered 200
   * throughout the 2026-07 outage in which this process had zero workers polling
   * and every scheduled post silently piled up in QUEUE. Monitoring must watch
   * this endpoint instead: it is non-200 whenever a worker that should be
   * polling is not.
   */
  @Get('/workers')
  async getWorkersHealth(@Res() res: Response) {
    try {
      const info = this._temporal.getAllWorkers();

      if (!info || info.totalWorkers === 0) {
        return res.status(503).json({
          status: 'error',
          reason: 'no workers registered',
          totalWorkers: 0,
          runningWorkers: 0,
        });
      }

      const workers = Array.from(info.workers.entries()).map(
        ([taskQueue, status]) => ({
          taskQueue,
          isRunning: status.isRunning,
          isHealthy: status.isHealthy,
          ...(status.lastError ? { lastError: status.lastError } : {}),
        })
      );
      const notRunning = workers.filter((w) => !w.isRunning);

      // The `main` queue is the one that matters most: every publish workflow
      // runs there (the platform is just an activity argument), so a dead `main`
      // means nothing publishes at all, whatever the per-platform queues say.
      const main = workers.find((w) => w.taskQueue === 'main');
      const healthy = notRunning.length === 0 && main?.isRunning === true;

      return res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'error',
        totalWorkers: info.totalWorkers,
        runningWorkers: info.runningWorkers,
        healthyWorkers: info.healthyWorkers,
        ...(healthy
          ? {}
          : { notRunning: notRunning.map((w) => w.taskQueue) }),
        workers,
      });
    } catch (error) {
      return res.status(503).json({
        status: 'error',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
