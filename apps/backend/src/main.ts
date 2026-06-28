import { initializeSentry } from '@postsider/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('backend', true);
import compression from 'compression';

import { loadSwagger } from '@postsider/helpers/swagger/load.swagger';
import { json } from 'express';
import { Runtime } from '@temporalio/worker';
Runtime.install({ shutdownSignals: [] });

process.env.TZ = 'UTC';

import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

import { SubscriptionExceptionFilter } from '@postsider/backend/services/auth/permissions/subscription.exception';
import { PostValidationExceptionFilter } from '@postsider/backend/api/routes/posts.validation.exception';
import { HttpExceptionFilter } from '@postsider/nestjs-libraries/services/exception.filter';
import { ConfigurationChecker } from '@postsider/helpers/configuration/configuration.checker';

async function start() {
  assertRequiredSecrets();
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    cors: {
      ...(!process.env.NOT_SECURED ? { credentials: true } : {}),
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'auth',
        'showorg',
        'impersonate',
        'x-copilotkit-runtime-client-gql-version',
      ],
      exposedHeaders: [
        'reload',
        'onboarding',
        'activate',
        'x-copilotkit-runtime-client-gql-version',
        ...(process.env.NOT_SECURED ? ['auth', 'showorg', 'impersonate'] : []),
      ],
      origin: [
        process.env.FRONTEND_URL || '',
        'http://localhost:6274',
        ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
      ],
    },
  });

  // Serve locally-stored uploads when the deployment uses STORAGE_PROVIDER=local.
  // The previous setup relied on the (now-removed) frontend or an external
  // reverse proxy to expose `/uploads/*`; in the headless agent-bridge
  // configuration the backend itself has to host them or every upload URL
  // returned to clients would 404. R2 deployments simply ignore this mount.
  if (
    (process.env.STORAGE_PROVIDER || 'local') === 'local' &&
    process.env.UPLOAD_DIRECTORY
  ) {
    const { static: serveStatic } = await import('express');
    const { resolve } = await import('path');
    const uploadDir = resolve(process.env.UPLOAD_DIRECTORY);
    app.use('/uploads', serveStatic(uploadDir, {
      index: false,
      dotfiles: 'deny',
      fallthrough: false,
    }));
  }

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
    })
  );

  app.use(['/copilot/{*splat}', '/posts'], (req: any, res: any, next: any) => {
    json({ limit: '50mb' })(req, res, next);
  });

  app.use(cookieParser());
  app.use(compression());

  // Security headers (equivalent to helmet — no extra dependency needed)
  app.use((req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0'); // Modern browsers don't need this; disabled to avoid false positives
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // Content-Security-Policy — restrict resource loading to trusted origins.
    // 'self' + backend/frontend URLs cover normal operation; inline styles are
    // needed for many UI libraries. Adjust connect-src if you add external APIs.
    const frontendUrl = process.env.FRONTEND_URL || '';
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || '';
    const cspDirectives = [
      "default-src 'self'",
      `script-src 'self'`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: blob: ${frontendUrl} ${backendUrl}`,
      `connect-src 'self' ${frontendUrl} ${backendUrl} https://*.sentry.io`,
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');
    res.setHeader('Content-Security-Policy', cspDirectives);
    next();
  });
  app.useGlobalFilters(new SubscriptionExceptionFilter());
  app.useGlobalFilters(new PostValidationExceptionFilter());
  app.useGlobalFilters(new HttpExceptionFilter());

  loadSwagger(app);

  const port = process.env.PORT || 3000;

  try {
    await app.listen(port);
    console.log('Backend started successfully on port ' + port);

    checkConfiguration(); // Do this last, so that users will see obvious issues at the end of the startup log without having to scroll up.

    Logger.log(`🚀 Backend is running on: http://localhost:${port}`);
  } catch (e) {
    Logger.error(`Backend failed to start on port ${port}`, e);
  }
}

function checkConfiguration() {
  const checker = new ConfigurationChecker();
  checker.readEnvFromProcess();
  checker.check();

  if (checker.hasIssues()) {
    for (const issue of checker.getIssues()) {
      Logger.warn(issue, 'Configuration issue');
    }

    Logger.warn('Configuration issues found: ' + checker.getIssuesCount());
  } else {
    Logger.log('Configuration check completed without any issues');
  }
}

/**
 * Refuse to start when a security-critical secret is missing (Requirement 21.3).
 * Without JWT_SECRET the app cannot sign tokens or encrypt provider credentials,
 * so starting would be unsafe.
 */
function assertRequiredSecrets() {
  const required = ['JWT_SECRET'];
  const missing = required.filter(
    (key) => !process.env[key] || process.env[key]!.length === 0
  );
  if (missing.length) {
    Logger.error(
      `Refusing to start: missing required secret(s): ${missing.join(', ')}.`,
      'Startup'
    );
    process.exit(1);
  }

  // NOT_SECURED exposes JWT in headers and disables httpOnly cookies — never
  // allow this in production. Catch misconfigurations early and hard.
  if (
    process.env.NOT_SECURED &&
    process.env.NOT_SECURED !== 'false' &&
    process.env.NODE_ENV === 'production'
  ) {
    Logger.error(
      'NOT_SECURED must not be enabled in production! Aborting startup.',
      'Startup'
    );
    process.exit(1);
  }
}

start();
