/** Unit tests for the pure transport seam — plain ts-jest (no RN/Expo), Node env. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  moduleNameMapper: {
    '^@blue-bee/shared$': '<rootDir>/../shared/dist/index.js',
  },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          esModuleInterop: true,
          skipLibCheck: true,
          lib: ['ES2021', 'DOM'],
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
