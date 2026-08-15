/**
 * Standalone jest config for the posting-queue pure-logic tests
 * (queue-slot day filtering). The repo root jest.config.ts depends on
 * @nx/jest which is not installed, so this self-contained ts-jest config
 * runs the pure-logic specs in isolation.
 *
 * Run: pnpm exec jest -c jest.queue-plan.config.cjs
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/libraries/nestjs-libraries/src/database/prisma/posts'],
  testMatch: ['**/queue-slots.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }],
  },
};
