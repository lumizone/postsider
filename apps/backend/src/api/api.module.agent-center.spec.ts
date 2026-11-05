jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));
// ApiModule transitively imports jsdom (ESM), which jest cannot parse. This spec only
// checks controller registration and never runs a handler, so a stub is enough; do not
// copy it into a behavior spec.
jest.mock('jsdom', () => ({ JSDOM: class {} }));

import { ApiModule } from './api.module';
import { AgentActivityController } from './routes/agent-activity.controller';
import { PoliciesController } from './routes/policies.controller';
import { AuthMiddleware } from '@postsider/backend/services/auth/auth.middleware';
import { CsrfMiddleware } from '@postsider/backend/services/auth/csrf.middleware';

describe('ApiModule agent center registration', () => {
  it('declares AgentActivityController', () => {
    expect(Reflect.getMetadata('controllers', ApiModule)).toContain(AgentActivityController);
  });

  it('declares PoliciesController', () => {
    expect(Reflect.getMetadata('controllers', ApiModule)).toContain(PoliciesController);
  });

  it('guards AgentActivityController with CSRF and auth middleware', () => {
    const applied: Array<{ mw: unknown; routes: unknown[] }> = [];
    const consumer: any = {
      apply: (mw: unknown) => ({
        forRoutes: (...routes: unknown[]) => {
          applied.push({ mw, routes });
          return consumer;
        },
      }),
    };
    new ApiModule().configure(consumer);
    for (const mw of [CsrfMiddleware, AuthMiddleware]) {
      const entry = applied.find((a) => a.mw === mw);
      expect(entry?.routes).toContain(AgentActivityController);
      expect(entry?.routes).toContain(PoliciesController);
    }
  });
});
