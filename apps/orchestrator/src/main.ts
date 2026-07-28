import { initializeSentry } from '@postsider/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('orchestrator', true);
import 'source-map-support/register';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

import { NestFactory } from '@nestjs/core';
import { AppModule } from '@postsider/orchestrator/app.module';
import { Connection } from '@temporalio/client';
import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

/**
 * Block until Temporal is actually usable, BEFORE Nest builds the module graph.
 *
 * The Temporal workers are created during module init, and on a cold boot they
 * used to lose a startup race with the server: the connection was refused,
 * nestjs-temporal-core swallowed the error, and the process came up reporting
 * healthy with ZERO workers polling. Scheduled posts then sat in QUEUE with no
 * error and nothing alerted — publishing was silently dead for ~10 days in
 * 2026-07.
 *
 * Waiting here (rather than crashing and letting pm2 retry) keeps a cold boot
 * quiet, and describing the namespace — not just opening a socket — is the
 * condition the workers really need, since Temporal's auto-setup image
 * registers `default` only after the server starts accepting connections.
 *
 * Compose already gates the container on a Temporal healthcheck; this covers
 * the setups that have no such gate (external/self-hosted Temporal), and any
 * mid-flight restart of the server.
 */
async function waitForTemporal(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const timeoutMs = Number(process.env.TEMPORAL_WAIT_TIMEOUT_MS || 300000);
  const retryDelayMs = 3000;
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 1; ; attempt++) {
    let connection: Connection | undefined;
    try {
      connection = await Connection.connect({
        address,
        connectTimeout: 10000,
        ...(process.env.TEMPORAL_TLS === 'true' ? { tls: true } : {}),
        ...(process.env.TEMPORAL_API_KEY
          ? { apiKey: process.env.TEMPORAL_API_KEY }
          : {}),
      });
      await connection.workflowService.describeNamespace({ namespace });
      console.log(
        `Temporal ready at ${address} (namespace "${namespace}") after ${attempt} attempt(s)`
      );
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (Date.now() + retryDelayMs >= deadline) {
        throw new Error(
          `Temporal at ${address} still unreachable after ${timeoutMs}ms and ${attempt} attempts — refusing to start without workers. Last error: ${message}`
        );
      }
      console.warn(
        `Temporal not ready (attempt ${attempt}): ${message} — retrying in ${retryDelayMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    } finally {
      await connection?.close().catch(() => {});
    }
  }
}

async function bootstrap() {
  await waitForTemporal();
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = process.env.ORCHESTRATOR_PORT || 3002;
  await app.listen(port);
  console.log(`Orchestrator health check listening on port ${port}`);
}

bootstrap().catch((error) => {
  // Exit non-zero so pm2 restarts us. Starting "successfully" without workers
  // is the failure mode this whole path exists to prevent.
  console.error('Orchestrator failed to start:', error);
  process.exit(1);
});
