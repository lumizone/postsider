/**
 * Standalone jest config for the BYO-key AI rewrite pure-logic tests
 * (prompt builder + response validator). The repo root jest.config.ts depends
 * on @nx/jest which is not installed, so this self-contained ts-jest config
 * runs the rewrite specs in isolation.
 *
 * Run: pnpm exec jest -c jest.ai-rewrite.config.cjs
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/libraries/nestjs-libraries/src/post-checker'],
  testMatch: ['**/rewrite.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }],
  },
};
