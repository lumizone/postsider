/**
 * Standalone jest config for the post-checker unit tests.
 * The repo's root jest.config.ts depends on @nx/jest (not installed), so the
 * post-checker pure-logic specs run through this self-contained ts-jest config.
 *
 * Run: pnpm exec jest -c jest.post-checker.config.cjs
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/libraries/nestjs-libraries/src/post-checker'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }],
  },
};
