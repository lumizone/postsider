module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: __dirname,
  roots: ['<rootDir>/libraries/nestjs-libraries/src/smart-slots'],
  testMatch: ['**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true, tsconfig: { esModuleInterop: true } }] },
};
