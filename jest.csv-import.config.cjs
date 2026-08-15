/**
 * Standalone jest config for the CSV import pure-logic tests
 * (parser + validator). The repo root jest.config.ts depends on @nx/jest
 * which is not installed, so this self-contained ts-jest config runs the
 * pure-logic specs in isolation.
 *
 * Run: pnpm exec jest -c jest.csv-import.config.cjs
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/libraries/nestjs-libraries/src/csv-import'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }],
  },
};
