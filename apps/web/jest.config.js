const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // Consume the BUILT workspace packages (CommonJS dist), exactly like the Expo apps' jest.
  moduleNameMapper: {
    '^@blue-bee/shared$': '<rootDir>/../../packages/shared/dist/index.js',
    '^@blue-bee/api-client$': '<rootDir>/../../packages/api-client/dist/index.js',
    '^@/(.*)$': '<rootDir>/$1',
  },
};

module.exports = createJestConfig(config);
