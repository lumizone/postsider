/**
 * Standalone jest config for the @postsider/mcp unit tests.
 *
 * The package is ESM ("type":"module", NodeNext, .js import suffixes), so this
 * uses ts-jest's ESM preset. The repo root jest.config.ts depends on @nx/jest
 * (not installed), so each suite runs through its own self-contained config,
 * matching the other jest.*.config.cjs files at the repo root.
 *
 * Run from the repo root with the VM-modules flag (ESM requires it):
 *   NODE_OPTIONS=--experimental-vm-modules pnpm exec jest -c apps/mcp/jest.config.cjs
 */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  // Relative imports carry the .js suffix (ESM/NodeNext); map them back to the
  // .ts sources so ts-jest resolves them in tests.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'node',
          esModuleInterop: true,
          strict: true,
          isolatedModules: true,
        },
      },
    ],
  },
};
