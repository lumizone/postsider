import { TemporalModule } from 'nestjs-temporal-core';
import { socialIntegrationList } from '@postsider/nestjs-libraries/integrations/integration.manager';

export const getTemporalModule = (
  isWorkers: boolean,
  path?: string,
  activityClasses?: any[]
) => {
  return TemporalModule.register({
    isGlobal: true,
    connection: {
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
      ...process.env.TEMPORAL_TLS === 'true' ? {tls: true} : {},
      ...process.env.TEMPORAL_API_KEY ? {apiKey: process.env.TEMPORAL_API_KEY} : {},
      namespace: process.env.TEMPORAL_NAMESPACE || 'default',
    },
    taskQueue: 'main',
    logLevel: 'error',
    ...(isWorkers
      ? {
          // Fail LOUDLY when workers cannot be created. The library default
          // (undefined) makes TemporalWorkerManagerService log a warning and
          // `return` on a failed connection, so Nest boots "healthy" with zero
          // workers polling — scheduled posts then pile up in QUEUE with no
          // error and nothing alerts. Setting this to false turns that into a
          // thrown error, so the process exits and pm2 restarts it.
          // Client-side (isWorkers=false) keeps the lenient default: it uses a
          // lazy connection and must not take the backend down with it.
          allowConnectionFailure: false,
          workers: [
            { identifier: 'main', maxConcurrentJob: undefined },
            ...socialIntegrationList,
          ]
            .filter((f) => f.identifier.indexOf('-') === -1)
            .map((integration) => ({
              taskQueue: integration.identifier.split('-')[0],
              workflowsPath: path!,
              activityClasses: activityClasses!,
              autoStart: true,
              ...(integration.maxConcurrentJob
                ? {
                    workerOptions: {
                      maxConcurrentActivityTaskExecutions:
                        integration.maxConcurrentJob,
                    },
                  }
                : {}),
            })),
        }
      : {}),
  });
};
