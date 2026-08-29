/**
 * Standalone jest config for the isPlatformAiEnabled flag.
 * The repo root jest.config.ts depends on @nx/jest (not installed), so this
 * self-contained ts-jest config runs the pure-logic spec in isolation.
 *
 * Run: pnpm exec jest -c jest.ai-flag.config.cjs
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/libraries/nestjs-libraries/src/services'],
  testMatch: ['**/ai.flag.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }],
  },
};
