import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { capitalize } from 'lodash';

const SECRET_TOKEN_RE = /\b(agt_|pos_|ps_)[A-Za-z0-9]+/g;
const REDACTED = '[redacted]';

/**
 * Recursively redact secret-looking values from a Sentry event or breadcrumb.
 * Mutates and returns the same object. Best-effort and defensive: any failure
 * falls back to returning the original object so telemetry is never lost.
 *
 * Exported for unit testing.
 */
export function scrubSecrets<T>(obj: T, depth = 0): T {
  if (obj == null || depth > 8) return obj;
  try {
    if (typeof obj === 'string') {
      return obj.replace(SECRET_TOKEN_RE, REDACTED) as unknown as T;
    }
    if (Array.isArray(obj)) {
      return obj.map((v) => scrubSecrets(v, depth + 1)) as unknown as T;
    }
    if (typeof obj === 'object') {
      for (const key of Object.keys(obj as Record<string, unknown>)) {
        const lower = key.toLowerCase();
        const record = obj as Record<string, unknown>;
        if (
          lower === 'authorization' ||
          lower === 'auth' ||
          lower === 'token' ||
          lower === 'apikey' ||
          lower === 'api_key' ||
          lower === 'password' ||
          lower === 'clientsecret' ||
          lower === 'client_secret'
        ) {
          record[key] = REDACTED;
        } else {
          record[key] = scrubSecrets(record[key], depth + 1);
        }
      }
    }
  } catch {
    /* never break telemetry on scrub failure */
  }
  return obj;
}

export const initializeSentry = (appName: string, allowLogs = false) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
    return null;
  }

  try {
    Sentry.init({
      initialScope: {
        tags: {
          service: appName,
          component: 'nestjs',
        },
        contexts: {
          app: {
            name: `Postsider ${capitalize(appName)}`,
          },
        },
      },
      environment: process.env.NODE_ENV || 'development',
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      spotlight: process.env.SENTRY_SPOTLIGHT === '1',
      integrations: [
        // Add our Profiling integration
        nodeProfilingIntegration(),
        Sentry.consoleLoggingIntegration({ levels: ['log', 'info', 'warn', 'error', 'debug', 'assert', 'trace'] }),
        Sentry.openAIIntegration({
          recordInputs: true,
          recordOutputs: true,
        }),
      ],
      tracesSampleRate: 1.0,
      enableLogs: true,

      // Redact secrets from every event/breadcrumb before it leaves the
      // process (Requirements 18.3, 21.2): agent tokens (agt_), OAuth tokens
      // (pos_), API keys (ps_) and Authorization headers.
      beforeSend(event) {
        return scrubSecrets(event);
      },
      beforeBreadcrumb(breadcrumb) {
        return scrubSecrets(breadcrumb);
      },

      // Profiling
      profileSessionSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.45,
      profileLifecycle: 'trace',
    });
  } catch (err) {
    console.log(err);
  }
  return true;
};
