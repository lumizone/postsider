/**
 * Standalone jest config for the composer-helpers pure-logic tests
 * (UTM URL tagging). The repo root jest.config.ts depends on @nx/jest
 * which is not installed, so this self-contained ts-jest config runs the
 * pure-logic specs in isolation.
 *
 * Run: pnpm exec jest -c jest.composer-helpers.config.cjs
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/apps/frontend/src/lib'],
  testMatch: ['**/utm-utils.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }],
  },
};
