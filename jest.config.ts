import type { Config } from 'jest';

/**
 * Root Jest configuration (pnpm workspaces — not Nx).
 *
 * Replaces the previous `@nx/jest` preset, which is not installed and is a
 * leftover from the upstream Nx monorepo. Tests live next to source as
 * `*.spec.ts` and import via the `@postsider/*` path aliases.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/apps', '<rootDir>/libraries'],
  testMatch: ['**/*.spec.ts'],
  // apps/mcp ships ESM tests run via apps/mcp/jest.config.cjs (and the CI
  // "MCP server tests" step); exclude them from this CommonJS root run.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/apps/mcp/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
  // Several provider dependencies (nostr-tools, @noble/*, @scure/*) ship ESM
  // only. Allow ts-jest/babel to transform them instead of ignoring them. The
  // pattern matches the package name at ANY depth (nostr-tools vendors its own
  // copy of @noble/curves under nostr-tools/node_modules).
  transformIgnorePatterns: [
    'node_modules/(?!(?:.*[/\\\\])?(?:nostr-tools|@noble|@scure)[/\\\\])',
  ],
  moduleNameMapper: {
    '^@postsider/backend/(.*)$': '<rootDir>/apps/backend/src/$1',
    '^@postsider/frontend/(.*)$': '<rootDir>/apps/frontend/src/$1',
    '^@postsider/helpers/(.*)$': '<rootDir>/libraries/helpers/src/$1',
    '^@postsider/nestjs-libraries/(.*)$':
      '<rootDir>/libraries/nestjs-libraries/src/$1',
    '^@postsider/orchestrator/(.*)$': '<rootDir>/apps/orchestrator/src/$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: {
          // Tests don't need the strict decorator metadata pipeline; keep it
          // light and tolerant so unit tests run without the full Nest setup.
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          strictNullChecks: false,
          target: 'es2019',
          module: 'commonjs',
        },
      },
    ],
    // ESM-only dependencies (see transformIgnorePatterns) are plain JS — run
    // them through babel-jest so `import` is downleveled to CommonJS.
    '^.+\\.(js|mjs)$': 'babel-jest',
  },
  passWithNoTests: true,
};

export default config;
