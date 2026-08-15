module.exports = {
  preset: 'ts-jest', testEnvironment: 'node', rootDir: __dirname,
  roots: ['<rootDir>/libraries/nestjs-libraries/src/integrations/social'],
  testMatch: ['**/comment.capability.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }] },
};
