module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: [
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/integrations',
    '<rootDir>/libraries/nestjs-libraries/src/database/prisma/subscriptions',
    '<rootDir>/libraries/nestjs-libraries/src/integrations',
    '<rootDir>/apps/orchestrator/src/workflows',
    '<rootDir>/apps/backend/src/api/routes',
  ],
  testMatch: [
    '**/integration.repository.refresh-cas.spec.ts',
    '**/integration.service.selection.spec.ts',
    '**/subscription.repository.entitlement.spec.ts',
    '**/refresh.integration.service.spec.ts',
    '**/refresh.token.workflow.v3.spec.ts',
    '**/no.auth.integrations.controller.extension-refresh.spec.ts',
  ],
  moduleNameMapper: {
    '^@postsider/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@postsider/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@postsider/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }],
  },
};
