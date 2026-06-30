/**
 * Standalone jest config for the API request generator pure-logic tests
 * (request body + curl builder). The repo root jest.config.ts depends on
 * @nx/jest which is not installed, so this self-contained ts-jest config runs
 * the pure-logic specs in isolation.
 *
 * Run: pnpm exec jest -c jest.api-generator.config.cjs
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/apps/frontend/src/lib'],
  testMatch: ['**/api-request-builder.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }],
  },
};
