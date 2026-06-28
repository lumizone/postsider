/**
 * Standalone jest config for the per-platform preview pure-logic tests
 * (family mapping + formatting utils). The repo root jest.config.ts depends on
 * @nx/jest which is not installed, so this self-contained ts-jest config runs
 * the pure-logic specs in isolation.
 *
 * Run: pnpm exec jest -c jest.post-preview.config.cjs
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/apps/frontend/src/components/post-preview'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }],
  },
};
